// Codificador de vídeo de quem transmite (2.0.0, a pedido do dono, aba
// Desempenho): VP8 no processador, como sempre foi, ou H.264 na placa de
// vídeo. Codificar é o que mais pesa para quem transmite jogando: com o
// H.264 na placa, o processador fica livre para o jogo.
//
// Medido no Electron 43 numa RTX 5070: H.264 sai pela placa
// ("MediaFoundationVideoEncodeAccelerator (NVIDIA H.264 Encoder MFT)") e VP8,
// VP9 e AV1 saem pelo processador (libvpx, libaom), mesmo a placa tendo AV1.
//
// Como o automático sabe se a placa codifica H.264: CONFERINDO NA PRIMEIRA
// TRANSMISSÃO. Não dá para testar antes: o navigator.mediaCapabilities
// responde "não sei" (powerEfficient false para tudo), e o Chromium só revela
// QUEM codifica (encoderImplementation, powerEfficientEncoder) para a página
// que está capturando tela ou câmera, por privacidade. Medido: um teste com
// canvas na abertura codificava 87 quadros e não dizia por quem. Então:
//
// - sem resultado guardado, o automático aposta pela placa: NVIDIA ou Intel
//   vão de H.264; AMD, desconhecida ou nenhuma vão de VP8;
// - transmitindo em H.264, uns segundos depois o app olha quem está
//   codificando e guarda (por placa e versão do Chromium). Se caiu no
//   processador, as próximas transmissões no automático voltam ao VP8.
//
// Com placa AMD o automático fica no VP8, por causa do histórico de
// travamentos com o driver da AMD (ver a placa no CLAUDE.md). No modo
// processador (aceleração desligada) não existe codificador na placa: é
// sempre VP8.
//
// O codec é preferência de quem MANDA (setCodecPreferences no transceiver),
// e todo Chromium decodifica H.264, então quem assiste não precisa de nada.
// Vale na próxima vez que a pessoa transmitir: trocar no ar exigiria
// renegociar.

'use strict'

let modoCodificador = ['h264', 'vp8'].includes(lembrar('liveon:codificador')) ? lembrar('liveon:codificador') : 'auto'
let infoDaPlaca = { placa: '', amd: false, videoAtivo: 'gpu' }
let conferenciaDoCodificador = null

function definirCodificador (modo) {
  modoCodificador = ['h264', 'vp8'].includes(modo) ? modo : 'auto'
  guardar('liveon:codificador', modoCodificador)
  anotar(`codificador escolhido: ${modoCodificador}`)
  mostrarCodificador()
  reaplicarCodificador()
}

// Vale na hora (2.1.1, pedido do dono: o que muda no Desempenho muda na
// hora). Com a tela ou a webcam no ar, poe o codec novo na frente e
// renegocia cada par. O setCodecPreferences sozinho NAO dispara o
// negotiationneeded, por isso a oferta e feita aqui, pelo mesmo caminho
// (perfect negotiation, receberSdp). A imagem segue no codec antigo ate a
// resposta chegar: nada cai.
function reaplicarCodificador () {
  for (const par of pares.values()) {
    const remetentes = [par.remetentePorTipo.get('video'), par.remetenteCamera].filter(Boolean)
    if (!remetentes.length) continue
    for (const remetente of remetentes) preferirCodec(par, remetente)
    renegociar(par)
  }
  if (streamLocal) conferirCodificadorNoAr()
}

// So oferta com a negociacao parada; no meio de uma, tenta de novo logo.
function renegociar (par, tentativa = 0) {
  if (par.pc.signalingState === 'closed' || ![...pares.values()].includes(par)) return
  if (par.pc.signalingState !== 'stable' || par.fazendoOferta) {
    if (tentativa < 20) setTimeout(() => renegociar(par, tentativa + 1), 250)
    return
  }
  par.pc.onnegotiationneeded()
}

