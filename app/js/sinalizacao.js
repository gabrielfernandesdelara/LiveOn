// Conversa com o servidor da sala: conexão, reconexão, batida de coração e o
// tratamento de cada mensagem.

'use strict'

function conectar ({ nome, codigo, rotulo, criando }) {
  sessao = { nome, codigo, rotulo, criando }
  saindoDeProposito = false
  tentativasDeReconexao = 0
  abrirSocket()
}

// O CODIGO vai no caminho: ele e o endereco da sala. Quem nao sabe o codigo
// nao alcanca o Durable Object, por isso a lista de busca nunca o mostra.
// O codigo e a chave da sala, e o log existe justamente para ser mandado para
// alguem quando algo da errado. Inteiro no log, quem visse o arquivo entrava
// na sala sem aparecer como intruso. Os 4 primeiros bastam para saber se dois
// logs sao da mesma sala; os 8 que sobram (31^8, ~40 bits) continuam fora de
// alcance contra 20 tentativas por minuto por IP no servidor.
function mascararCodigo (codigo) {
  const texto = String(codigo || '')
  return texto.slice(0, 4) + '*'.repeat(Math.max(0, texto.length - 4))
}

function enderecoDaSala () {
  return `${SERVIDOR}/sala/${encodeURIComponent(sessao.codigo.trim())}`
}

function abrirSocket () {
  // Descarta o socket anterior antes de abrir outro. Sem isto, o onclose
  // atrasado do antigo mexia na sessao nova, era o "reconectando" seguido
  // de uma copia do usuario na sala.
  if (ws) {
    ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
    try { ws.close() } catch { /* ja fechando */ }
  }

  let meu
  try {
    meu = new WebSocket(enderecoDaSala())
  } catch (erro) {
    return avisar('Endereço de servidor inválido: ' + erro.message)
  }
  ws = meu

  // Todo handler confere se ainda e o socket da vez.
  const meuTurno = () => ws === meu

  meu.onopen = () => {
    if (!meuTurno()) return
    tentativasDeReconexao = 0
    ultimaMensagem = Date.now()
    aguardandoEntrada = true
    iniciarVigia()

    // Cria so na primeira vez; numa reconexao a sala ja existe e o codigo
    // que temos guardado e o que vale.
    enviar({
      tipo: sessao.criando ? 'criar' : 'entrar',
      codigo: sessao.codigo,
      rotulo: sessao.rotulo,
      nome: sessao.nome,
      // Prova de que sou a mesma pessoa de antes: com ela eu volto com o
      // mesmo id, e o nome antigo nao me barra como "ja em uso".
      credencial: sessao.credencial
    })
    sessao.criando = false
  }

  meu.onmessage = (evento) => {
    if (!meuTurno()) return
    ultimaMensagem = Date.now()
    let msg
    try { msg = JSON.parse(evento.data) } catch { return }
    tratar(msg)
  }

  // O onclose sempre vem depois do onerror, entao o tratamento fica todo la.
  meu.onerror = () => {}

  meu.onclose = (evento) => {
    if (!meuTurno()) return
    pararVigia()

    // O codigo diz QUEM matou a conexao, e e o dado que resolve a maioria dos
    // misterios: 4000 = a batida do servidor desistiu; 1006 = queda anormal,
    // rede ou crash; 1001 = a pagina foi embora (renderer recarregou/morreu);
    // 1000 = fechamento normal.
    anotar(`websocket fechou: codigo=${evento.code} motivo="${evento.reason}" limpo=${evento.wasClean}`)

    if (saindoDeProposito) return voltarParaEntrada()

    // Nunca cheguei a entrar: e problema de endereco ou servidor fora do ar.
    if (!meuId) {
      avisar('Não consegui falar com o servidor. Confira sua internet.')
      return voltarParaEntrada()
    }

    tentarReconectar()
  }
}

