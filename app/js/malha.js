// Malha WebRTC: uma conexão por par, negociação e o teto de qualidade de cada
// remetente.

'use strict'

function garantirPar (id) {
  if (pares.has(id)) return pares.get(id)

  const pc = new RTCPeerConnection(ICE)
  const par = {
    pc,
    // Desempate da perfect negotiation: em malha os dois lados podem ofertar ao
    // mesmo tempo. Comparando os ids, um lado sempre cede e o outro sempre
    // insiste - sem isso a negociacao trava em glare.
    polido: meuId < id,
    fazendoOferta: false,
    ignorandoOferta: false,
    remetentes: [],
    // Mesmo remetente indexado por tipo. Serve ao replaceTrack: um remetente
    // que teve a trilha trocada por null nao tem mais kind para ser achado.
    remetentePorTipo: new Map(),
    // O remetente da MINHA webcam para este par. Fica fora das duas listas
    // acima, que sao so da tela (ver adicionarCamera(), em camera.js).
    remetenteCamera: null,
    // Tipos de candidato ICE que este par juntou. E o que diz POR QUE a
    // conexao falhou: sem srflx, o STUN nao respondeu; com srflx dos dois
    // lados e ainda assim falha, e NAT simetrico e so o TURN resolve.
    candidatos: { host: 0, srflx: 0, prflx: 0, relay: 0 },
    // Ja chegou a conectar alguma vez. Par que conectou direto e depois caiu
    // NAO e NAT simetrico: o caminho existia, foi a rede (ou o PC) que parou.
    jaConectou: false,
    // O teto que ESTE amigo pediu para receber. null = manda como esta.
    qualidadePedida: null
  }
  pares.set(id, par)

  pc.onnegotiationneeded = async () => {
    try {
      par.fazendoOferta = true
      await pc.setLocalDescription()
      enviar({ tipo: 'sdp', para: id, descricao: pc.localDescription })
    } catch (erro) {
      console.error('[negociacao]', erro)
    } finally {
      par.fazendoOferta = false
    }
  }

  pc.onicecandidate = ({ candidate }) => {
    if (!candidate) {
      // null = acabou de juntar candidatos. Hora de registrar o que saiu.
      const c = par.candidatos
      // So os numeros aqui. Interpretar srflx=0 como "STUN falhou" seria
      // alarme falso numa conexao de rede local, onde ele nao existe mesmo.
      anotar(`par ${id.slice(0, 8)}: candidatos host=${c.host} srflx=${c.srflx} relay=${c.relay}`)
      return
    }
    if (par.candidatos[candidate.type] !== undefined) par.candidatos[candidate.type]++
    enviar({ tipo: 'ice', para: id, candidato: candidate })
  }

  pc.ontrack = ({ track, streams }) => {
    const stream = streams[0]
    if (!stream) return

    // Tela ou webcam? As duas chegam como video nesta mesma conexao, e o que
    // separa e o id do stream: a pessoa anuncia qual e o da webcam dela. O
    // aviso sai antes das trilhas e passa pelo mesmo socket, entao ja esta
    // aqui. Se nao estiver (cliente antigo), cai como tela e o aviso, quando
    // vier, move para o lugar certo.
    const dono = participantes.get(id)
    const daCamera = Boolean(dono && dono.camera && dono.camera === stream.id)
    if (daCamera) camerasRecebidas.set(id, stream)
    else streamsRecebidos.set(id, stream)

    // O card so existe para quem esta transmitindo, e o video pode chegar
    // antes do aviso, entao a grade e refeita aqui.
    sincronizarGrade()
    aplicarVideo(id)

    // Transmissao nova, remetentes novos do outro lado: o teto que eu pedi
    // precisa ser dito outra vez, senao volta calado para a qualidade cheia.
    // So para a tela: a webcam tem teto fixo, de quem manda.
    if (!daCamera && (qualidadePorId.has(id) || !estouAssistindo(id))) pedirQualidade(id)

    // Rede de seguranca para o quadro congelado: se o aviso de "parei" nao
    // chegar, os proprios eventos da trilha limpam a tela.
    if (track.kind === 'video') {
      // Decide na hora do evento, e nao agora: o stream pode ter sido movido
      // de tela para webcam depois. E so limpa se ESTE stream ainda for o que
      // esta em uso: o fim da webcam nao pode apagar a tela da pessoa.
      const limpar = () => {
        if (camerasRecebidas.get(id) === stream) limparCamera(id)
        else if (streamsRecebidos.get(id) === stream) limparVideo(id)
      }

      track.addEventListener('ended', limpar)

      // 'mute' tambem acontece num solucinho de RTP, e nao so quando a pessoa
      // para de verdade: trocar a fonte no ar (replaceTrack) pode causar um.
      // Limpar na hora prendia o card em "conectando" ate a pessoa reiniciar a
      // transmissao, porque quem limpa descarta o stream junto. Entao espera
      // para ver se volta, e 'unmute' cancela a espera.
      let sumindo = null
      track.addEventListener('mute', () => {
        clearTimeout(sumindo)
        // Sem imagem porque EU pedi para nao receber (ainda nao cliquei para
        // assistir): nao e o fim da transmissao. Limpar aqui descartaria o
        // stream, e o clique em "Assistir" nao traria a imagem de volta.
        if (!daCamera && !estouAssistindo(id)) return
        sumindo = setTimeout(limpar, ESPERA_ANTES_DE_LIMPAR)
      })
      track.addEventListener('unmute', () => clearTimeout(sumindo))
    }
  }

  pc.onconnectionstatechange = () => {
    const estado = pc.connectionState
    escreverEstado(id, estado)
    anotar(`par ${id.slice(0, 8)}: ${estado}`)

    if (estado === 'connected') {
      par.jaConectou = true
      // So da para mexer nos parametros depois que a transceiver negociou.
      for (const remetente of par.remetentes) aplicarQualidade(par, remetente)
      limitarCamera(par)
      registrarCaminho(id, pc)
    }
    if (estado === 'failed') {
      const c = par.candidatos
      // Caiu TODO mundo no mesmo segundo (log de 05/11/2026, 4 pares): isso
      // e a rede de quem anota parando, nao NAT. A mensagem de TURN ali
      // mandava procurar no lugar errado.
      anotar(`par ${id.slice(0, 8)} FALHOU: host=${c.host} srflx=${c.srflx} relay=${c.relay}. ` +
        (par.jaConectou
          ? 'Ja tinha conectado: a conexao caiu (rede saturada, internet oscilando ou PC travado), nao e NAT.'
          : c.relay === 0
            ? 'Sem TURN configurado: se os dois lados estao atras de NAT simetrico, nao existe caminho direto.'
            : 'Nem pelo relay passou.'))
      pc.restartIce()
    }
    if (estado === 'disconnected' || estado === 'failed') {
      const card = cardDe(id)
      if (card) card.classList.remove('com-video')
    }
  }

  return par
}

