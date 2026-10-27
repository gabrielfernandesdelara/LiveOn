// Sinalização do LiveOn, na Cloudflare: Workers + Durable Objects.
//
// Um tipo de objeto só: Sala, uma por código.
//
// O código é o endereço da sala e a chave dela: quem não sabe o código não
// alcança o Durable Object. Por isso ele é sorteado pelo app, tem tamanho
// mínimo conferido aqui, e as tentativas são limitadas por origem, sem essas
// três coisas, varrer códigos curtos acha sala alheia em segundos.
//
// NÃO existe lista de salas. Existiu uma (um Durable Object "Diretorio" com a
// busca) e foi removida: ela publicava rótulo e lotação de todas as salas
// abertas para qualquer um que soubesse o endereço do Worker.
//
// A hibernação é o que torna isso viável no plano gratuito: entre mensagens o
// objeto dorme sem cobrar duração, e as conexões WebSocket sobrevivem. Por isso
// o estado de cada participante vive anexado ao próprio socket
// (serializeAttachment) em vez de numa variável de instância, variável some
// quando o objeto hiberna, o anexo não.

// Código sorteado sai com ~15 caracteres; este piso existe para barrar quem
// tentar criar sala com "132" por fora do app.
const CODIGO_MINIMO = 10

// Recolhimento de quem sumiu calado. O objeto só limpa em webSocketClose, e
// esse evento pode simplesmente não chegar, daí o alarme como segunda linha.
const JANELA_SILENCIO = 45000   // sem sinal de vida por mais que isso: fora
const INTERVALO_VIGIA = 20000   // de quanto em quanto o alarme confere

// Carência da sala vazia. A sala NÃO morre junto com o último socket.
//
// A conexão com a Cloudflare cai sozinha de tempos em tempos (código 1006 no
// log do app, sem aviso nenhum), e quando cai, cai para todos ao mesmo tempo.
// Apagando no ato, o código deixava de existir no segundo seguinte: quem
// voltava 1s depois ouvia "código não corresponde a nenhuma sala aberta" e a
// sala inteira era despejada, tendo que ser criada de novo com outro código.
// Foi exatamente isso no registro de 22/09 às 23h33.
//
// Com a carência, a sala continua de pé o bastante para todo mundo voltar. O
// código só é liberado quando a carência vence, o que preserva o conserto do
// código preso.
const CARENCIA_VAZIA = 120000

// Quantas credenciais a sala lembra. Havia uma por pessoa que entrou, para
// sempre, tudo dentro de um valor só do armazenamento, que tem limite de
// tamanho. Estourar o limite faria o `put` falhar no meio do `entrar`, e a
// pessoa ficaria sem o 'bemvindo', travada em "conectando". Numa sala de cinco
// amigos isto nunca é alcançado; é para a sala que fica dias de pé.
const LEMBRADOS = 200

// Limites de quem JÁ está numa sala. Só entra quem sabe o código, então isto
// não é a defesa principal (essa é o código e o limite por IP); é para que um
// membro, ou um código vazado, não consiga afogar os outros de mensagem.
//
// Os números são folgados de propósito. A maior mensagem de verdade é uma
// oferta SDP, uns poucos KB. E o pico de verdade é o começo de uma
// transmissão numa sala cheia: SDP e candidatos ICE para quatro pares de uma
// vez, na casa de uma centena em poucos segundos.
const TAMANHO_MAXIMO = 64 * 1024   // caracteres por mensagem
const RITMO_MAXIMO = 300           // mensagens por janela, por conexão
const JANELA_RITMO = 10000

function limpar (texto, tamanho) {
  return String(texto || '').trim().slice(0, tamanho)
}

// Conta uma mensagem na janela atual. A primeira acima do limite ganha
// resposta, para quem estiver do outro lado entender o que houve; as
// seguintes são descartadas caladas, senão o próprio aviso virava enxurrada.
function noRitmo (conta, agora) {
  if (agora - conta.desde > JANELA_RITMO) {
    conta.desde = agora
    conta.quantas = 0
  }
  conta.quantas++
  if (conta.quantas <= RITMO_MAXIMO) return 'ok'
  return conta.quantas === RITMO_MAXIMO + 1 ? 'avisar' : 'calar'
}

