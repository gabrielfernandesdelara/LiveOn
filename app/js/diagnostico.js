// Diagnóstico de vídeo para o registro: a cada 30s, o que cada conexão está
// mandando e recebendo de verdade.
//
// Existe por causa do travamento das placas AMD. Junto com a medição de CPU do
// processo principal, é o que separa "o app estava pesado" de "o PC travou do
// nada": resolução, fps, codec, quem codifica e decodifica (placa ou CPU), e o
// que o WebRTC diz que está limitando a qualidade.

'use strict'

const INTERVALO_DIAGNOSTICO = 30000

let temporizadorDiagnostico = null

function iniciarDiagnostico () {
  pararDiagnostico()
  temporizadorDiagnostico = setInterval(registrarDesempenho, INTERVALO_DIAGNOSTICO)
}

function pararDiagnostico () {
  clearInterval(temporizadorDiagnostico)
  temporizadorDiagnostico = null
}

async function registrarDesempenho () {
  for (const [id, par] of pares) {
    try {
      const linha = await descreverPar(id, par)
      if (linha) anotar(`video ${id.slice(0, 8)}: ${linha}`)
    } catch (erro) {
      anotar(`video ${id.slice(0, 8)}: nao consegui medir: ${erro.message}`)
    }
  }
  registrarUploadTotal([...pares.values()].map((p) => p.kbpsEnviado).filter((k) => k !== null && k !== undefined))
}

// O quanto mudou desde a última medição. Os contadores do WebRTC só crescem,
// então taxa e perdas saem da diferença.
function diferenca (par, chave, valor) {
  if (!par.ultimaMedicao) par.ultimaMedicao = {}
  const antes = par.ultimaMedicao[chave]
  par.ultimaMedicao[chave] = valor
  return antes === undefined || valor === undefined ? null : valor - antes
}

// Na primeira medição ainda não há com o que comparar, e a taxa fica de fora.
function kbps (bytes) {
  return bytes === null ? '' : ` ${Math.round(bytes * 8 / INTERVALO_DIAGNOSTICO)}kbps`
}

// O relatorio de UM remetente ou receptor, em vez do da conexao inteira. Com a
// webcam cada conexao passou a levar dois videos, e no relatorio geral nao da
// para saber qual linha e a tela e qual e a webcam. Perguntando a cada
// remetente, nao ha o que confundir.
async function rtpDe (ponta, tipo) {
  if (!ponta || !ponta.track) return null
  const stats = await ponta.getStats()
  let achado = null
  stats.forEach((r) => { if (r.type === tipo && r.kind === 'video') achado = r })
  return achado ? { r: achado, stats } : null
}

function descreverEnvio (par, chave, rotulo, medida) {
  if (!medida || !medida.r.bytesSent) return null
  const { r, stats } = medida
  const enviados = diferenca(par, chave, r.bytesSent)
  if (enviados !== null) par.kbpsEnviado = (par.kbpsEnviado || 0) + Math.round(enviados * 8 / INTERVALO_DIAGNOSTICO)

  return `${rotulo} ${codecDe(r, stats)} ${r.frameWidth || '?'}x${r.frameHeight || '?'} ` +
    `${Math.round(r.framesPerSecond || 0)}fps${kbps(enviados)}` +
    quemProcessa(r.encoderImplementation, r.powerEfficientEncoder) +
    // 'cpu' aqui é o WebRTC baixando a qualidade porque o processador não
    // está dando conta de codificar.
    (r.qualityLimitationReason && r.qualityLimitationReason !== 'none'
      ? ` limitado por ${r.qualityLimitationReason}`
      : '')
}

function descreverRecebimento (par, chave, rotulo, medida) {
  if (!medida || !medida.r.bytesReceived) return null
  const { r, stats } = medida
  const perdidos = diferenca(par, chave + '-descartados', r.framesDropped)
  const congelou = diferenca(par, chave + '-congelamentos', r.freezeCount)

  return `${rotulo} ${codecDe(r, stats)} ${r.frameWidth || '?'}x${r.frameHeight || '?'} ` +
    `${Math.round(r.framesPerSecond || 0)}fps${kbps(diferenca(par, chave, r.bytesReceived))}` +
    quemProcessa(r.decoderImplementation, r.powerEfficientDecoder) +
    (perdidos ? ` quadros descartados=${perdidos}` : '') +
    (congelou ? ` congelou=${congelou}x` : '')
}

function codecDe (r, stats) {
  const c = r.codecId && stats.get(r.codecId)
  return c ? c.mimeType.replace('video/', '') : '?'
}

// O Chromium só revela o nome do codificador/decodificador em algumas
// situações; quando revela, "powerEfficient" diz se é a placa de vídeo.
function quemProcessa (nome, naPlaca) {
  return nome
    ? ` ${nome}${naPlaca === true ? ' (placa)' : naPlaca === false ? ' (CPU)' : ''}`
    : ''
}

async function descreverPar (id, par) {
  const stats = await par.pc.getStats()
  let rede = null
  stats.forEach((r) => {
    if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') rede = r
  })

  // Quem recebe o que: o receptor cuja trilha e a do stream guardado.
  const receptores = par.pc.getReceivers()
  const receptorDe = (stream) => {
    const trilha = stream && stream.getVideoTracks()[0]
    return trilha ? receptores.find((r) => r.track === trilha) : null
  }

  // Zera antes: descreverEnvio soma aqui a tela e a webcam.
  par.kbpsEnviado = null

  const partes = [
    descreverEnvio(par, 'enviados', 'envio',
      await rtpDe(par.remetentePorTipo.get('video'), 'outbound-rtp')),
    descreverEnvio(par, 'cam-enviados', 'webcam envio',
      await rtpDe(par.remetenteCamera, 'outbound-rtp')),
    descreverRecebimento(par, 'recebidos', 'recebo',
      await rtpDe(receptorDe(streamsRecebidos.get(id)), 'inbound-rtp')),
    descreverRecebimento(par, 'cam-recebidos', 'webcam recebo',
      await rtpDe(receptorDe(camerasRecebidas.get(id)), 'inbound-rtp'))
  ].filter(Boolean)

  // O que a rede aguenta, na conta do proprio WebRTC. Em malha cada amigo e
  // uma copia a mais no upload, e a internet saturada derruba todos os pares
  // no mesmo segundo e o microfone do Discord junto (log de 05/11/2026). O
  // tempo de ida e volta subindo antes da queda e a assinatura disso.
  if (rede && partes.length) {
    const rtt = rede.currentRoundTripTime
    const cabe = rede.availableOutgoingBitrate
    partes.push('rede' +
      (rtt !== undefined ? ` ida e volta ${Math.round(rtt * 1000)}ms` : '') +
      (cabe ? ` upload estimado ${Math.round(cabe / 1000)}kbps` : ''))
  }

  return partes.join(' | ')
}

// Soma do que sai para todos os amigos: e esse total que disputa o upload da
// casa com o Discord e com o jogo.
function registrarUploadTotal (kbpsPorPar) {
  if (kbpsPorPar.length < 2) return
  const total = kbpsPorPar.reduce((a, b) => a + b, 0)
  anotar(`upload total: ${(total / 1000).toFixed(1)} Mbps para ${kbpsPorPar.length} amigos`)
}
