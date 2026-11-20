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
  // video source" (20/11/2026), em 8 ms, e tela funcionava. Ordem: o pedido
  // de sempre; uma segunda tentativa sem limite de tamanho e fps; e por fim a
  // janela recortada da captura do monitor dela, que nao passa pelo
  // capturador de janela do Chromium. Janela que ja precisou do recorte vai
  // direto para ele nas proximas vezes.
  const ehJanela = String(fonteId).startsWith('window:')
  let video = null
  let audioDoLoopback = []

  if (ehJanela && janelasPorRecorte.has(fonteId)) {
    ({ video, audio: audioDoLoopback } = await capturarJanelaRecortando(fonteId, qualidade, usaLoopback))
  } else {
    let stream = null
    let semLimites = false
    try {
      stream = await pedir(true)
    } catch (erro) {
      anotarFalhaDeCaptura('primeira tentativa', fonteId, configAudio, erro)
      if (!ehJanela) throw erro
      await new Promise((resolver) => setTimeout(resolver, 500))
      try {
        stream = await pedir(false)
        semLimites = true
        anotar('captura de janela: a segunda tentativa, sem limites, funcionou')
      } catch (erro2) {
        anotarFalhaDeCaptura('segunda tentativa', fonteId, configAudio, erro2)
      }
    }

    if (stream) {
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
      video = stream.getVideoTracks()[0]
      // Parar pela barra nativa do sistema, ou fechar a janela capturada.
      video.addEventListener('ended', pararTransmissao)
      await ajustarDimensoes(video)
      audioDoLoopback = stream.getAudioTracks()
    } else {
      ({ video, audio: audioDoLoopback } = await capturarJanelaRecortando(fonteId, qualidade, usaLoopback))
      janelasPorRecorte.add(fonteId)
      avisar('Essa janela vai pelo recorte da tela: o que ficar na frente dela também aparece.')
    }
  }

  video.contentHint = 'motion'

  // Fecha a captura nativa anterior ANTES de abrir outra. No comeco isto e
  // inofensivo, nao ha nada aberto; no ajuste e obrigatorio, senao a escuta
  // antiga continua registrada e a nova escreve por cima dela.
  await pararTrilhaDeProcesso()

  const trilhas = [video]

  if (usaLoopback) {
    if (audioDoLoopback.length === 0) {
      avisar('A fonte veio sem áudio.')
    }
    trilhas.push(...audioDoLoopback)
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

// --- janela pelo recorte da tela ----------------------------------------------
//
// Reserva para quando o Chromium recusa a janela. Captura o MONITOR onde ela
// esta (a tela funcionava no PC do amigo) e recorta o retangulo dela a cada
// quadro, num canvas do tamanho de quando comecou, sem aumentar alem da
// qualidade escolhida. O retangulo vem do addon, conferido a cada 250 ms: a
// janela pode andar, mudar de tamanho (a imagem e encaixada, sem esticar),
// minimizar (fica o ultimo quadro) ou fechar (a transmissao acaba, como na
// captura de sempre). O preco e o de qualquer recorte de tela: o que estiver
// NA FRENTE da janela aparece junto, e por isso o aviso na tela.

const janelasPorRecorte = new Set()
const VIGIA_RECORTE = 250

async function capturarJanelaRecortando (fonteId, qualidade, comAudio) {
  let onde = await window.ponte.recorteDaJanela(fonteId)
  if (!onde) throw new Error('a janela não existe mais')
  if (!onde.telaId || !onde.monitor) throw new Error('não achei o monitor dessa janela')

  await window.ponte.escolherFonte(onde.telaId, comAudio)
  const tela = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: qualidade.fps, max: qualidade.fps } },
    audio: comAudio
  })
  const trilhaTela = tela.getVideoTracks()[0]

  // Tamanho par: o codificador quer largura e altura pares.
  const caber = Math.min(1, qualidade.largura / onde.largura, qualidade.altura / onde.altura)
  const largura = Math.max(2, Math.floor(onde.largura * caber / 2) * 2)
  const altura = Math.max(2, Math.floor(onde.altura * caber / 2) * 2)
  const quadro = new OffscreenCanvas(largura, altura)
  const desenho = quadro.getContext('2d', { alpha: false })
  desenho.fillStyle = '#000'
  desenho.fillRect(0, 0, largura, altura)

  const gerador = new MediaStreamTrackGenerator({ kind: 'video' })
  const escritor = gerador.writable.getWriter()
  const leitor = new MediaStreamTrackProcessor({ track: trilhaTela }).readable.getReader()

  let vivo = true
  let vigia = null
  const encerrar = () => {
    if (!vivo) return
    vivo = false
    clearInterval(vigia)
    trilhaTela.stop()
    leitor.cancel().catch(() => {})
  }
  // Acabou sem ninguem mandar parar (janela fechada, tela perdida): a
  // transmissao acaba junto, como o 'ended' da captura de sempre.
  const acabouSozinho = (motivo) => {
    anotar(`janela pelo recorte parou: ${motivo}`)
    encerrar()
    const noAr = streamLocal && streamLocal.getVideoTracks()[0] === gerador
    gerador.stop()
    if (noAr) pararTransmissao()
  }

  vigia = setInterval(async () => {
    if (gerador.readyState === 'ended') return encerrar()
    let novo = null
    try { novo = await window.ponte.recorteDaJanela(fonteId) } catch { /* tenta de novo */ return }
    if (!vivo) return
    if (!novo) return acabouSozinho('a janela foi fechada')
    onde = novo
  }, VIGIA_RECORTE)

  ;(async () => {
    let escrevendo = false
    while (vivo) {
      let lido
      try { lido = await leitor.read() } catch { break }
      if (lido.done) break
      const q = lido.value
      if (gerador.readyState === 'ended') { q.close(); break }
      // Codificador atrasado: descarta em vez de acumular atraso.
      if (escrevendo) { q.close(); continue }

      const m = onde.monitor
      if (!onde.minimizada && m && m.largura > 0 && m.altura > 0) {
        const ex = q.displayWidth / m.largura
        const ey = q.displayHeight / m.altura
        const sx = (onde.x - m.x) * ex
        const sy = (onde.y - m.y) * ey
        const sw = onde.largura * ex
        const sh = onde.altura * ey
        // So a parte da janela que esta dentro do monitor; o resto fica preto.
        const x0 = Math.max(0, sx)
        const y0 = Math.max(0, sy)
        const x1 = Math.min(q.displayWidth, sx + sw)
        const y1 = Math.min(q.displayHeight, sy + sh)
        if (x1 - x0 >= 2 && y1 - y0 >= 2) {
          const k = Math.min(largura / sw, altura / sh)
          const ox = (largura - sw * k) / 2
          const oy = (altura - sh * k) / 2
          desenho.fillRect(0, 0, largura, altura)
          desenho.drawImage(q, x0, y0, x1 - x0, y1 - y0,
            ox + (x0 - sx) * k, oy + (y0 - sy) * k, (x1 - x0) * k, (y1 - y0) * k)
        }
      }
      // O carimbo da captura da tela, que ja avanca: quem recebe espaca os
      // quadros por ele (carimbo parado faz a imagem travar do outro lado).
      const carimbo = q.timestamp
      q.close()
      const saida = new VideoFrame(quadro, { timestamp: carimbo })
      escrevendo = true
      escritor.write(saida)
        .catch(() => saida.close())
        .finally(() => { escrevendo = false })
    }
    if (vivo && gerador.readyState !== 'ended') acabouSozinho('a captura da tela acabou')
    encerrar()
  })()

  anotar(`janela pelo recorte da tela: ${onde.largura}x${onde.altura} -> ${largura}x${altura} @ ${qualidade.fps}fps`)
  return { video: gerador, audio: tela.getAudioTracks() }
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

  // A janela pelo recorte nao tem como mudar de tamanho na trilha: o tamanho
  // e o do canvas dela. Mudar a qualidade e recortar de novo.
  const atual = streamLocal.getVideoTracks()[0]
  const recortada = typeof MediaStreamTrackGenerator !== 'undefined' && atual instanceof MediaStreamTrackGenerator
  const video = mesmaFonte && mesmoAudio && !recortada ? atual : null

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