export default {
  async fetch (requisicao, ambiente) {
    const url = new URL(requisicao.url)

    if (url.pathname === '/saude') {
      return new Response('LiveOn de pé\n', { status: 200 })
    }

    const partes = url.pathname.split('/').filter(Boolean)
    if (partes[0] !== 'sala' || !partes[1]) {
      return new Response('use /sala/<codigo>', { status: 404 })
    }

    if (requisicao.headers.get('Upgrade') !== 'websocket') {
      return new Response('esperava um WebSocket', { status: 426 })
    }

    // O código diferencia maiúscula de minúscula: é segredo, não apelido.
    const codigo = limpar(decodeURIComponent(partes[1]), 60)
    if (!codigo) return new Response('código vazio', { status: 400 })

    // Limite por origem. Precisa ser por IP, e não por sala: cada código
    // errado cai num Durable Object DIFERENTE, então contar tentativa dentro
    // da sala não veria varredura nenhuma. Medido antes disto: 60 códigos em
    // 1,6 s, sem qualquer freio.
    const origem = requisicao.headers.get('CF-Connecting-IP') || 'desconhecida'
    const { success } = await ambiente.LIMITE_ENTRADA.limit({ key: origem })
    if (!success) {
      return new Response('muitas tentativas, espere um pouco', { status: 429 })
    }

    return ambiente.SALA.get(ambiente.SALA.idFromName(codigo)).fetch(requisicao)
  }
}

// ===========================================================================
// Sala
// ===========================================================================