// A placa e a versao do Chromium (no userAgent): trocou uma das duas, o
// resultado pode ser outro, e a conferencia vale de novo.
function chaveDoCodificador () {
  const chrome = (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || ''
  return `${infoDaPlaca.placa}|${chrome}`
}

function resultadoGuardado () {
  try {
    const r = JSON.parse(lembrar('liveon:teste-codificador') || 'null')
    if (r && r.chave === chaveDoCodificador()) return r
  } catch { /* confere de novo */ }
  return null
}

async function lerInfoDaPlaca () {
  try {
    const c = await window.ponte.lerConfig()
    infoDaPlaca = { placa: c.placa || '', amd: Boolean(c.amd), videoAtivo: c.videoAtivo || 'gpu' }
  } catch { /* fica o padrao */ }
}

// A aposta sem conferencia: pelo nome da placa.
function placaProvavelmenteCodifica () {
  return !infoDaPlaca.amd && /NVIDIA|GeForce|Quadro|RTX|Intel/i.test(infoDaPlaca.placa)
}

// O que vale agora: 'h264' ou 'vp8'.
function codecParaTransmitir () {
  if (infoDaPlaca.videoAtivo === 'cpu') return 'vp8'
  if (modoCodificador !== 'auto') return modoCodificador
  if (infoDaPlaca.amd) return 'vp8'
  const conferido = resultadoGuardado()
  if (conferido) return conferido.placa ? 'h264' : 'vp8'
  return placaProvavelmenteCodifica() ? 'h264' : 'vp8'
}

async function prepararCodificador () {
  await lerInfoDaPlaca()
}

// Transmitindo em H.264: uns segundos depois, quem esta codificando de
// verdade? Precisa de alguem na sala (sem par, nao ha codificador rodando),
// entao tenta de tempos em tempos enquanto a transmissao durar.
function conferirCodificadorNoAr () {
  clearInterval(conferenciaDoCodificador)
  let tentativas = 0
  conferenciaDoCodificador = setInterval(async () => {
    tentativas++
    if (!streamLocal || tentativas > 24) return clearInterval(conferenciaDoCodificador)
    for (const par of pares.values()) {
      const remetente = par.remetentePorTipo.get('video')
      if (!remetente) continue
      let s = null
      let stats = null
      try {
        stats = await remetente.getStats()
        stats.forEach((x) => { if (x.type === 'outbound-rtp') s = x })
      } catch { continue }
      if (!s || !s.encoderImplementation || !(s.framesEncoded > 30)) continue
      const codec = s.codecId && stats.get(s.codecId)
      if (!codec || codec.mimeType !== 'video/H264') return clearInterval(conferenciaDoCodificador)
      const placa = s.powerEfficientEncoder === true || /MediaFoundation|NVIDIA|AMD|Intel|QuickSync/i.test(s.encoderImplementation)
      guardar('liveon:teste-codificador', JSON.stringify({ chave: chaveDoCodificador(), placa, implementacao: s.encoderImplementation }))
      anotar(`codificador conferido no ar: H.264 ${placa ? 'na placa' : 'no processador'} (${s.encoderImplementation})`)
      return clearInterval(conferenciaDoCodificador)
    }
  }, 5000)
}

// Poe o codec escolhido na frente da lista do remetente. Os outros ficam
// atras, de reserva, se o outro lado nao aceitar.
function preferirCodec (par, remetente) {
  if (!remetente || !remetente.track || remetente.track.kind !== 'video') return
  const transceptor = par.pc.getTransceivers().find((t) => t.sender === remetente)
  if (!transceptor || typeof transceptor.setCodecPreferences !== 'function') return
  const alvo = codecParaTransmitir() === 'h264' ? 'video/H264' : 'video/VP8'
  const todos = RTCRtpReceiver.getCapabilities('video').codecs
  const peso = (c) => {
    if (c.mimeType !== alvo) return 3
    if (alvo !== 'video/H264') return 0
    // O PERFIL decide quem codifica. Medido numa RTX 5070: o baseline
    // (42001f) sai pelo "NVIDIA H.264 Encoder MFT"; o constrained baseline
    // (42e01f), que seria a escolha obvia, cai no OpenH264, do processador.
    // packetization-mode=1 e o que todo mundo decodifica no WebRTC.
    const linha = c.sdpFmtpLine || ''
    if (!/packetization-mode=1/.test(linha)) return 2
    return /profile-level-id=42001f/.test(linha) ? 0 : 1
  }
  try {
    transceptor.setCodecPreferences([...todos].sort((x, y) => peso(x) - peso(y)))
  } catch (erro) {
    anotar(`nao consegui preferir o codec ${alvo}: ${erro.message}`)
  }
}

// A aba Desempenho: o campo e a recomendacao para esta placa.
function mostrarCodificador () {
  const campo = $('#campo-codificador')
  const nota = $('#nota-codificador')
  if (!campo || !nota) return
  campo.value = modoCodificador
  const cpu = infoDaPlaca.videoAtivo === 'cpu'
  campo.disabled = cpu
  if (cpu) {
    nota.textContent = 'Com a aceleração no processador, é sempre VP8.'
    return
  }
  // O que o automatico escolheu aqui, e por que, numa frase.
  const conferido = resultadoGuardado()
  let texto
  if (infoDaPlaca.amd) texto = 'Automático: VP8. Com placa AMD já houve travamentos no H.264.'
  else if (conferido && conferido.placa) texto = 'Automático: H.264 na placa de vídeo (conferido).'
  else if (conferido) texto = 'Automático: VP8. Aqui o H.264 saiu pelo processador.'
  else if (placaProvavelmenteCodifica()) texto = 'Automático: H.264 na placa de vídeo. Confere na primeira transmissão.'
  else texto = 'Automático: VP8.'
  nota.textContent = texto
}
