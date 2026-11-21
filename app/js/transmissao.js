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

// --- forçar SDR ---------------------------------------------------------------
//
// Com a opção marcada, a imagem da tela não vem do getDisplayMedia: vem do
// addon, que captura o monitor em HDR e converte para SDR na placa de vídeo
// (ver o "forçar SDR" do main.js). Cada quadro chega pela ponte como
// VideoFrame e é escrito num MediaStreamTrackGenerator, que para o resto do
// app é uma trilha de vídeo como qualquer outra.

// Se a imagem no ar agora é a convertida.
let sdrAtual = false

// Sem nenhum quadro nesse tempo, a conversão não está funcionando nesta
// máquina (por exemplo, o monitor ligado numa placa e o Chromium em outra).
const ESPERA_PRIMEIRO_QUADRO_SDR = 3000

async function capturarSdr (fonteId, qualidade) {
  const gerador = new MediaStreamTrackGenerator({ kind: 'video' })
  const escritor = gerador.writable.getWriter()
  let escrevendo = false
  let avisarPrimeiro = null
  const primeiro = new Promise((resolver) => { avisarPrimeiro = resolver })

  // O quadro chega EMPRESTADO: ele aponta para uma textura do addon, que a
  // ponte libera assim que esta funcao volta. Por isso ele e copiado na hora
  // para um canvas nosso (copia de placa de video, barata), e e a copia que
  // segue para a previa e para os amigos. Sem a copia, o <video> da previa
  // segurava o quadro alem da vida da textura: medido em 19/11/2026, a pagina
  // caia ou a placa de video travava ao parar.
  let tela = null
  let desenho = null
  let carimbo = 0
  window.ponte.aoQuadroSdr((quadro) => {
    // Codificador atrasado: descarta em vez de acumular atraso.
    if (escrevendo || gerador.readyState === 'ended') return
    const largura = quadro.displayWidth
    const altura = quadro.displayHeight
    if (!tela || tela.width !== largura || tela.height !== altura) {
      tela = new OffscreenCanvas(largura, altura)
      desenho = tela.getContext('2d', { alpha: false })
    }
    desenho.drawImage(quadro, 0, 0)
    // O carimbo tem que sempre avançar: e por ele que quem recebe espaça os
    // quadros. Carimbo repetido (eram todos 0) fazia a imagem travar de
    // tempos em tempos do outro lado.
    carimbo = Math.max(quadro.timestamp || 0, carimbo + 1)
    const copia = new VideoFrame(tela, { timestamp: carimbo })
    escrevendo = true
    avisarPrimeiro(true)
    escritor.write(copia)
      .catch(() => copia.close())
      .finally(() => { escrevendo = false })
  })

  const desistir = (motivo) => {
    window.ponte.aoQuadroSdr(null)
    gerador.stop()
    if (motivo) {
      anotar(`Forcar SDR nao funcionou: ${motivo}`)
      avisar(`Forçar SDR não funcionou (${motivo}). Transmitindo do jeito normal.`)
    }
    return null
  }

  let resposta
  try {
    resposta = await window.ponte.sdrIniciar({
      fonteId,
      largura: qualidade.largura,
      altura: qualidade.altura,
      fps: qualidade.fps
    })
  } catch (erro) {
    resposta = { ok: false, motivo: erro.message }
  }

  if (!resposta || !resposta.ok) {
    // Monitor sem HDR: a captura de sempre já sai certa, nada a avisar.
    if (resposta && resposta.semHdr) {
      anotar('Forcar SDR: esse monitor nao esta em HDR, captura normal')
      return desistir()
    }
    return desistir((resposta && resposta.motivo) || 'erro desconhecido')
  }

  const veio = await Promise.race([
    primeiro,
    new Promise((resolver) => setTimeout(() => resolver(false), ESPERA_PRIMEIRO_QUADRO_SDR))
  ])
  if (!veio) {
    window.ponte.sdrParar()
    return desistir('a imagem convertida não chegou')
  }

  gerador.contentHint = 'motion'
  anotar(`Forcar SDR: ${resposta.monitor} em HDR, convertendo para ${resposta.largura}x${resposta.altura}`)
  return gerador
}