// Por onde a midia esta passando de verdade. E o dado que separa "conectou
// direto" de "conectou pelo relay" e, quando nao conecta, mostra o que faltou.
async function registrarCaminho (id, pc) {
  try {
    const stats = await pc.getStats()
    let par = null
    const candidatos = new Map()

    stats.forEach((r) => {
      if (r.type === 'local-candidate' || r.type === 'remote-candidate') candidatos.set(r.id, r)
      if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) par = r
    })
    if (!par) return

    const local = candidatos.get(par.localCandidateId)
    const remoto = candidatos.get(par.remoteCandidateId)
    anotar(`par ${id.slice(0, 8)}: midia por ${local ? local.candidateType : '?'}` +
      ` -> ${remoto ? remoto.candidateType : '?'}` +
      (local && local.candidateType === 'relay' ? ' (passando por TURN)' : ' (direto)'))
  } catch (erro) {
    anotar(`par ${id.slice(0, 8)}: nao consegui ler as estatisticas: ${erro.message}`)
  }
}

// O ponto delicado do codigo. Mexer com cuidado.
async function receberSdp (id, descricao) {
  const par = garantirPar(id)
  const pc = par.pc

  const colisao = descricao.type === 'offer' &&
                  (par.fazendoOferta || pc.signalingState !== 'stable')

  // O impolido ignora a oferta do outro e mantem a sua; o polido recua.
  par.ignorandoOferta = !par.polido && colisao
  if (par.ignorandoOferta) return

  try {
    await pc.setRemoteDescription(descricao)
    if (descricao.type === 'offer') {
      await pc.setLocalDescription()
      enviar({ tipo: 'sdp', para: id, descricao: pc.localDescription })
    }
  } catch (erro) {
    console.error('[sdp]', erro)
  }
}

async function receberIce (id, candidato) {
  const par = garantirPar(id)
  try {
    await par.pc.addIceCandidate(candidato)
  } catch (erro) {
    // Candidato orfao de uma oferta ignorada e esperado; o resto nao e.
    if (!par.ignorandoOferta) console.error('[ice]', erro)
  }
}

