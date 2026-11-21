// Monitoria: a parte da medição detalhada que só a página enxerga, os vídeos.
// Ligada na aba Debug (1.6.4); o processo principal grava o arquivo e mede os
// processos do app (ver "monitoria" no main.js).
//
// A cada 5 s, para cada amigo: o que eu recebo e o que eu mando (resolução,
// fps, taxa, codec, quem codifica ou decodifica, perda, atraso irregular,
// congelamentos, quadros descartados) e a conexão (ida e volta, upload
// estimado, por onde a mídia passa). Mais um resumo da sala. Nunca o código
// da sala.

'use strict'

const INTERVALO_MONITORIA_PAGINA = 5000

let monitoriaLigada = lembrar('liveon:monitoria') === 'ligada'
let relogioMonitoria = null

// id + o que e -> o ultimo contador, para tirar a taxa da diferenca.
const anterioresMonitoria = new Map()

async function definirMonitoria (ligar) {
  monitoriaLigada = Boolean(ligar)
  guardar('liveon:monitoria', monitoriaLigada ? 'ligada' : 'desligada')
  let arquivo = null
  try { arquivo = await window.ponte.ligarMonitoria(monitoriaLigada) } catch { arquivo = null }
  clearInterval(relogioMonitoria)
  relogioMonitoria = monitoriaLigada ? setInterval(medirParaMonitoria, INTERVALO_MONITORIA_PAGINA) : null
  if (monitoriaLigada && !arquivo) avisar('Não consegui criar o arquivo da monitoria.')
  mostrarMonitoria()
}

function mostrarMonitoria () {
  for (const botao of document.querySelectorAll('#opcao-monitoria button')) {
    botao.classList.toggle('ativo', (botao.dataset.valor === 'ligada') === monitoriaLigada)
  }
}

function taxaDesde (chave, bytes) {
  const agora = Date.now()
  const antes = anterioresMonitoria.get(chave)
  anterioresMonitoria.set(chave, { bytes, agora })
  if (!antes || bytes < antes.bytes) return ''
  return Math.round(((bytes - antes.bytes) * 8) / (agora - antes.agora))
}

function nomeDoCodec (stats, r) {
  const c = r.codecId && stats.get(r.codecId)
  return c ? c.mimeType.replace('video/', '').replace('audio/', '') : ''
}

async function medirParaMonitoria () {
  if (!monitoriaLigada) return
  const linhas = []
  const add = (quem, medida, valor) => { if (valor !== '' && valor !== undefined && valor !== null) linhas.push({ quem, medida, valor }) }

  const todos = quemEstaNaSala()
  if (meuId) {
    add('sala', 'pessoas', todos.length)
    add('sala', 'telas no ar', todos.filter((p) => p.transmitindo).length)
    add('sala', 'telas que eu recebo', [...participantes.keys()].filter((id) => streamsRecebidos.has(id)).length)
    add('sala', 'mini tela', miniAberta() ? 'aberta' : 'fechada')
    if (typeof pausaAtiva === 'function') add('sala', 'pausa por nao estar a vista', pausaAtiva() ? 'sim' : 'nao')
  }

  for (const [id, par] of pares) {
    const pessoa = participantes.get(id)
    const nome = pessoa ? pessoa.nome : id.slice(0, 8)
    let stats
    try { stats = await par.pc.getStats() } catch { continue }

    add(nome, 'conexao', par.pc.connectionState)
    stats.forEach((r) => {
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
        if (r.currentRoundTripTime !== undefined) add(nome, 'ida e volta (ms)', Math.round(r.currentRoundTripTime * 1000))
        if (r.availableOutgoingBitrate) add(nome, 'upload estimado (kbps)', Math.round(r.availableOutgoingBitrate / 1000))
      }
      if (r.type === 'inbound-rtp' && r.kind === 'video') {
        const q = `${nome} recebo`
        add(q, 'resolucao', r.frameWidth ? `${r.frameWidth}x${r.frameHeight}` : '')
        add(q, 'fps', Math.round(r.framesPerSecond || 0))
        add(q, 'kbps', taxaDesde(`${id}:in:${r.id}`, r.bytesReceived || 0))
        add(q, 'codec', nomeDoCodec(stats, r))
        add(q, 'decodificador', r.decoderImplementation || '')
        add(q, 'perdidos (pacotes)', r.packetsLost || 0)
        add(q, 'jitter (ms)', Math.round((r.jitter || 0) * 1000))
        add(q, 'congelamentos', r.freezeCount || 0)
        add(q, 'quadros descartados', r.framesDropped || 0)
      }
      if (r.type === 'outbound-rtp' && r.kind === 'video') {
        const q = `${nome} envio`
        add(q, 'resolucao', r.frameWidth ? `${r.frameWidth}x${r.frameHeight}` : '')
        add(q, 'fps', Math.round(r.framesPerSecond || 0))
        add(q, 'kbps', taxaDesde(`${id}:out:${r.id}`, r.bytesSent || 0))
        add(q, 'codec', nomeDoCodec(stats, r))
        add(q, 'codificador', r.encoderImplementation ? r.encoderImplementation + (r.powerEfficientEncoder ? ' (placa)' : ' (processador)') : '')
        add(q, 'limitado por', r.qualityLimitationReason || '')
        add(q, 'ativo', r.active === false ? 'nao' : 'sim')
      }
    })
    add(nome, 'assistindo', estouAssistindo(id) ? 'sim' : 'nao')
  }

  try { window.ponte.enviarMonitoria(linhas) } catch { /* sem ponte */ }
}

// Ligada de antes: volta a medir assim que o app abre.
async function retomarMonitoria () {
  if (monitoriaLigada) await definirMonitoria(true)
}
