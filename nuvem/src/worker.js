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

// Amigos (código de amigo, presença, pedido para entrar): arquivo próprio.
import { Pessoa, Etiqueta, idDoSegredo } from './amigos.js'
import { Porteiro } from './porteiro.js'
import { paginaDeEntrar } from './pagina.js'
export { Pessoa, Etiqueta, Porteiro }

// O segredo de cada pessoa, sorteado no app: 32 caracteres do alfabeto do
// código da sala (~158 bits). Quem tem o segredo É a pessoa.
const FORMATO_DO_SEGREDO = /^[a-z0-9]{32}$/

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

// Carência de quem CAI. A conexão com a Cloudflare cai sozinha de tempos em
// tempos (1006), e o webSocketClose chegava aqui na hora: a sala inteira
// recebia 'saiu', derrubava a conexão de vídeo com a pessoa, e quando ela
// voltava 1,4 s depois (registro de 20/11/2026) tudo era remontado do zero,
// com o card sumindo e voltando. A mídia é P2P e não tinha caído.
//
// Agora a queda fica calada por este tempo: a pessoa vira AUSENTE, e se voltar
// com a credencial é uma retomada, ninguém vê nada. Só depois disso a saída é
// anunciada. Quem sai de propósito manda 'sair' antes de fechar e sai na hora.
// 20 s cobrem as quatro primeiras tentativas do app (1, 2, 4 e 8 s de espera).
const CARENCIA_QUEDA = 20000

// O que chega para quem esta ausente (SDP, ICE, pedido de qualidade, aviso de
// estado) fica guardado e e entregue na volta. Sem isso, alguem que comecasse
// a transmitir naquele segundo mandaria a oferta para o vazio, e a conexao
// dos dois ficaria travada esperando uma resposta que nunca vem. O teto e
// folgado: o comeco de uma transmissao sao algumas dezenas de mensagens.
const FILA_MAXIMA = 300
// E um teto de TAMANHO: cada mensagem pode ter ate 64 KB (uma foto), e 300
// delas passavam muito do maximo de um valor no armazenamento. A gravacao
// estourava e a fila parava de vez. ~1 MB de folga sobra para o comeco de
// uma transmissao (SDP e ICE sao poucos KB).
const FILA_MAXIMA_CARACTERES = 1000000

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

// Expulsar e banir (2.1.0, pedido do dono): o DONO (quem criou) tira na
// hora; sem o dono na sala, os outros votam (maioria de quem esta dentro,
// menos o alvo, em 60 s). A identidade e um resumo que o app manda, um por
// sala, e e ela que o banimento lembra. Quem apaga os dados do app vira
// outra identidade: o dono aceitou isso (nao quis trocar o codigo junto).
const VALIDADE_VOTACAO = 60000

function identidadeValida (valor) {
  return typeof valor === 'string' && /^[0-9a-f]{64}$/.test(valor) ? valor : ''
}

function votosPrecisos (eleitores) {
  return Math.floor(eleitores / 2) + 1
}

function textoDaEspera (ms) {
  const minutos = Math.max(1, Math.ceil(ms / 60000))
  return `muitos códigos errados. Tente de novo em ${minutos === 1 ? '1 minuto' : minutos + ' minutos'}`
}

// O codigo vem no caminho, e um "%" quebrado ("/sala/%E0") estourava o
// decodeURIComponent: a requisicao virava erro 500 em vez de recusa.
function decodificar (texto) {
  try { return decodeURIComponent(texto) } catch { return '' }
}

function limpar (texto, tamanho) {
  return String(texto || '').trim().slice(0, tamanho)
}