function pararSdr () {
  if (!sdrAtual) return
  sdrAtual = false
  try {
    window.ponte.sdrParar()
    window.ponte.aoQuadroSdr(null)
  } catch { /* sem ponte */ }
}

// A captura convertida parou sozinha (o Windows interrompeu, a resolução do
// monitor mudou): a transmissão segue, pela captura de sempre.
try {
  window.ponte.aoFimSdr((motivo) => {
    if (!sdrAtual || !streamLocal) return
    anotar(`Forcar SDR parou: ${motivo}`)
    // Janela fechada: é o mesmo que o 'ended' da captura de sempre, a
    // transmissão acaba. Não há para onde voltar.
    if (/janela foi fechada/.test(motivo)) return pararTransmissao()
    avisar('A conversão do HDR parou. Voltando para a captura normal.')
    ajustarTransmissao(fonteAtual, audioAtual, { semSdr: true })
  })
} catch { /* sem ponte */ }

// Captura video e audio conforme o que o seletor escolheu, e devolve o stream
// pronto para entrar na malha, e se a imagem e a convertida (sdr).
//
// Esta parte e comum a COMECAR e a AJUSTAR uma transmissao. Estava dentro do
// iniciarTransmissao; saiu para ca porque duplicar o preparo seria garantia de
// um dos dois caminhos ganhar correcao que o outro nao recebe (a dimensao par,
// o contentHint, o 'ended' da barra do sistema).
//
// Estoura em vez de avisar: quem chamou decide o que dizer ao usuario.
async function capturarFonte (fonteId, configAudio, qualidade, sdr) {
  // So o modo "tudo" usa o loopback do Chromium. Os outros pegam o audio pelo
  // addon nativo, ou nao pegam audio nenhum.
  const usaLoopback = configAudio.modo === 'tudo'

  // Enquanto a captura convertida roda, o Windows tira aquele monitor da lista
  // do Chromium (medido em 19/11/2026), e qualquer getDisplayMedia nele falha.
  // Ela para ANTES de qualquer captura nova: custa um instante de imagem
  // parada para quem assiste, so no ajuste.
  if (sdrAtual) {
    try { await window.ponte.sdrParar() } catch { /* sem ponte */ }
  }

  let video = null
  let audioDoLoopback = []
  const querConvertida = sdr && /^(screen|window):/.test(String(fonteId))

  // O som do sistema so vem pelo getDisplayMedia, e por isso ANTES da captura
  // convertida comecar. A imagem que vem junto e descartada.
  if (querConvertida && usaLoopback) {
    await window.ponte.escolherFonte(fonteId, true)
    const soSom = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    for (const trilha of soSom.getVideoTracks()) trilha.stop()
    audioDoLoopback = soSom.getAudioTracks()
  }

  if (querConvertida) video = await capturarSdr(fonteId, qualidade)
  const convertida = Boolean(video)

  // Nao deu (monitor sem HDR, ou falhou) e o som ja veio: a captura de sempre
  // pede o som de novo, entao o primeiro sai.
  if (!convertida && audioDoLoopback.length) {
    for (const trilha of audioDoLoopback) trilha.stop()
    audioDoLoopback = []
  }

  if (!convertida) {
    // Ordem importa: o processo principal precisa saber qual fonte foi
    // escolhida ANTES do getDisplayMedia, porque e o handler de la que
    // responde ao pedido.
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

    video = stream.getVideoTracks()[0]
    video.contentHint = 'motion'
    // Parar pela barra nativa do sistema, ou fechar a janela capturada.
    video.addEventListener('ended', pararTransmissao)

    await ajustarDimensoes(video)
    audioDoLoopback = stream.getAudioTracks()
  }

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

  return { stream: new MediaStream(trilhas), sdr: convertida }
}