function tentarReconectar () {
  if (tentativasDeReconexao >= MAX_TENTATIVAS) {
    avisar('Não consegui reconectar. Entre na sala de novo.')
    return voltarParaEntrada()
  }

  tentativasDeReconexao++

  // Espera crescente: 1s, 2s, 4s... ate 10s.
  const espera = Math.min(1000 * 2 ** (tentativasDeReconexao - 1), 10000)
  marcarConexao('ruim', `reconectando (${tentativasDeReconexao}/${MAX_TENTATIVAS})...`)

  clearTimeout(temporizadorReconexao)
  temporizadorReconexao = setTimeout(abrirSocket, espera)
}

// A batida de coracao parte do CLIENTE, nao do servidor. Na Cloudflare o
// objeto da sala hiberna entre mensagens: um ping vindo de la o acordaria a
// cada 15s, enquanto um ping vindo daqui e respondido pelo proprio runtime
// sem acordar nada.
function iniciarVigia () {
  pararVigia()

  batidaDoCliente = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) enviar({ tipo: 'ping' })
  }, 10000)

  // Vigia do silencio: o cliente descobrindo sozinho que morreu, em vez de
  // esperar o navegador perceber, o que pode demorar minutos.
  vigiaSilencio = setInterval(() => {
    if (Date.now() - ultimaMensagem < SILENCIO_LIMITE) return
    if (ws && ws.readyState === WebSocket.OPEN) ws.close()
  }, 5000)
}

function pararVigia () {
  clearInterval(vigiaSilencio)
  clearInterval(batidaDoCliente)
  vigiaSilencio = null
  batidaDoCliente = null
}

function marcarConexao (estado, texto) {
  const alvo = $('#rotulo-conexao')
  alvo.textContent = texto
  alvo.classList.toggle('ruim', estado === 'ruim')
  alvo.classList.toggle('oculto', !texto)
}