function adicionarTrilhas (par) {
  if (!streamLocal) return
  for (const trilha of streamLocal.getTracks()) {
    const remetente = par.pc.addTrack(trilha, streamLocal)
    par.remetentes.push(remetente)
    par.remetentePorTipo.set(trilha.kind, remetente)
    // Aplicar aqui tambem, e nao so no 'connected': quando a transmissao
    // comeca com o par JA conectado, aquele evento nao dispara de novo, e o
    // teto ficava sem ser aplicado, calado.
    aplicarQualidade(par, remetente)
  }
}

// Tudo o que eu estou mandando, para um par que acabou de aparecer (alguem
// entrou, ou eu reconectei): a tela e a webcam, o que houver.
function adicionarMidia (par) {
  adicionarTrilhas(par)
  adicionarCamera(par)
}

// Aplica, SO NESTE par, o teto que aquele amigo pediu.
//
// Em malha cada amigo tem a sua conexao, e o codificador vive do lado de quem
// transmite, cada conexao codifica separado. E por isso que um pedir 720p nao
// muda nada para os outros: e outro codificador. Medido com duas conexoes
// reais saindo de uma captura 1280x720: uma entregou 1280x720 e a outra
// 640x360 ao mesmo tempo.
//
// Em FILA, por remetente: duas chamadas quase juntas (o comeco da
// transmissao e o pedido do amigo chegando logo depois) faziam o segundo
// setParameters ser recusado enquanto o primeiro nao terminava, e o envio
// ficava com o valor do primeiro. Medido no test/assistir.js: o amigo pedia
// para assistir e o envio continuava desligado. Cada chamada le o estado do
// par na HORA de aplicar, entao a ultima palavra e sempre a do pedido mais
// recente.
function aplicarQualidade (par, remetente) {
  const anterior = filaDeParametros.get(remetente) || Promise.resolve()
  const proxima = anterior.then(() => aplicarQualidadeAgora(par, remetente))
  filaDeParametros.set(remetente, proxima)
  return proxima
}

const filaDeParametros = new WeakMap()

async function aplicarQualidadeAgora (par, remetente) {
  if (!remetente.track) return

  // Quem pediu para assistir so com um clique e ainda nao clicou nao recebe
  // nada da minha tela, nem o som dela: e banda a menos no meu upload
  // (assistir.js). Pedido sem o campo, de app antigo, vale como assistindo.
  const ativo = par.assistindo !== false
  if (remetente.track.kind !== 'video') {
    return definirParametros(remetente, (params) => { params.encodings[0].active = ativo })
  }

  const fonte = remetente.track.getSettings() || {}
  const alturaFonte = fonte.height || qualidadeLocal.altura
  const fpsFonte = Math.round(fonte.frameRate || qualidadeLocal.fps)

  const pedido = par.qualidadePedida || {}

  // Teto, nunca aumento: nao da para inventar pixel que a captura nao gerou.
  // Quem assiste pedindo 1440p de uma fonte 720p continua recebendo 720p.
  const altura = Math.min(pedido.altura || alturaFonte, alturaFonte)
  const fps = Math.min(pedido.fps || fpsFonte, fpsFonte)

  return definirParametros(remetente, (params) => {
    params.encodings[0].scaleResolutionDownBy = Math.max(1, alturaFonte / altura)
    params.encodings[0].maxFramerate = fps
    params.encodings[0].maxBitrate = bitrateDe(altura, fps)
    params.encodings[0].active = ativo
    params.degradationPreference = 'maintain-framerate'
  })
}

// getParameters, ajusta e setParameters, tentando de novo se a negociacao
// mudou os parametros no meio. Acontece com remetente recem-criado: o pedido
// do amigo chega enquanto a trilha ainda esta sendo negociada, e o
// setParameters recusa com "modified RTCP parameters" (medido no
// test/assistir.js). Relendo depois de um instante, passa.
async function definirParametros (remetente, ajustar) {
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    try {
      const params = remetente.getParameters()
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
      ajustar(params)
      await remetente.setParameters(params)
      return
    } catch (erro) {
      const passageiro = erro.name === 'InvalidModificationError' || erro.name === 'InvalidStateError'
      if (!passageiro || tentativa === 5 || !remetente.track) {
        console.warn(`[qualidade] nao consegui aplicar: ${erro.name}: ${erro.message}`)
        return
      }
      await new Promise((resolver) => setTimeout(resolver, 200 * tentativa))
    }
  }
}