export class Sala {
  constructor (estado, ambiente) {
    this.estado = estado
    this.ambiente = ambiente

    // A conta do ritmo de cada conexão fica na memória, não no anexo do
    // socket: gravar o anexo a cada mensagem custaria escrita à toa. Se o
    // objeto hibernar a conta zera, e tudo bem: quem está mandando em
    // enxurrada não deixa o objeto dormir.
    this.ritmo = new WeakMap()

    // Responde ao ping sem acordar o objeto. É o que deixa a batida de coração
    // praticamente de graça: o runtime responde sozinho durante a hibernação.
    this.estado.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ tipo: 'ping' }),
        JSON.stringify({ tipo: 'pong' })
      )
    )
  }

  async fetch (requisicao) {
    const par = new WebSocketPair()
    const [doCliente, doServidor] = Object.values(par)

    // acceptWebSocket, e não server.accept(): é o que permite hibernar.
    this.estado.acceptWebSocket(doServidor)

    // Guarda o próprio código para o `abrir` conferir o tamanho mínimo.
    //
    // NÃO é sobra do diretório removido. Uma revisão de segurança o marcou
    // como código morto; apagar reabriria a criação de sala com código curto
    // ("132"), que é exatamente o que o piso existe para barrar. O que era
    // sobra de verdade (a rota /quantos e o put('codigo')) já saiu.
    this.codigo = limpar(
      decodeURIComponent(new URL(requisicao.url).pathname.split('/').filter(Boolean)[1] || ''), 60
    )

    return new Response(null, { status: 101, webSocket: doCliente })
  }

  // --- protocolo -------------------------------------------------------------

  async webSocketMessage (ws, dados) {
    const tamanho = typeof dados === 'string' ? dados.length : dados.byteLength
    if (tamanho > TAMANHO_MAXIMO) {
      return this.enviar(ws, { tipo: 'erro', motivo: 'mensagem grande demais' })
    }

    if (!this.ritmo.has(ws)) this.ritmo.set(ws, { desde: Date.now(), quantas: 0 })
    const ritmo = noRitmo(this.ritmo.get(ws), Date.now())
    if (ritmo === 'avisar') return this.enviar(ws, { tipo: 'erro', motivo: 'mensagens demais, espere um pouco' })
    if (ritmo === 'calar') return

    let msg
    try {
      msg = JSON.parse(dados)
    } catch {
      return this.enviar(ws, { tipo: 'erro', motivo: 'json inválido' })
    }

    // Erro tratando uma mensagem vira resposta para quem a mandou, em vez de
    // sumir. Sem isto, o cliente ficava esperando um 'bemvindo' que nunca
    // vinha e a tela travava em "conectando" até a vigia agir.
    //
    // Medido em wrangler dev, com um estouro proposital: o objeto SOBREVIVE à
    // exceção, os outros sockets continuam abertos e a sala segue repassando
    // mensagens. Ou seja, isto não é o que segura a sala de pé, é o que evita
    // deixar alguém pendurado sem resposta.
    try {
      return await this.despachar(ws, msg)
    } catch (erro) {
      console.error(`falha tratando ${msg.tipo}: ${erro.message}`)
      return this.enviar(ws, { tipo: 'erro', motivo: 'o servidor falhou ao tratar essa mensagem' })
    }
  }

  async despachar (ws, msg) {
    switch (msg.tipo) {
      case 'criar': return this.abrir(ws, msg)
      case 'entrar': return this.entrar(ws, msg)
      case 'sdp':
      case 'ice':
      // Pedido de quem assiste para quem transmite: "me manda menor".
      // Direcionado como SDP/ICE, e por isso usa o mesmo repasse.
      case 'qualidade': return this.repassar(ws, msg)
      case 'estado': return this.anunciarEstado(ws, msg)
      case 'ping': {
        // So chega aqui se o auto-response NAO pegou a mensagem. Nesse caso o
        // carimbo dele nunca atualiza, e o alarme recolheria alguem vivo ,
        // entao a marca de vida e renovada na mao.
        const meu = this.dados(ws)
        if (meu) {
          meu.entrouEm = Date.now()
          ws.serializeAttachment(meu)
        }
        return this.enviar(ws, { tipo: 'pong' })
      }
      case 'pong': return
      default:
        return this.enviar(ws, { tipo: 'erro', motivo: `tipo desconhecido: ${msg.tipo}` })
    }
  }

  async webSocketClose (ws) { await this.sair(ws) }
  async webSocketError (ws) { await this.sair(ws) }

  // Abre a sala neste código. Falha se já existir, senão alguém poderia
  // "recriar" a sala de outra pessoa e trocar o nome dela.
  async abrir (ws, msg) {
    if (this.dados(ws)) return

    const nome = limpar(msg.nome, 32)
    const rotulo = limpar(msg.rotulo, 40)

    if (!nome || !rotulo) {
      return this.enviar(ws, { tipo: 'erro', motivo: 'nome da sala e seu nome são obrigatórios' })
    }

    // O app sorteia o código; isto barra quem falar direto com o servidor.
    // `this.codigo` é estado de instância e some quando o objeto hiberna:
    // ausente vira recusa, e nunca um TypeError, que levaria a sala junto.
    const codigo = this.codigo || ''
    if (codigo.length < CODIGO_MINIMO) {
      return this.enviar(ws, {
        tipo: 'erro',
        motivo: `o código precisa ter ao menos ${CODIGO_MINIMO} caracteres`
      })
    }

    // Sala sem NINGUÉM dentro não é sala. Sem esta checagem o código ficava
    // preso para sempre: bastava um socket morrer sem avisar para o registro
    // continuar no armazenamento, e toda tentativa de criar batia em "já
    // existe" numa sala onde não havia mais ninguém.
    const existente = await this.estado.storage.get('rotulo')
    if (existente && this.quantos() > 0) {
      return this.enviar(ws, { tipo: 'erro', motivo: 'já existe uma sala com esse código' })
    }
    if (existente) await this.estado.storage.deleteAll()

    await this.estado.storage.put('rotulo', rotulo)

    await this.acomodar(ws, nome, rotulo)
  }

  async entrar (ws, msg) {
    if (this.dados(ws)) return

    const nome = limpar(msg.nome, 32)
    if (!nome) {
      return this.enviar(ws, { tipo: 'erro', motivo: 'seu nome é obrigatório' })
    }

    const rotulo = await this.estado.storage.get('rotulo')
    if (!rotulo) {
      return this.enviar(ws, { tipo: 'erro', motivo: 'código não corresponde a nenhuma sala aberta' })
    }

    // Sala vazia pode ser uma sala em carência, esperando todo mundo voltar
    // de uma queda. Só é entulho depois que a carência vence.
    if (this.quantos() === 0 && Date.now() - (await this.vaziaDesde()) > CARENCIA_VAZIA) {
      await this.estado.storage.deleteAll()
      return this.enviar(ws, { tipo: 'erro', motivo: 'código não corresponde a nenhuma sala aberta' })
    }

    // Volta de quem caiu. A credencial prova que é a mesma pessoa, então ela
    // recupera o id de antes, sem isso, reconectar criava um estranho: os
    // outros perdiam o volume e a qualidade que tinham escolhido para ela, e
    // o próprio nome dela podia aparecer como "já em uso" por causa do
    // registro antigo que ainda não tinha sido limpo.
    const credencial = limpar(msg.credencial, 64)
    const conhecido = credencial ? (await this.conhecidos())[credencial] : null

    if (conhecido) {
      const velho = this.outros(ws).find((outro) => {
        const d = this.dados(outro)
        return d && d.id === conhecido.id
      })

      // Se o registro antigo ainda está de pé, ninguém viu essa pessoa sair:
      // dá para retomar sem que a sala perceba nada.
      let retomada = false
      let transmitindo = false

      if (velho) {
        const antigos = this.dados(velho)
        retomada = true
        transmitindo = Boolean(antigos && antigos.transmitindo)
        velho.serializeAttachment(null)
        try { velho.close(4001, 'substituído pela reconexão') } catch { /* já morreu */ }
      }

      return this.acomodar(ws, conhecido.nome, rotulo, {
        id: conhecido.id, credencial, retomada, transmitindo
      })
    }

    // Dois "Gabriel" na mesma sala viram confusão: os cards ficam iguais e
    // ninguém sabe quem está transmitindo.
    if (this.nomeOcupado(ws, nome)) {
      return this.enviar(ws, { tipo: 'erro', motivo: `já tem alguém chamado "${nome}" nessa sala` })
    }

    await this.acomodar(ws, nome, rotulo)
  }

  nomeOcupado (ws, nome) {
    const alvo = nome.toLowerCase()
    return this.outros(ws).some((outro) => {
      const d = this.dados(outro)
      return d && (d.nome || '').toLowerCase() === alvo
    })
  }

  // Parte comum de criar e entrar: registra o participante e avisa os outros.
  async acomodar (ws, nome, rotulo, retorno = null) {
    const id = retorno ? retorno.id : crypto.randomUUID()
    const credencial = retorno ? retorno.credencial : crypto.randomUUID()
    const retomada = Boolean(retorno && retorno.retomada)
    const transmitindo = Boolean(retorno && retorno.transmitindo)

    const participantes = this.outros(ws).map((outro) => {
      const d = this.dados(outro)
      return { id: d.id, nome: d.nome, transmitindo: d.transmitindo }
    })

    // entrouEm existe para o alarme: quem acabou de chegar ainda não pingou
    // nenhuma vez, e não pode ser recolhido por causa disso.
    ws.serializeAttachment({ id, nome, credencial, transmitindo, entrouEm: Date.now() })

    // Reinsere para ficar no fim da fila: quem some primeiro é quem entrou
    // há mais tempo, não quem acabou de voltar.
    const conhecidos = await this.conhecidos()
    delete conhecidos[credencial]
    conhecidos[credencial] = { id, nome }

    const chaves = Object.keys(conhecidos)
    for (const antiga of chaves.slice(0, Math.max(0, chaves.length - LEMBRADOS))) {
      delete conhecidos[antiga]
    }

    await this.estado.storage.put('conhecidos', conhecidos)

    // Tem gente dentro de novo: a contagem da carência recomeça do zero na
    // próxima vez que a sala esvaziar.
    await this.estado.storage.delete('vaziaDesde')

    this.enviar(ws, { tipo: 'bemvindo', id, credencial, rotulo, participantes, retomada })

    // Numa retomada ninguém viu essa pessoa sair, anunciar entrada criaria
    // uma cópia dela na lista dos outros.
    if (!retomada) {
      for (const outro of this.outros(ws)) {
        this.enviar(outro, { tipo: 'entrou', id, nome })
      }
    }

    await this.agendarVigia()  }

  async conhecidos () {
    return (await this.estado.storage.get('conhecidos')) || {}
  }

  // Desde quando a sala está vazia. Se ela está vazia e ninguém carimbou
  // nada, carimba AGORA em vez de tratar como abandonada: o objeto pode ser
  // reiniciado do nada, e nesse caso os avisos de fechamento não chegam a
  // rodar, ninguém escreve o carimbo, e a sala seria apagada debaixo de gente
  // que ainda está tentando voltar.
  async vaziaDesde () {
    const marca = await this.estado.storage.get('vaziaDesde')
    if (marca) return marca

    const agora = Date.now()
    await this.estado.storage.put('vaziaDesde', agora)
    return agora
  }

  // --- recolhimento de fantasma ----------------------------------------------

  async agendarVigia () {
    if ((await this.estado.storage.getAlarm()) === null) {
      await this.estado.storage.setAlarm(Date.now() + INTERVALO_VIGIA)
    }
  }

  async alarm () {
    // O vigia é manutenção: se ele falhar, tenta de novo no próximo ciclo em
    // vez de deixar a sala sem alarme nenhum, que é o que a faria nunca mais
    // ser recolhida.
    try {
      await this.vigiar()
    } catch (erro) {
      console.error(`falha no vigia: ${erro.message}`)
      await this.estado.storage.setAlarm(Date.now() + INTERVALO_VIGIA)
    }
  }

  async vigiar () {
    const agora = Date.now()

    for (const ws of this.todos()) {
      const d = this.dados(ws)
      if (!d) continue

      // O ping do cliente é respondido pelo runtime sem acordar este objeto,
      // então o carimbo do auto-response é a única pista de vida que existe.
      const carimbo = this.estado.getWebSocketAutoResponseTimestamp(ws)
      const visto = carimbo ? carimbo.getTime() : (d.entrouEm || agora)

      if (agora - visto > JANELA_SILENCIO) {
        try { ws.close(4000, 'sem sinal de vida') } catch { /* já morreu */ }
        await this.sair(ws)
      }
    }

    if (this.quantos() > 0) {
      return this.estado.storage.setAlarm(Date.now() + INTERVALO_VIGIA)
    }

    // Sala vazia: o vigia continua só enquanto durar a carência, e a última
    // batida dele é a que apaga a sala. Depois disso nada mais é agendado,
    // o objeto some e para de custar.
    if (agora - (await this.vaziaDesde()) <= CARENCIA_VAZIA) {
      return this.estado.storage.setAlarm(Date.now() + INTERVALO_VIGIA)
    }

    await this.estado.storage.deleteAll()
  }

  repassar (ws, msg) {
    const meu = this.dados(ws)
    if (!meu) return

    for (const outro of this.outros(ws)) {
      const dele = this.dados(outro)
      if (dele && dele.id === msg.para) {
        return this.enviar(outro, { ...msg, de: meu.id })
      }
    }
  }

  anunciarEstado (ws, msg) {
    const meu = this.dados(ws)
    if (!meu) return

    meu.transmitindo = Boolean(msg.transmitindo)
    ws.serializeAttachment(meu)

    for (const outro of this.outros(ws)) {
      this.enviar(outro, { tipo: 'estado', de: meu.id, transmitindo: meu.transmitindo })
    }
  }

  async sair (ws) {
    const meu = this.dados(ws)
    if (!meu) return

    // Zera antes de avisar: close depois de error chamaria isto duas vezes.
    ws.serializeAttachment(null)

    for (const outro of this.outros(ws)) {
      this.enviar(outro, { tipo: 'saiu', id: meu.id })
    }

    const vazia = this.outros(ws).length === 0

    // Saiu o último: começa a carência em vez de apagar. Quem apaga de fato é
    // o alarme, depois de CARENCIA_VAZIA sem ninguém voltar.
    if (vazia) {
      await this.estado.storage.put('vaziaDesde', Date.now())
      await this.agendarVigia()
    }
  }

  // --- apoio -----------------------------------------------------------------

  quantos () {
    return this.todos().filter((ws) => this.dados(ws)).length
  }

  todos () {
    return this.estado.getWebSockets()
  }

  outros (ws) {
    return this.todos().filter((outro) => outro !== ws && this.dados(outro))
  }

  dados (ws) {
    try {
      return ws.deserializeAttachment()
    } catch {
      return null
    }
  }

  enviar (ws, msg) {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // Socket já morreu; o webSocketClose cuida da limpeza.
    }
  }
}
