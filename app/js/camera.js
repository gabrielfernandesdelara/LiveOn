// Webcam: a prévia antes de ir ao ar, ligar e desligar, e o formato em que a
// webcam de cada um aparece sobre a tela dele.
//
// A webcam é um SEGUNDO vídeo na mesma conexão de cada par, num stream
// separado do da tela. Quem recebe distingue os dois pelo id do stream, que o
// dono anuncia pela sala no aviso de estado (ver anunciarEstado(), em
// sinalizacao.js). Vai sem som de propósito: a voz do grupo passa pelo
// Discord, e mandar o microfone por aqui duplicaria a voz de todo mundo.

'use strict'

// Pequena de propósito. Em malha cada amigo recebe a própria cópia, e a webcam
// soma no upload de quem já está mandando a tela: foi upload saturado que
// derrubou a sala inteira de um amigo em 05/11/2026. A 600 kbps, quatro amigos
// custam 2,4 Mbps. Na tela ela aparece num canto, então 360p sobra.
const CAMERA = { largura: 640, altura: 360, fps: 30, bitrate: 600000 }

// O stream aberto no diálogo, ainda fora do ar. Vira streamCamera no "Ligar".
let previaCamera = null

// Como a webcam de quem TAMBÉM transmite a tela aparece no card dele:
// 'canto' (um retângulo no canto de cima) ou 'selo' (redonda, junto do nome).
// É escolha de quem assiste, vale para todos os cards e fica guardada.
let formatoDaCamera = lembrar('liveon:camera-formato') === 'selo' ? 'selo' : 'canto'

function restricoesDaCamera (aparelho) {
  return {
    audio: false,
    video: {
      deviceId: aparelho ? { exact: aparelho } : undefined,
      width: { ideal: CAMERA.largura },
      height: { ideal: CAMERA.altura },
      aspectRatio: { ideal: 16 / 9 },
      frameRate: { ideal: CAMERA.fps, max: CAMERA.fps }
    }
  }
}

// O erro do getUserMedia dito de um jeito que a pessoa consiga resolver.
function motivoDaCamera (erro) {
  const motivos = {
    NotAllowedError: 'O Windows bloqueou a câmera. Libere em Configurações, Privacidade, Câmera.',
    NotFoundError: 'Nenhuma câmera encontrada.',
    NotReadableError: 'A câmera está em uso por outro programa.',
    AbortError: 'A câmera não respondeu. Tente de novo.'
  }
  return motivos[erro && erro.name] || 'Não consegui abrir a câmera: ' + (erro && erro.message)
}

function cameraAberta () {
  return !$('#camera').classList.contains('oculto')
}

function pararPrevia () {
  if (previaCamera) {
    for (const trilha of previaCamera.getTracks()) trilha.stop()
    previaCamera = null
  }
  $('#previa-camera').srcObject = null
  $('#btn-ligar-camera').disabled = true
}

// Abre a câmera pedida e mostra na prévia. Sem aparelho pedido, ou se o pedido
// sumiu (câmera desplugada desde a última vez), fica com a que o sistema der.
async function abrirPrevia (aparelho) {
  pararPrevia()
  $('#estado-camera').textContent = 'abrindo a câmera...'

  let stream
  try {
    stream = await navigator.mediaDevices.getUserMedia(restricoesDaCamera(aparelho))
  } catch (erro) {
    if (aparelho && (erro.name === 'OverconstrainedError' || erro.name === 'NotFoundError')) {
      return abrirPrevia('')
    }
    anotar(`camera: nao abriu (${erro.name}: ${erro.message})`)
    $('#estado-camera').textContent = motivoDaCamera(erro)
    return
  }

  // O diálogo pode ter sido fechado, ou outra câmera escolhida, enquanto esta
  // abria. Câmera aberta sem ninguém olhando fica com a luz acesa à toa.
  if (!cameraAberta() || previaCamera) {
    for (const trilha of stream.getTracks()) trilha.stop()
    return
  }

  previaCamera = stream
  $('#previa-camera').srcObject = stream
  $('#estado-camera').textContent = ''
  $('#btn-ligar-camera').disabled = false
}