// A webcam e um segundo video na mesma conexao, e quem recebe so sabe qual dos
// dois e a webcam porque o dono avisa o id do stream dela. O valor e repassado
// para a sala inteira e guardado para quem entrar depois, entao so passa o que
// tem cara de id de MediaStream. Qualquer outra coisa vira "sem camera".
function cameraValida (valor) {
  return typeof valor === 'string' && /^[\w{}-]{1,64}$/.test(valor) ? valor : ''
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

    // O link da sala para o Discord (pagina.js): o codigo vem depois do "#",
    // e por isso nem chega aqui.
    if (partes.length === 1 && partes[0] === 'entrar' && requisicao.method === 'GET') {
      return paginaDeEntrar()
    }

    // Amigos: /amigos/<segredo>. O objeto é nomeado pelo HASH do segredo,
    // que é o id que os amigos guardam; o segredo em si nunca sai do PC
    // de quem o sorteou, a não ser para este endereço.
    if (partes[0] === 'amigos') {
      if (requisicao.headers.get('Upgrade') !== 'websocket') {
        return new Response('esperava um WebSocket', { status: 426 })
      }
      const segredo = partes[1] || ''
      if (!FORMATO_DO_SEGREDO.test(segredo)) return new Response('segredo inválido', { status: 400 })
      const origem = requisicao.headers.get('CF-Connecting-IP') || 'desconhecida'
      const { success } = await ambiente.LIMITE_ENTRADA.limit({ key: 'amigos:' + origem })
      if (!success) return new Response('muitas tentativas, espere um pouco', { status: 429 })
      const id = await idDoSegredo(segredo)
      return ambiente.PESSOA.get(ambiente.PESSOA.idFromName(id)).fetch(requisicao)
    }

    if (partes[0] !== 'sala' || !partes[1]) {
      return new Response('use /sala/<codigo>', { status: 404 })
    }

    if (requisicao.headers.get('Upgrade') !== 'websocket') {
      return new Response('esperava um WebSocket', { status: 426 })
    }

    // O código diferencia maiúscula de minúscula: é segredo, não apelido.
    const codigo = limpar(decodificar(partes[1]), 60)
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
    // De onde veio cada socket, para o porteiro (codigo errado, porteiro.js).
    // Na memoria: entre abrir o socket e mandar o 'entrar' o objeto nao
    // chega a hibernar; se hibernar, a conta cai na origem 'desconhecida'.
    this.origem = new WeakMap()

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
    this.origem.set(doServidor, requisicao.headers.get('CF-Connecting-IP') || 'desconhecida')

    // Guarda o próprio código para o `abrir` conferir o tamanho mínimo.
    //
    // NÃO é sobra do diretório removido. Uma revisão de segurança o marcou
    // como código morto; apagar reabriria a criação de sala com código curto
    // ("132"), que é exatamente o que o piso existe para barrar. O que era
    // sobra de verdade (a rota /quantos e o put('codigo')) já saiu.
    this.codigo = limpar(
      decodificar(new URL(requisicao.url).pathname.split('/').filter(Boolean)[1] || ''), 60
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
    // JSON valido nao e o mesmo que objeto: "null", "1" ou "[]" estouravam
    // no msg.tipo, e o bloco de erro, lendo msg.tipo de novo, estourava
    // outra vez, sem tratamento (achado atacando o Worker com lixo).
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.tipo !== 'string') {
      return this.enviar(ws, { tipo: 'erro', motivo: 'mensagem inválida' })
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
      case 'qualidade':
      // A foto de perfil de quem manda, para uma pessoa (o app comprime para
      // ~16 KB). So repassa: nao fica guardada em lugar nenhum, a nao ser na
      // fila de quem caiu, que some na volta ou na saida.
      case 'foto': return this.repassar(ws, msg)
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
      // Saída de propósito: anuncia na hora, sem a carência de quem cai.
      case 'sair': return this.sair(ws)
      case 'expulsar': return this.expulsar(ws, msg)
      case 'votar-expulsao': return this.comecarVotacao(ws, msg)
      case 'voto': return this.votar(ws, msg)
      default:
        return this.enviar(ws, { tipo: 'erro', motivo: `tipo desconhecido: ${msg.tipo}` })
    }
  }

  // Fechou sem 'sair' antes: e queda, nao despedida.
  async webSocketClose (ws) { await this.ausentar(ws) }
  async webSocketError (ws) { await this.ausentar(ws) }

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
    // Quem cria e o dono. Sem identidade (app antigo), a sala fica sem dono,
    // e tirar alguem e sempre por votacao.
    await this.estado.storage.put('dono', identidadeValida(msg.identidade))

    await this.acomodar(ws, nome, rotulo, null, identidadeValida(msg.identidade))
  }

  async entrar (ws, msg) {
    if (this.dados(ws)) return

    const nome = limpar(msg.nome, 32)
    if (!nome) {
      return this.enviar(ws, { tipo: 'erro', motivo: 'seu nome é obrigatório' })
    }

    // Cinco codigos errados seguidos do mesmo IP: cinco minutos de espera
    // (porteiro.js, pedido do dono). Vale ate para o codigo certo.
    const porteiro = this.porteiroDe(ws)
    const espera = await porteiro.espera()
    if (espera > 0) return this.enviar(ws, { tipo: 'erro', motivo: textoDaEspera(espera), espera })

    const rotulo = await this.estado.storage.get('rotulo')
    if (!rotulo) return this.codigoErrado(ws, porteiro)

    // Sala vazia pode ser uma sala em carência, esperando todo mundo voltar
    // de uma queda. Só é entulho depois que a carência vence.
    if (this.quantos() === 0 && Date.now() - (await this.vaziaDesde()) > CARENCIA_VAZIA) {
      await this.estado.storage.deleteAll()
      return this.codigoErrado(ws, porteiro)
    }

    const identidade = identidadeValida(msg.identidade)
    if (identidade && (await this.banidos()).includes(identidade)) {
      return this.enviar(ws, { tipo: 'erro', motivo: 'você não pode mais entrar nessa sala' })
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
      let camera = ''

      // Ou ele caiu ha pouco e ainda esta na carencia: tambem ninguem viu.
      const ausentes = await this.ausentes()
      const ausente = ausentes[conhecido.id]
      let novatos = []

      if (velho) {
        const antigos = this.dados(velho)
        retomada = true
        transmitindo = Boolean(antigos && antigos.transmitindo)
        camera = (antigos && antigos.camera) || ''
        velho.serializeAttachment(null)
        try { velho.close(4001, 'substituído pela reconexão') } catch { /* já morreu */ }
      } else if (ausente) {
        retomada = true
        transmitindo = Boolean(ausente.transmitindo)
        camera = ausente.camera || ''
        // Quem entrou enquanto ele estava fora nunca o viu: para esses, ele
        // e uma entrada normal.
        novatos = this.outros(ws).filter((outro) => {
          const d = this.dados(outro)
          return d && (d.entrouEm || 0) > ausente.desde
        })
      }
      if (ausente) {
        delete ausentes[conhecido.id]
        await this.estado.storage.put('ausentes', ausentes)
      }

      await this.acomodar(ws, conhecido.nome, rotulo, {
        id: conhecido.id, credencial, retomada, transmitindo, camera, novatos
      }, identidade)
      if (ausente) await this.entregarFila(ws, conhecido.id)
      return
    }

    // Dois "Gabriel" na mesma sala viram confusão: os cards ficam iguais e
    // ninguém sabe quem está transmitindo.
    if (this.nomeOcupado(ws, nome) || await this.nomeDeAusente(nome)) {
      return this.enviar(ws, { tipo: 'erro', motivo: `já tem alguém chamado "${nome}" nessa sala` })
    }

    await this.acomodar(ws, nome, rotulo, null, identidade)
  }

  porteiroDe (ws) {
    const origem = this.origem.get(ws) || 'desconhecida'
    return this.ambiente.PORTEIRO.get(this.ambiente.PORTEIRO.idFromName(origem))
  }

  async codigoErrado (ws, porteiro) {
    const { espera, restam } = await porteiro.errou()
    if (espera > 0) return this.enviar(ws, { tipo: 'erro', motivo: textoDaEspera(espera), espera })
    return this.enviar(ws, {
      tipo: 'erro',
      motivo: `código não corresponde a nenhuma sala aberta (${restam === 1 ? 'resta 1 tentativa' : `restam ${restam} tentativas`})`,
      restam
    })
  }

  nomeOcupado (ws, nome) {
    const alvo = nome.toLowerCase()
    return this.outros(ws).some((outro) => {
      const d = this.dados(outro)
      return d && (d.nome || '').toLowerCase() === alvo
    })
  }

  // Quem caiu e ainda esta na carencia guarda o nome: senao outro pegaria o
  // nome dele e, na volta, a sala teria dois iguais.
  async nomeDeAusente (nome) {
    const alvo = nome.toLowerCase()
    return Object.values(await this.ausentes()).some((a) => (a.nome || '').toLowerCase() === alvo)
  }

  // Parte comum de criar e entrar: registra o participante e avisa os outros.
  async acomodar (ws, nome, rotulo, retorno = null, identidade = '') {
    const id = retorno ? retorno.id : crypto.randomUUID()
    const credencial = retorno ? retorno.credencial : crypto.randomUUID()
    const retomada = Boolean(retorno && retorno.retomada)
    const transmitindo = Boolean(retorno && retorno.transmitindo)
    const camera = (retorno && retorno.camera) || ''

    const participantes = this.outros(ws).map((outro) => {
      const d = this.dados(outro)
      return { id: d.id, nome: d.nome, transmitindo: d.transmitindo, camera: d.camera || '' }
    })

    // entrouEm existe para o alarme: quem acabou de chegar ainda não pingou
    // nenhuma vez, e não pode ser recolhido por causa disso.
    ws.serializeAttachment({ id, nome, credencial, transmitindo, camera, identidade, entrouEm: Date.now() })
    const dono = await this.estado.storage.get('dono')
    const souDono = Boolean(dono && identidade === dono)
    const outroDono = souDono ? null : this.outros(ws).find((outro) => {
      const d = this.dados(outro)
      return dono && d && d.identidade === dono
    })

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

    this.enviar(ws, {
      tipo: 'bemvindo', id, credencial, rotulo, participantes, retomada,
      souDono, dono: souDono ? id : (outroDono ? this.dados(outroDono).id : '')
    })

    // Numa retomada ninguém viu essa pessoa sair, anunciar entrada criaria
    // uma cópia dela na lista dos outros.
    // Para quem chegou durante a ausencia dele, porem, e entrada de verdade.
    const avisar = retomada ? ((retorno && retorno.novatos) || []) : this.outros(ws)
    for (const outro of avisar) {
      this.enviar(outro, { tipo: 'entrou', id, nome, dono: souDono })
    }
    // Voltou o dono: a votacao que estivesse correndo perde o sentido.
    if (souDono && await this.estado.storage.get('votacao')) await this.encerrarVotacao('dono')

    await this.agendarVigia()

    // Entrou: a conta de codigos errados daquele IP zera. POR ULTIMO, depois
    // do 'bemvindo': chamar outro objeto deixa outras mensagens entrarem no
    // meio, e um SDP de alguem chegaria a quem ainda nem sabe o proprio id.
    try { await this.porteiroDe(ws).acertou() } catch { /* so manutencao */ }
  }

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

  // Quem caiu sem se despedir. Sai da lista de sockets (o socket morreu), mas
  // a saida so e anunciada pelo alarme, depois de CARENCIA_QUEDA.
  async ausentes () {
    return (await this.estado.storage.get('ausentes')) || {}
  }

  async ausentar (ws) {
    const meu = this.dados(ws)
    if (!meu) return
    ws.serializeAttachment(null)

    const ausentes = await this.ausentes()
    ausentes[meu.id] = {
      nome: meu.nome, transmitindo: meu.transmitindo, camera: meu.camera || '',
      identidade: meu.identidade || '', desde: Date.now()
    }
    await this.estado.storage.put('ausentes', ausentes)

    if (this.quantos() === 0) await this.estado.storage.put('vaziaDesde', Date.now())
    await this.agendarAte(Date.now() + CARENCIA_QUEDA)
  }

  // Adianta o alarme se ele estiver marcado para depois de `quando`.
  async agendarAte (quando) {
    const marcado = await this.estado.storage.getAlarm()
    if (marcado === null || marcado > quando) await this.estado.storage.setAlarm(quando)
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

    // A carencia de quem caiu venceu: agora sim, a sala fica sabendo.
    const ausentes = await this.ausentes()
    let proximo = Infinity
    let mudou = false
    for (const [id, a] of Object.entries(ausentes)) {
      if (agora - a.desde >= CARENCIA_QUEDA) {
        delete ausentes[id]
        await this.estado.storage.delete(`fila:${id}`)
        mudou = true
        for (const outro of this.todos()) {
          if (this.dados(outro)) this.enviar(outro, { tipo: 'saiu', id })
        }
      } else {
        proximo = Math.min(proximo, a.desde + CARENCIA_QUEDA)
      }
    }
    if (mudou) await this.estado.storage.put('ausentes', ausentes)

    const votacao = await this.estado.storage.get('votacao')
    if (votacao) {
      if (agora >= votacao.ate) await this.encerrarVotacao('expirou')
      else proximo = Math.min(proximo, votacao.ate)
    }

    if (this.quantos() > 0 || proximo !== Infinity) {
      return this.estado.storage.setAlarm(Math.min(Date.now() + INTERVALO_VIGIA, proximo))
    }

    // Sala vazia: o vigia continua só enquanto durar a carência, e a última
    // batida dele é a que apaga a sala. Depois disso nada mais é agendado,
    // o objeto some e para de custar.
    if (agora - (await this.vaziaDesde()) <= CARENCIA_VAZIA) {
      return this.estado.storage.setAlarm(Date.now() + INTERVALO_VIGIA)
    }

    await this.estado.storage.deleteAll()
  }

  async repassar (ws, msg) {
    const meu = this.dados(ws)
    if (!meu) return

    for (const outro of this.outros(ws)) {
      const dele = this.dados(outro)
      if (dele && dele.id === msg.para) {
        return this.enviar(outro, { ...msg, de: meu.id })
      }
    }

    // Nao esta conectado agora: se caiu ha pouco, guarda para a volta.
    if (typeof msg.para === 'string' && (await this.ausentes())[msg.para]) {
      await this.guardarPara(msg.para, { ...msg, de: meu.id })
    }
  }

  async anunciarEstado (ws, msg) {
    const meu = this.dados(ws)
    if (!meu) return

    meu.transmitindo = Boolean(msg.transmitindo)
    meu.camera = cameraValida(msg.camera)
    ws.serializeAttachment(meu)

    const aviso = { tipo: 'estado', de: meu.id, transmitindo: meu.transmitindo, camera: meu.camera }
    for (const outro of this.outros(ws)) this.enviar(outro, aviso)
    for (const id of Object.keys(await this.ausentes())) await this.guardarPara(id, aviso)
  }

  async guardarPara (id, msg) {
    const chave = `fila:${id}`
    const fila = (await this.estado.storage.get(chave)) || []
    if (fila.length >= FILA_MAXIMA) return
    fila.push(msg)
    if (JSON.stringify(fila).length > FILA_MAXIMA_CARACTERES) return
    await this.estado.storage.put(chave, fila)
  }

  // Entrega, na ordem, o que chegou durante a ausencia. Vai DEPOIS do
  // 'bemvindo': o cliente precisa saber que voltou antes de negociar.
  async entregarFila (ws, id) {
    const chave = `fila:${id}`
    const fila = (await this.estado.storage.get(chave)) || []
    await this.estado.storage.delete(chave)
    // So o que veio de quem continua na sala: SDP de quem ja saiu criaria, do
    // outro lado, uma conexao com ninguem.
    const presentes = new Set(this.outros(ws).map((outro) => this.dados(outro).id))
    for (const msg of fila) {
      if (presentes.has(msg.de)) this.enviar(ws, msg)
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
    if (await this.estado.storage.get('votacao')) await this.contarVotos()

    const vazia = this.outros(ws).length === 0

    // Saiu o último: começa a carência em vez de apagar. Quem apaga de fato é
    // o alarme, depois de CARENCIA_VAZIA sem ninguém voltar.
    if (vazia) {
      await this.estado.storage.put('vaziaDesde', Date.now())
      await this.agendarVigia()
    }
  }

  // --- expulsar e banir --------------------------------------------------------

  async banidos () {
    return (await this.estado.storage.get('banidos')) || []
  }

  // O dono conta como presente tambem na carencia de queda: cair por dois
  // segundos nao abre votacao para tirar alguem.
  async donoPresente () {
    const dono = await this.estado.storage.get('dono')
    if (!dono) return false
    const conectado = this.todos().some((ws) => {
      const d = this.dados(ws)
      return d && d.identidade === dono
    })
    return conectado || Object.values(await this.ausentes()).some((a) => a.identidade === dono)
  }

  socketDe (id) {
    return this.todos().find((ws) => {
      const d = this.dados(ws)
      return d && d.id === id
    })
  }

  async expulsar (ws, msg) {
    const meu = this.dados(ws)
    if (!meu) return
    const dono = await this.estado.storage.get('dono')
    if (!dono || meu.identidade !== dono) return this.enviar(ws, { tipo: 'erro', motivo: 'só o dono da sala pode tirar alguém' })
    const alvo = this.socketDe(msg.alvo)
    if (!alvo || alvo === ws) return
    await this.remover(alvo, Boolean(msg.banir))
  }

  async comecarVotacao (ws, msg) {
    const meu = this.dados(ws)
    if (!meu) return
    if (await this.donoPresente()) return this.enviar(ws, { tipo: 'erro', motivo: 'o dono da sala está aqui, só ele pode tirar alguém' })
    if (await this.estado.storage.get('votacao')) return this.enviar(ws, { tipo: 'erro', motivo: 'já tem uma votação acontecendo' })
    const alvo = this.socketDe(msg.alvo)
    if (!alvo || alvo === ws) return
    const ate = Date.now() + VALIDADE_VOTACAO
    await this.estado.storage.put('votacao', {
      alvo: msg.alvo, banir: Boolean(msg.banir), por: meu.id, sim: [meu.id], nao: [], ate
    })
    await this.agendarAte(ate)
    await this.contarVotos()
  }

  async votar (ws, msg) {
    const meu = this.dados(ws)
    const v = await this.estado.storage.get('votacao')
    if (!meu || !v || v.alvo !== msg.alvo || meu.id === v.alvo) return
    v.sim = v.sim.filter((id) => id !== meu.id)
    v.nao = v.nao.filter((id) => id !== meu.id)
    if (msg.sim) v.sim.push(meu.id)
    else v.nao.push(meu.id)
    await this.estado.storage.put('votacao', v)
    await this.contarVotos()
  }

  // Quem pode votar e quem esta conectado agora, menos o alvo. Passa com a
  // maioria; cai quando nao da mais para chegar nela.
  async contarVotos () {
    const v = await this.estado.storage.get('votacao')
    if (!v) return
    const alvo = this.socketDe(v.alvo)
    if (!alvo) return this.encerrarVotacao('saiu')
    const eleitores = this.todos().filter((ws) => {
      const d = this.dados(ws)
      return d && d.id !== v.alvo
    })
    const presentes = new Set(eleitores.map((ws) => this.dados(ws).id))
    v.sim = v.sim.filter((id) => presentes.has(id))
    v.nao = v.nao.filter((id) => presentes.has(id))
    await this.estado.storage.put('votacao', v)
    const precisa = votosPrecisos(eleitores.length)
    if (v.sim.length >= precisa) {
      await this.encerrarVotacao('aprovada')
      return this.remover(alvo, v.banir)
    }
    if (v.nao.length > eleitores.length - precisa) return this.encerrarVotacao('recusada')
    const aviso = {
      tipo: 'votacao', alvo: v.alvo, banir: v.banir, por: v.por,
      sim: v.sim.length, nao: v.nao.length, precisa, restam: Math.max(0, v.ate - Date.now())
    }
    for (const ws of eleitores) {
      const id = this.dados(ws).id
      this.enviar(ws, { ...aviso, meuVoto: v.sim.includes(id) ? 'sim' : v.nao.includes(id) ? 'nao' : '' })
    }
  }

  async encerrarVotacao (resultado) {
    const v = await this.estado.storage.get('votacao')
    if (!v) return
    await this.estado.storage.delete('votacao')
    for (const ws of this.todos()) {
      const d = this.dados(ws)
      if (d && d.id !== v.alvo) this.enviar(ws, { tipo: 'votacao-fim', alvo: v.alvo, banir: v.banir, resultado })
    }
  }

  // Tira da sala na hora, sem carencia: o anexo e zerado antes de fechar,
  // para o webSocketClose nao o tratar como queda; a credencial e
  // esquecida, para a reconexao automatica nao trazer de volta.
  async remover (alvo, banir) {
    const dele = this.dados(alvo)
    if (!dele) return
    if (banir && dele.identidade) {
      const banidos = await this.banidos()
      if (!banidos.includes(dele.identidade)) banidos.push(dele.identidade)
      await this.estado.storage.put('banidos', banidos.slice(-200))
    }
    const v = await this.estado.storage.get('votacao')
    if (v && v.alvo === dele.id) await this.encerrarVotacao('saiu')

    this.enviar(alvo, { tipo: 'removido', banido: banir })
    alvo.serializeAttachment(null)
    try { alvo.close(4003, banir ? 'banido' : 'removido') } catch { /* ja morreu */ }

    const conhecidos = await this.conhecidos()
    for (const [credencial, c] of Object.entries(conhecidos)) if (c.id === dele.id) delete conhecidos[credencial]
    await this.estado.storage.put('conhecidos', conhecidos)

    for (const outro of this.todos()) {
      if (this.dados(outro)) this.enviar(outro, { tipo: 'saiu', id: dele.id, removido: true, banido: banir })
    }
    if (this.quantos() === 0) {
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
