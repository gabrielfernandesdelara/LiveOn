// Captura de tela e o ciclo da minha transmissão: começar, ajustar no ar e
// parar.

'use strict'

// Captura de janela produz tamanho arbitrario, 1287x743 e coisa do tipo.
// Codificador H.264 quer largura e altura PARES, e dimensao impar e causa
// conhecida de problema no lado de quem recebe. Monitor inteiro nunca cai
// nisso, o que combina com o sintoma de so a janela dar problema.
async function ajustarDimensoes (video) {
  const atual = video.getSettings()
  anotar(`fonte capturada: ${atual.width}x${atual.height} @ ${atual.frameRate}fps`)

  if (!atual.width || !atual.height) return

  const largura = Math.floor(atual.width / 2) * 2
  const altura = Math.floor(atual.height / 2) * 2
  if (largura === atual.width && altura === atual.height) return

  try {
    await video.applyConstraints({ width: largura, height: altura })
    const depois = video.getSettings()
    anotar(`dimensao impar corrigida para ${depois.width}x${depois.height}`)
  } catch (erro) {
    anotar(`nao consegui ajustar a dimensao: ${erro.message}`)
  }
}

// Captura video e audio conforme o que o seletor escolheu, e devolve o stream
// pronto para entrar na malha.
//
// Esta parte e comum a COMECAR e a AJUSTAR uma transmissao. Estava dentro do
// iniciarTransmissao; saiu para ca porque duplicar o preparo seria garantia de
// um dos dois caminhos ganhar correcao que o outro nao recebe (a dimensao par,
// o contentHint, o 'ended' da barra do sistema).
//
// Estoura em vez de avisar: quem chamou decide o que dizer ao usuario.
async function capturarFonte (fonteId, configAudio, qualidade) {
  // So o modo "tudo" usa o loopback do Chromium. Os outros pegam o audio pelo
  // addon nativo, ou nao pegam audio nenhum.
  const usaLoopback = configAudio.modo === 'tudo'

  // Ordem importa: o processo principal precisa saber qual fonte foi escolhida
  // ANTES do getDisplayMedia, porque e o handler de la que responde ao pedido.
  const pedir = async (comLimites) => {
    await window.ponte.escolherFonte(fonteId, usaLoopback)
    return navigator.mediaDevices.getDisplayMedia({
      video: comLimites
        ? {
            width: { ideal: qualidade.largura },
            height: { ideal: qualidade.altura },
            frameRate: { ideal: qualidade.fps, max: qualidade.fps }
          }
        : true,
      // Precisa pedir audio aqui, senao o 'loopback' do main.js nao e entregue.
      audio: usaLoopback
    })
  }

  // Janela no Windows 10 de um amigo falhava toda vez com "Could not start
  // video source" (20/11/2026), e tela funcionava. Uma segunda tentativa, um
  // instante depois e sem limite de tamanho e fps (que viram limite no
  // capturador do Windows), antes de desistir. O tamanho e o fps sao
  // aplicados depois na trilha, se ela aceitar.
  let stream
  let semLimites = false
  try {
    stream = await pedir(true)
  } catch (erro) {
    anotarFalhaDeCaptura('primeira tentativa', fonteId, configAudio, erro)
    if (!String(fonteId).startsWith('window:')) throw erro
    await new Promise((resolver) => setTimeout(resolver, 500))
    stream = await pedir(false)
    semLimites = true
    anotar('captura de janela: a segunda tentativa, sem limites, funcionou')
  }

  if (semLimites) {
    try {
      await stream.getVideoTracks()[0].applyConstraints({
        width: { ideal: qualidade.largura },
        height: { ideal: qualidade.altura },
        frameRate: { ideal: qualidade.fps, max: qualidade.fps }
      })
    } catch (erro) {
      anotar(`a janela nao aceitou o tamanho e o fps: ${erro.message}`)
    }
  }

  const video = stream.getVideoTracks()[0]
  video.contentHint = 'motion'
  // Parar pela barra nativa do sistema, ou fechar a janela capturada.
  video.addEventListener('ended', pararTransmissao)

  await ajustarDimensoes(video)

  // Fecha a captura nativa anterior ANTES de abrir outra. No comeco isto e
  // inofensivo, nao ha nada aberto; no ajuste e obrigatorio, senao a escuta
  // antiga continua registrada e a nova escreve por cima dela.
  await pararTrilhaDeProcesso()

  const trilhas = [video]

  if (usaLoopback) {
    const audio = stream.getAudioTracks()
    if (audio.length === 0) {
      avisar('A fonte veio sem áudio.')
    }
    trilhas.push(...audio)
  } else if (configAudio.modo !== 'nenhum') {
    // Sem audio o video continua valendo, entao aqui a falha so avisa.
    try {
      const modoNativo = configAudio.modo === 'so-janela' ? 'incluir' : 'excluir'
      trilhas.push(await criarTrilhaDeProcesso(configAudio.pid, modoNativo))
    } catch (erro) {
      avisar('Transmitindo sem áudio: ' + erro.message)
    }
  }

  return new MediaStream(trilhas)
}