function enviar (msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

function tratar (msg) {
  switch (msg.tipo) {
    case 'ping':
      // A batida parte do cliente e nenhum servidor atual pergunta, mas
      // responder custa nada e nao quebra servidor antigo.
      enviar({ tipo: 'pong' })
      break

    case 'pong':
      // Resposta a nossa batida. O valor esta em ter chegado: o
      // ultimaMensagem ja foi atualizado por quem recebeu.
      break

    case 'bemvindo': {
      const reconectou = Boolean(meuId)
      aguardandoEntrada = false
      meuId = msg.id
      if (msg.credencial) sessao.credencial = msg.credencial

      if (msg.retomada) {
        // O servidor ainda tinha meu registro de pe: ninguem me viu sair, e
        // as conexoes de video do outro lado continuam vivas. Derrubar as
        // minhas aqui cortaria imagem que nao precisava ser cortada, a midia
        // e P2P e nao depende deste socket.
        const presentes = new Set(msg.participantes.map((p) => p.id))

        for (const id of [...participantes.keys()]) {
          if (presentes.has(id)) continue
          const par = pares.get(id)
          if (par) { par.pc.close(); pares.delete(id) }
          participantes.delete(id)
          streamsRecebidos.delete(id)
        }

        for (const p of msg.participantes) {
          const novo = !participantes.has(p.id)
          participantes.set(p.id, p)
          // Chegou enquanto eu estava fora: nunca recebeu minhas trilhas.
          if (novo && streamLocal) adicionarTrilhas(garantirPar(p.id))
        }
      } else {
        // Entrada de verdade: os outros me viram sair (ou nunca me viram).
        // Os pares antigos estao mortos, entao remonta a malha do zero.
        for (const par of pares.values()) par.pc.close()
        pares.clear()
        participantes.clear()
        for (const p of msg.participantes) participantes.set(p.id, p)
      }

      // Se eu estava no ar, volto no ar, sem o usuario ter que escolher a
      // fonte de novo.
      if (streamLocal) {
        if (!msg.retomada) {
          for (const id of participantes.keys()) adicionarTrilhas(garantirPar(id))
        }
        enviar({ tipo: 'estado', transmitindo: true })
      }

      rotuloDaSala = msg.rotulo || 'sala'
      anotar(`sala "${rotuloDaSala}" codigo=${mascararCodigo(sessao.codigo)}: entrei como ${meuId.slice(0, 8)}` +
        `${msg.retomada ? ' (retomada)' : ''}, ${msg.participantes.length} ja estavam la` +
        (msg.participantes.length
          ? ': ' + msg.participantes.map((p) => `${p.nome}/${p.id.slice(0, 8)}${p.transmitindo ? ' (no ar)' : ''}`).join(', ')
          : ''))
      marcarConexao('ok', '')
      if (reconectou) avisar('Reconectado.')
      mostrarSala(rotuloDaSala)
      break
    }

    case 'entrou': {
      anotar(`${msg.nome}/${msg.id.slice(0, 8)} entrou na sala`)
      participantes.set(msg.id, { id: msg.id, nome: msg.nome, transmitindo: false })
      // Se eu ja estou no ar, o recem-chegado precisa receber minhas trilhas.
      if (streamLocal) adicionarTrilhas(garantirPar(msg.id))
      sincronizarGrade()
      break
    }

    case 'saiu': {
      const quem = participantes.get(msg.id)
      anotar(`${quem ? quem.nome : '?'}/${msg.id.slice(0, 8)} saiu da sala`)
      const par = pares.get(msg.id)
      if (par) { par.pc.close(); pares.delete(msg.id) }
      streamsRecebidos.delete(msg.id)
      // qualidadePorId e volumePorId ficam de proposito: quem cai volta com o
      // MESMO id, e perder o volume ajustado de alguem toda vez que a internet
      // dela oscila e pior do que guardar uma entrada a toa. Some tudo junto
      // quando eu saio da sala.
      if (ajustesAbertos === msg.id) fecharAjustes()
      participantes.delete(msg.id)
      sincronizarGrade()
      break
    }

    case 'qualidade': {
      const par = pares.get(msg.de)
      if (!par) break
      // Negativo vira "sem pedido". Não quebraria nada (o setParameters
      // recusa e o erro é engolido), mas também não deixaria rastro útil.
      const altura = Math.max(0, Number(msg.altura) || 0)
      const fps = Math.max(0, Number(msg.fps) || 0)
      par.qualidadePedida = (altura || fps) ? { altura, fps } : null
      for (const remetente of par.remetentes) aplicarQualidade(par, remetente)
      anotar(`${msg.de.slice(0, 8)} pediu ${altura ? altura + 'p' : 'automatica'}${fps ? ' a ' + fps + ' fps' : ''}`)
      break
    }
    case 'sdp': receberSdp(msg.de, msg.descricao); break
    case 'ice': receberIce(msg.de, msg.candidato); break

    case 'estado': {
      const dele = participantes.get(msg.de)
      anotar(`${dele ? dele.nome : '?'}/${msg.de.slice(0, 8)} ` +
        (msg.transmitindo ? 'entrou no ar' : 'saiu do ar'))
      const p = participantes.get(msg.de)
      if (!p) break
      const comecouAgora = msg.transmitindo && !p.transmitindo
      p.transmitindo = msg.transmitindo

      // Aviso sonoro so na virada: quem ja estava no ar quando entrei nao
      // dispara nada, senao seria uma saraivada ao abrir a sala.
      if (comecouAgora) tocarAviso()

      // Sem isso o card fica congelado no ultimo quadro de quem parou.
      if (!msg.transmitindo) limparVideo(msg.de)
      sincronizarGrade()
      break
    }

    case 'erro':
      // No log tambem: quando a sala cai para todo mundo, a recusa do
      // servidor na volta e a unica linha que explica por que a sala sumiu.
      anotar(`servidor recusou: ${msg.motivo}`)
      avisar(msg.motivo)
      // Codigo errado, sala inexistente, nome ja usado: nao adianta insistir.
      // Vale tambem no meio de uma reconexao: sem isso o socket ficava aberto
      // sem nunca receber o 'bemvindo', e a tela congelava ate a vigia agir.
      if (!meuId || aguardandoEntrada) {
        saindoDeProposito = true
        if (ws) { try { ws.close() } catch { /* ja fechando */ } }
        voltarParaEntrada()
      }
      break
  }
}