// A lista só é montada DEPOIS de a câmera abrir: é quando os nomes dos
// aparelhos vêm com certeza, e dá para marcar o que está em uso de verdade.
async function desenharCameras () {
  const campo = $('#campo-camera')
  campo.textContent = ''

  let aparelhos = []
  try {
    aparelhos = (await navigator.mediaDevices.enumerateDevices()).filter((a) => a.kind === 'videoinput')
  } catch (erro) {
    anotar('camera: nao consegui listar: ' + erro.message)
  }

  if (aparelhos.length === 0) {
    const vazio = document.createElement('option')
    vazio.value = ''
    vazio.textContent = 'nenhuma câmera encontrada'
    campo.appendChild(vazio)
    return
  }

  aparelhos.forEach((aparelho, i) => {
    const item = document.createElement('option')
    item.value = aparelho.deviceId
    item.textContent = aparelho.label || 'Câmera ' + (i + 1)
    campo.appendChild(item)
  })

  const trilha = previaCamera && previaCamera.getVideoTracks()[0]
  const emUso = trilha ? trilha.getSettings().deviceId : ''
  if (emUso && aparelhos.some((a) => a.deviceId === emUso)) campo.value = emUso
}

async function abrirCamera () {
  $('#camera').classList.remove('oculto')
  await abrirPrevia(lembrar('liveon:camera'))
  if (cameraAberta()) await desenharCameras()
}

function fecharCamera () {
  $('#camera').classList.add('oculto')
  pararPrevia()
}

async function trocarCamera () {
  const aparelho = $('#campo-camera').value
  guardar('liveon:camera', aparelho)
  await abrirPrevia(aparelho)
}

// A prévia que a pessoa aprovou É o que vai ao ar: sem captura nova, o que ela
// viu no diálogo é exatamente o que os amigos passam a ver.
function ligarCamera () {
  if (!previaCamera || streamCamera) return

  streamCamera = previaCamera
  previaCamera = null
  $('#previa-camera').srcObject = null
  $('#camera').classList.add('oculto')

  const trilha = streamCamera.getVideoTracks()[0]
  trilha.contentHint = 'motion'
  // Câmera desplugada, ou tomada por outro programa.
  trilha.addEventListener('ended', desligarCamera)

  const real = trilha.getSettings()
  anotar(`camera ligada: ${real.width}x${real.height} @ ${Math.round(real.frameRate || 0)}fps (${trilha.label || 'sem nome'})`)

  // O aviso vai ANTES das trilhas, e a ordem importa: os dois passam pelo
  // mesmo socket, então quem recebe já sabe qual stream é a webcam quando o
  // vídeo dela chega. Invertido, a webcam aparecia como tela por um instante.
  anunciarEstado()
  for (const id of participantes.keys()) adicionarCamera(garantirPar(id))

  atualizarBotaoDaCamera()
  sincronizarGrade()
}

function desligarCamera () {
  if (!streamCamera) return

  for (const par of pares.values()) removerCamera(par)
  for (const trilha of streamCamera.getTracks()) trilha.stop()
  streamCamera = null
  anotar('camera desligada')

  anunciarEstado()
  atualizarBotaoDaCamera()
  sincronizarGrade()
}

// O remetente da webcam fica FORA de par.remetentes e de par.remetentePorTipo:
// os dois são da tela. Parar a transmissão remove tudo o que está em
// par.remetentes, e trocar de fonte procura o remetente pelo tipo 'video', que
// a webcam também é. Misturados, parar a tela derrubava a webcam junto.
function adicionarCamera (par) {
  if (!streamCamera || par.remetenteCamera) return
  const trilha = streamCamera.getVideoTracks()[0]
  if (!trilha) return

  par.remetenteCamera = par.pc.addTrack(trilha, streamCamera)
  limitarCamera(par)
}

function removerCamera (par) {
  if (!par.remetenteCamera) return
  try { par.pc.removeTrack(par.remetenteCamera) } catch { /* par ja fechado */ }
  par.remetenteCamera = null
}

// O teto da webcam é fixo, e não o que o amigo pediu para a tela: o pedido de
// qualidade dele é sobre a tela que ele está assistindo.
async function limitarCamera (par) {
  const remetente = par.remetenteCamera
  if (!remetente) return
  try {
    const params = remetente.getParameters()
    if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
    params.encodings[0].maxBitrate = CAMERA.bitrate
    params.encodings[0].maxFramerate = CAMERA.fps
    await remetente.setParameters(params)
  } catch (erro) {
    console.warn('[camera] nao consegui limitar:', erro)
  }
}

function atualizarBotaoDaCamera () {
  const botao = $('#btn-camera')
  const ligada = Boolean(streamCamera)
  botao.classList.toggle('ligada', ligada)
  botao.title = ligada ? 'Desligar a câmera' : 'Ligar a câmera'
}

// Quem recebe: a webcam de alguém parou de chegar.
function limparCamera (id) {
  camerasRecebidas.delete(id)
  aplicarVideo(id)
  sincronizarGrade()
}

function aplicarFormatoDaCamera () {
  $('#grade').classList.toggle('cam-selo', formatoDaCamera === 'selo')
}

function alternarFormatoDaCamera () {
  formatoDaCamera = formatoDaCamera === 'selo' ? 'canto' : 'selo'
  guardar('liveon:camera-formato', formatoDaCamera)
  aplicarFormatoDaCamera()
}