// O aviso some da tela em 6 s, e sem isto o registro so mostrava "captura
// concedida" sem nada depois. Vai o tipo da fonte e o erro inteiro, nunca o
// titulo da janela (o id e so o numero dela).
function anotarFalhaDeCaptura (quando, fonteId, configAudio, erro) {
  const tipo = String(fonteId).split(':')[0]
  const detalhe = erro && erro.constraint ? ` (limite: ${erro.constraint})` : ''
  anotar(`captura FALHOU na ${quando} (${tipo} ${fonteId}, audio ${configAudio && configAudio.modo}): ` +
    `${erro && erro.name}: ${erro && erro.message}${detalhe}`)
}

async function iniciarTransmissao (fonteId, configAudio) {
  const qualidade = configuracaoDeVideo()
  qualidadeLocal = { altura: qualidade.altura, fps: qualidade.fps }

  try {
    streamLocal = await capturarFonte(fonteId, configAudio, qualidade)
  } catch (erro) {
    anotarFalhaDeCaptura('transmissao', fonteId, configAudio, erro)
    return avisar('Não consegui capturar essa fonte: ' + erro.message)
  }

  fonteAtual = fonteId
  audioAtual = configAudio

  for (const id of participantes.keys()) adicionarTrilhas(garantirPar(id))

  anunciarEstado()

  $('#btn-transmitir').classList.add('oculto')
  $('#btn-parar').classList.remove('oculto')
  $('#btn-ajustar').disabled = false
  $('#btn-ajustar').title = 'Trocar tela, resolução e fps sem parar a transmissão'
  sincronizarGrade()
}