// O aviso some da tela em 6 s, e sem isto o registro so mostrava "captura
// concedida" sem nada depois. Vai o tipo da fonte e o erro inteiro, nunca o
// titulo da janela (o id e so o numero dela).
function anotarFalhaDeCaptura (quando, fonteId, configAudio, erro) {
  const tipo = String(fonteId).split(':')[0]
  const detalhe = erro && erro.constraint ? ` (limite: ${erro.constraint})` : ''
  anotar(`captura FALHOU na ${quando} (${tipo} ${fonteId}, audio ${configAudio && configAudio.modo}, ` +
    `forcar SDR ${querSdr() ? 'marcado' : 'desmarcado'}): ${erro && erro.name}: ${erro && erro.message}${detalhe}`)
}

// Janela que o Windows recusa (NotReadableError, "Could not start video
// source") nao tem o que a pessoa fazer no LiveOn: a mensagem crua do
// Chromium nao dizia isso. Ja houve reserva pelo recorte da tela (1.5.7) e o
// dono pediu para tirar: transmitir janela e SO a janela, nada do que esta
// na frente dela pode vazar.
function avisarFalhaDeCaptura (fonteId, erro) {
  if (String(fonteId).startsWith('window:') && erro && erro.name === 'NotReadableError') {
    return avisar('O Windows não deixou capturar essa janela. Tente a tela inteira.')
  }
  return avisar('Não consegui capturar essa fonte: ' + (erro && erro.message))
}

async function iniciarTransmissao (fonteId, configAudio) {
  const qualidade = configuracaoDeVideo()
  qualidadeLocal = { altura: qualidade.altura, fps: qualidade.fps }

  let captura
  try {
    captura = await capturarFonte(fonteId, configAudio, qualidade, querSdr())
  } catch (erro) {
    anotarFalhaDeCaptura('transmissao', fonteId, configAudio, erro)
    return avisarFalhaDeCaptura(fonteId, erro)
  }

  streamLocal = captura.stream
  sdrAtual = captura.sdr
  fonteAtual = fonteId
  audioAtual = configAudio

  for (const id of participantes.keys()) adicionarTrilhas(garantirPar(id))
  // H.264: confere, com a captura rodando, se ele saiu mesmo pela placa.
  conferirCodificadorNoAr()

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
//
// Com o "Forçar SDR" no ar, ou ligando/desligando ele, e sempre captura nova:
// a imagem convertida sai do addon ja no tamanho e no fps pedidos, e mudar
// isso e recomecar a captura de la.
async function ajustarTransmissao (fonteId, configAudio, opcoes = {}) {
  if (!streamLocal) return

  const qualidade = configuracaoDeVideo()
  const mesmaFonte = fonteId === fonteAtual
  const mesmoAudio = JSON.stringify(configAudio) === JSON.stringify(audioAtual)
  const sdr = opcoes.semSdr ? false : querSdr()

  qualidadeLocal = { altura: qualidade.altura, fps: qualidade.fps }

  const video = mesmaFonte && mesmoAudio && !sdr && !sdrAtual ? streamLocal.getVideoTracks()[0] : null

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
  const eraSdr = sdrAtual
  let captura
  try {
    captura = await capturarFonte(fonteId, configAudio, qualidade, sdr)
  } catch (erro) {
    anotarFalhaDeCaptura('troca de fonte', fonteId, configAudio, erro)
    return avisarFalhaDeCaptura(fonteId, erro)
  }

  streamLocal = captura.stream
  sdrAtual = captura.sdr
  fonteAtual = fonteId
  audioAtual = configAudio

  for (const par of pares.values()) await trocarTrilhas(par)

  // Para as trilhas velhas SO depois da troca: parar antes deixaria um vao sem
  // imagem no meio do caminho.
  for (const trilha of antigo.getTracks()) trilha.stop()

  // Saiu da imagem convertida: a captura do addon para junto.
  if (eraSdr && !sdrAtual) {
    try {
      window.ponte.sdrParar()
      window.ponte.aoQuadroSdr(null)
    } catch { /* sem ponte */ }
  }

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

  // A captura convertida do addon, se era ela.
  pararSdr()

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