// --- faixa de webcams sobre a tela em destaque -------------------------------
//
// Com uma tela em destaque (duplo clique, expandido ou tela cheia), as webcams
// dos outros podem sumir: no expandido e na tela cheia nao ha miniaturas, e na
// miniatura de quem tem tela E webcam a webcam e escondida, de tao pequena.
// Foi o que o dono viu em 15/11/2026: focou a propria tela e perdeu as
// webcams de duas amigas.
//
// A faixa e uma fileira de bolhas no canto de cima a ESQUERDA do primeiro
// card em destaque. A esquerda porque o canto de cima a direita ja e da
// webcam da propria pessoa em destaque, e embaixo ficam o nome e os controles.
//
// Regra do que entra: so a webcam que NAO esta visivel de outro jeito. Quem
// esta so de webcam e aparece como miniatura fica de fora, a miniatura e
// maior que a bolha. Quem esta em destaque tambem: a webcam dele ja esta no
// proprio card.

// Escolha de quem assiste, guardada. O botao fica nos controles do card que
// hospeda a faixa.
let faixaVisivel = lembrar('liveon:camera-faixa') !== '0'

const faixaDeCameras = document.createElement('div')
faixaDeCameras.className = 'faixa-cams'
// O duplo clique do palco tira o destaque; em cima de uma bolha nao.
faixaDeCameras.addEventListener('dblclick', (evento) => evento.stopPropagation())

// id -> a bolha da pessoa. Guardadas para nao recriar o <video> a cada
// reorganizacao da grade, o que faria a imagem piscar.
const bolhas = new Map()

function criarBolha (pessoa) {
  const bolha = document.createElement('div')
  bolha.className = pessoa.souEu ? 'bolha eu' : 'bolha'
  bolha.title = pessoa.souEu ? pessoa.nome + ' (você)' : pessoa.nome

  const video = document.createElement('video')
  video.autoplay = true
  video.playsInline = true
  video.muted = true
  bolha.appendChild(video)
  return bolha
}

// Chamada pelo organizarGrade(), que e quem sabe quem esta em destaque.
function atualizarFaixa (grandes, haDestaque) {
  // No expandido e na tela cheia as miniaturas somem.
  const miniaturasVisiveis = !idTelaCheia
  const emDestaque = new Set(grandes.map((card) => card.dataset.id))

  const pessoas = !haDestaque ? [] : quemEstaNaSala().filter((p) => {
    if (!p.camera || emDestaque.has(p.id)) return false
    if (!(p.souEu ? streamCamera : camerasRecebidas.get(p.id))) return false
    // So de webcam e com miniatura a vista: ja aparece, e maior.
    return !(miniaturasVisiveis && !p.transmitindo)
  })

  for (const [id, bolha] of bolhas) {
    if (!pessoas.some((p) => p.id === id)) {
      bolha.querySelector('video').srcObject = null
      bolha.remove()
      bolhas.delete(id)
    }
  }

  for (const pessoa of pessoas) {
    let bolha = bolhas.get(pessoa.id)
    if (!bolha) {
      bolha = criarBolha(pessoa)
      bolhas.set(pessoa.id, bolha)
    }
    const stream = pessoa.souEu ? streamCamera : camerasRecebidas.get(pessoa.id)
    const video = bolha.querySelector('video')
    if (video.srcObject !== stream) video.srcObject = stream
    if (bolha.parentNode !== faixaDeCameras) faixaDeCameras.appendChild(bolha)
  }

  for (const card of document.querySelectorAll('.card.com-faixa')) card.classList.remove('com-faixa')

  const anfitriao = pessoas.length ? grandes[0] : null
  if (!anfitriao) {
    faixaDeCameras.remove()
    return
  }

  anfitriao.classList.add('com-faixa')
  faixaDeCameras.classList.toggle('oculta', !faixaVisivel)

  const botao = anfitriao.querySelector('.btn-faixa')
  botao.classList.toggle('mudo', !faixaVisivel)
  botao.title = faixaVisivel ? 'Esconder as webcams' : 'Mostrar as webcams'

  const palco = anfitriao.querySelector('.palco')
  if (faixaDeCameras.parentNode !== palco) palco.appendChild(faixaDeCameras)
  // Mover um <video> no DOM pode pausar a reproducao; retomar e barato.
  for (const video of faixaDeCameras.querySelectorAll('video')) {
    if (video.paused) video.play().catch(() => {})
  }
}

function alternarFaixa () {
  faixaVisivel = !faixaVisivel
  guardar('liveon:camera-faixa', faixaVisivel ? '1' : '0')
  organizarGrade()
}

aplicarFormatoDaCamera()
