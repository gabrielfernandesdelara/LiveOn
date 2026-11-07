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
      const linha = await descreverPar(par)
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

async function descreverPar (par) {
  const stats = await par.pc.getStats()
  let envio = null
  let recebe = null
  let rede = null
  stats.forEach((r) => {
    if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') rede = r
    if (r.kind !== 'video') return
    if (r.type === 'outbound-rtp') envio = r
    if (r.type === 'inbound-rtp') recebe = r
  })

  const codec = (r) => {
    const c = r && r.codecId && stats.get(r.codecId)
    return c ? c.mimeType.replace('video/', '') : '?'
  }
  // O Chromium só revela o nome do codificador/decodificador em algumas
  // situações; quando revela, "powerEfficient" diz se é a placa de vídeo.
  const quem = (nome, naPlaca) => nome
    ? ` ${nome}${naPlaca === true ? ' (placa)' : naPlaca === false ? ' (CPU)' : ''}`
    : ''

  const partes = []

  par.kbpsEnviado = null
  if (envio && envio.bytesSent) {
    const enviados = diferenca(par, 'enviados', envio.bytesSent)
    if (enviados !== null) par.kbpsEnviado = Math.round(enviados * 8 / INTERVALO_DIAGNOSTICO)
    partes.push(`envio ${codec(envio)} ${envio.frameWidth || '?'}x${envio.frameHeight || '?'} ` +
      `${Math.round(envio.framesPerSecond || 0)}fps${kbps(enviados)}` +
      quem(envio.encoderImplementation, envio.powerEfficientEncoder) +
      // 'cpu' aqui é o WebRTC baixando a qualidade porque o processador não
      // está dando conta de codificar.
      (envio.qualityLimitationReason && envio.qualityLimitationReason !== 'none'
        ? ` limitado por ${envio.qualityLimitationReason}`
        : ''))
  }

  if (recebe && recebe.bytesReceived) {
    const perdidos = diferenca(par, 'descartados', recebe.framesDropped)
    const congelou = diferenca(par, 'congelamentos', recebe.freezeCount)
    partes.push(`recebo ${codec(recebe)} ${recebe.frameWidth || '?'}x${recebe.frameHeight || '?'} ` +
      `${Math.round(recebe.framesPerSecond || 0)}fps${kbps(diferenca(par, 'recebidos', recebe.bytesReceived))}` +
      quem(recebe.decoderImplementation, recebe.powerEfficientDecoder) +
      (perdidos ? ` quadros descartados=${perdidos}` : '') +
      (congelou ? ` congelou=${congelou}x` : ''))
  }

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