// Muda o que estou transmitindo SEM parar de transmitir.
//
// Dois caminhos, e a diferenca aparece para quem assiste:
//
// - So a qualidade mudou (mesma fonte, mesmo audio): applyConstraints na
//   trilha que ja esta no ar. Nenhuma captura nova, nenhuma renegociacao,
//   ninguem ve piscar.
// - A fonte ou o audio mudaram: captura nova e replaceTrack em cada par. O
//   replaceTrack troca a trilha POR DENTRO do remetente que ja existe, entao
//   tambem nao renegocia. addTrack, que e o que o comeco usa, criaria um
//   remetente novo e obrigaria uma rodada de SDP.
async function ajustarTransmissao (fonteId, configAudio) {
  if (!streamLocal) return

  const qualidade = configuracaoDeVideo()
  const mesmaFonte = fonteId === fonteAtual
  const mesmoAudio = JSON.stringify(configAudio) === JSON.stringify(audioAtual)

  qualidadeLocal = { altura: qualidade.altura, fps: qualidade.fps }

  const video = mesmaFonte && mesmoAudio ? streamLocal.getVideoTracks()[0] : null

  if (video) {
    try {
      await video.applyConstraints({
        width: { ideal: qualidade.largura },
        height: { ideal: qualidade.altura },
        frameRate: { ideal: qualidade.fps, max: qualidade.fps }
      })
      await ajustarDimensoes(video)
      reaplicarQualidade()
      anotar(`transmissao ajustada para ${qualidade.altura}p @ ${qualidade.fps}fps`)
      return
    } catch (erro) {
      // Nem toda fonte aceita mudar de tamanho na trilha que ja esta no ar, e
      // isso depende do capturador do Windows. Em vez de deixar o ajuste
      // falhar, cai para a captura nova logo abaixo: custa um piscar para quem
      // assiste, e nao custa a transmissao.
      anotar(`applyConstraints recusou (${erro.message}), recapturando a fonte`)
    }
  }

  const antigo = streamLocal
  let novo
  try {
    novo = await capturarFonte(fonteId, configAudio, qualidade)
  } catch (erro) {
    anotarFalhaDeCaptura('troca de fonte', fonteId, configAudio, erro)
    return avisar('Não consegui capturar essa fonte: ' + erro.message)
  }

  streamLocal = novo
  fonteAtual = fonteId
  audioAtual = configAudio

  for (const par of pares.values()) await trocarTrilhas(par)

  // Para as trilhas velhas SO depois da troca: parar antes deixaria um vao sem
  // imagem no meio do caminho.
  for (const trilha of antigo.getTracks()) trilha.stop()

  reaplicarQualidade()
  anotar(`fonte trocada no ar: ${qualidade.altura}p @ ${qualidade.fps}fps`)
  sincronizarGrade()
}

// Troca as trilhas deste par pelas do streamLocal de agora.
async function trocarTrilhas (par) {
  for (const tipo of ['video', 'audio']) {
    const nova = streamLocal.getTracks().find((t) => t.kind === tipo) || null
    const remetente = par.remetentePorTipo.get(tipo)

    if (remetente) {
      // null tambem vale: emudece sem derrubar o remetente, que e o caso de
      // trocar de uma fonte com som para uma sem som.
      try {
        await remetente.replaceTrack(nova)
      } catch (erro) {
        anotar(`nao consegui trocar a trilha de ${tipo}: ${erro.message}`)
      }
      continue
    }

    if (!nova) continue

    // Nao existia remetente deste tipo (a transmissao comecou sem audio, por
    // exemplo). Aqui nao tem como escapar da renegociacao.
    const criado = par.pc.addTrack(nova, streamLocal)
    par.remetentes.push(criado)
    par.remetentePorTipo.set(tipo, criado)
  }
}

// Reaplica o teto em TODOS os pares, porque mexer na fonte muda o que cada
// amigo recebe.
//
// Quem transmite manda no limite de cima; o pedido de quem assiste continua
// valendo abaixo dele. Caindo de 1440p para 1080p, quem pedia 1440p passa a
// receber 1080p. Quem pedia 720p continua em 720p. E voltando para 1440p, o
// pedido de 1440p volta a valer sozinho: o que guardamos de cada amigo e o
// PEDIDO dele, nunca o resultado, senao o teto de agora viraria a escolha dele
// para sempre.
function reaplicarQualidade () {
  for (const par of pares.values()) {
    for (const remetente of par.remetentes) aplicarQualidade(par, remetente)
  }
}

function pararTransmissao () {
  if (!streamLocal) return

  for (const par of pares.values()) {
    for (const remetente of par.remetentes) {
      try { par.pc.removeTrack(remetente) } catch { /* par ja fechado */ }
    }
    par.remetentes = []
    par.remetentePorTipo.clear()
  }

  for (const trilha of streamLocal.getTracks()) trilha.stop()
  streamLocal = null

  // Fecha a captura nativa, se estava em uso.
  pararTrilhaDeProcesso()

  anunciarEstado()

  fonteAtual = null
  audioAtual = null

  $('#btn-parar').classList.add('oculto')
  $('#btn-transmitir').classList.remove('oculto')
  $('#btn-ajustar').disabled = true
  $('#btn-ajustar').title = 'Disponível durante a transmissão'
  sincronizarGrade()
}
