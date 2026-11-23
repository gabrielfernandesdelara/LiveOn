// Sinal fraco: o ícone de barras que aparece no card quando a conexão está
// atrapalhando a imagem.
//
// Dois lados, medidos de jeitos diferentes, porque cada um sabe uma coisa:
//
// - No card de um AMIGO, quem mede sou eu, recebendo: pacotes perdidos,
//   atraso irregular (jitter) e a resolução caindo em relação ao que vinha
//   chegando há pouco. Quadros por segundo NÃO entram: tela parada manda
//   poucos quadros de propósito, e o ícone acenderia numa área de trabalho
//   sem nada se mexendo. Congelamento também não, pelo mesmo motivo.
// - No MEU card, quem mede é quem envia: o WebRTC diz quando baixou a
//   resolução por falta de banda (qualityLimitationReason 'bandwidth') e quanto
//   cada amigo está perdendo. Vale o MELHOR dos amigos, e não o pior: se só um
//   recebe mal, a internet ruim é a dele, e o aviso aparece no lado dele.
//
// O ícone tem histerese: acende depois de duas medições ruins seguidas (4 s)
// e só apaga depois de três boas (6 s). Sem isso ele piscaria a cada oscilação.
//
// Ressalva conhecida: se o amigo baixar a qualidade de propósito (Ajustar), a
// queda de resolução chega aqui igual a uma queda por banda, e o ícone pode
// aparecer até a referência de 15 s esquecer a resolução antiga. Separar os
// dois exigiria protocolo novo.

'use strict'

const INTERVALO_SINAL = 2000
// 3 medicoes ruins (6 s) para acender: com 2, um soluco de perda de um
// instante (11% num momento, 0% no seguinte) ja acendia (registro de
// 22/11/2026). Conexao ruim de verdade dura mais que isso.
const MEDICOES_PARA_ACENDER = 3
const MEDICOES_PARA_APAGAR = 3

// Por quanto tempo a resolução recebida serve de referência para dizer que
// ela caiu.
const JANELA_REFERENCIA = 15000

// Limites. Perda em fração dos pacotes da janela; jitter em segundos;
// resolução em fração da referência.
const LIMITES_SINAL = {
  perdaFraca: 0.03,
  perdaMuitoFraca: 0.10,
  // 150 ms, e nao 80: tela compartilhada manda os quadros em rajadas, e um
  // amigo acendia o icone com 80 a 135 ms de jitter e 0% de perda, a imagem
  // chegando inteira (registro de 22/11/2026).
  jitterFraco: 0.15,
  quedaFraca: 0.7,
  quedaMuitoFraca: 0.45,
  // Do lado de quem envia: a fração que o amigo diz ter perdido.
  perdaRemotaFraca: 0.05,
  perdaRemotaMuitoFraca: 0.15,
  // E a resolução que sai em relação à que foi pedida.
  envioFraco: 0.8,
  envioMuitoFraco: 0.5,
  // Upload medido acima disto vezes o teto: a queda foi do teto, nao da
  // conexao.
  folgaDoTeto: 1.3
}

let temporizadorSinal = null

// id -> o que a medição precisa lembrar daquela pessoa. O meu fica em meuId.
const sinalPorId = new Map()

function iniciarSinal () {
  pararSinal()
  temporizadorSinal = setInterval(medirSinal, INTERVALO_SINAL)
}

function pararSinal () {
  clearInterval(temporizadorSinal)
  temporizadorSinal = null
  sinalPorId.clear()
  for (const marca of document.querySelectorAll('.selo .sinal')) marca.remove()
  for (const card of document.querySelectorAll('.card.com-sinal')) card.classList.remove('com-sinal')
}

function estadoDoSinal (id) {
  if (!sinalPorId.has(id)) {
    sinalPorId.set(id, { ruins: 0, boas: 0, nivel: 0, referencia: [], contadores: null, chave: '' })
  }
  return sinalPorId.get(id)
}

async function medirSinal () {
  const envios = []
  for (const [id, par] of pares) {
    try {
      atualizarSinal(id, await nivelRecebido(id, par))
      const envio = await nivelEnviado(par)
      if (envio !== null) envios.push(envio)
    } catch { /* par fechando no meio da medicao */ }
  }

  for (const id of [...sinalPorId.keys()]) {
    if (id !== meuId && !pares.has(id)) sinalPorId.delete(id)
  }

  // O melhor dos amigos: ver o comentario do topo.
  if (meuId) {
    atualizarSinal(meuId, envios.length ? envios.reduce((a, b) => a.nivel <= b.nivel ? a : b) : { nivel: 0 })
  }
}

// --- recebendo ---------------------------------------------------------------

async function nivelRecebido (id, par) {
  const estadoPar = par.pc.connectionState
  if (estadoPar === 'disconnected' || estadoPar === 'failed') return { nivel: 2, motivo: 'conexao ' + estadoPar }

  const stream = streamsRecebidos.get(id) || camerasRecebidas.get(id)
  const trilha = stream && stream.getVideoTracks()[0]
  const receptor = trilha && par.pc.getReceivers().find((r) => r.track === trilha)
  if (!receptor) return { nivel: 0 }

  let r = null
  ;(await receptor.getStats()).forEach((item) => {
    if (item.type === 'inbound-rtp' && item.kind === 'video') r = item
  })
  if (!r) return { nivel: 0 }

  const estado = estadoDoSinal(id)
  const agora = Date.now()

  // Outra trilha, ou eu pedi outra qualidade para essa pessoa: a resolucao de
  // antes nao serve mais de comparacao.
  const pedido = qualidadeDe(id)
  const chave = trilha.id + '|' + pedido.altura + 'x' + pedido.fps
  if (estado.chave !== chave) {
    estado.chave = chave
    estado.referencia = []
    estado.contadores = null
  }

  // Perda na janela, pela diferenca dos contadores.
  let perda = 0
  const antes = estado.contadores
  estado.contadores = { recebidos: r.packetsReceived || 0, perdidos: r.packetsLost || 0 }
  if (antes) {
    const recebidos = Math.max(0, estado.contadores.recebidos - antes.recebidos)
    const perdidos = Math.max(0, estado.contadores.perdidos - antes.perdidos)
    // Com pouquissimos pacotes (tela parada) um perdido viraria 50%.
    if (recebidos + perdidos >= 30) perda = perdidos / (recebidos + perdidos)
  }

  // Resolucao contra a maior dos ultimos segundos.
  const altura = r.frameHeight || 0
  estado.referencia = estado.referencia.filter((a) => agora - a.quando <= JANELA_REFERENCIA)
  const referencia = estado.referencia.reduce((maior, a) => Math.max(maior, a.altura), 0)
  if (altura) estado.referencia.push({ quando: agora, altura })
  const queda = referencia && altura ? altura / referencia : 1

  const jitter = r.jitter || 0
  const L = LIMITES_SINAL
  const motivo = `perda ${Math.round(perda * 100)}%, jitter ${Math.round(jitter * 1000)}ms, ` +
    `${altura}p${referencia ? ' de ' + referencia + 'p' : ''}`

  if (perda > L.perdaMuitoFraca || queda < L.quedaMuitoFraca) return { nivel: 2, motivo }
  if (perda > L.perdaFraca || jitter > L.jitterFraco || queda < L.quedaFraca) return { nivel: 1, motivo }
  return { nivel: 0, motivo }
}

// --- enviando ----------------------------------------------------------------

async function nivelEnviado (par) {
  const remetente = par.remetentePorTipo.get('video')
  if (!remetente || !remetente.track) return null

  let r = null
  let remoto = null
  ;(await remetente.getStats()).forEach((item) => {
    if (item.kind !== 'video') return
    if (item.type === 'outbound-rtp') r = item
    if (item.type === 'remote-inbound-rtp') remoto = item
  })
  if (!r) return null

  // O upload que o WebRTC mede para este amigo (o par de candidatos em uso).
  let disponivel = 0
  try {
    ;(await par.pc.getStats()).forEach((item) => {
      if (item.type === 'candidate-pair' && item.nominated && item.state === 'succeeded' && item.availableOutgoingBitrate) {
        disponivel = item.availableOutgoingBitrate
      }
    })
  } catch { /* sem a medida, fica o criterio antigo */ }

  // A resolucao que DEVIA sair para esse amigo: a da captura dividida pela
  // escala que aplicarQualidade() pos para ele.
  const encoding = (remetente.getParameters().encodings || [])[0] || {}
  const fonte = (remetente.track.getSettings() || {}).height || qualidadeLocal.altura
  const esperada = fonte / (encoding.scaleResolutionDownBy || 1)
  const saindo = r.frameHeight ? r.frameHeight / esperada : 1
  // "Falta de banda" so e a CONEXAO quando o upload medido nao tem folga
  // acima do teto do LiveOn. Com folga, quem segurou a resolucao foi o
  // proprio teto (maxBitrate), num trecho de muito movimento: o WebRTC
  // tambem chama isso de 'bandwidth', e o icone acendia com o upload do
  // dono sobrando 10 Mbps (registro de 23/11/2026).
  const L = LIMITES_SINAL
  const teto = encoding.maxBitrate || 0
  const peloTeto = Boolean(teto && disponivel && disponivel > teto * L.folgaDoTeto)
  const porBanda = r.qualityLimitationReason === 'bandwidth' && !peloTeto
  const perdaRemota = remoto && typeof remoto.fractionLost === 'number' ? remoto.fractionLost : 0

  const motivo = `saindo ${r.frameHeight || '?'}p de ${Math.round(esperada)}p` +
    `${porBanda ? ' (falta de banda)' : ''}${peloTeto && r.qualityLimitationReason === 'bandwidth' ? ' (no teto do LiveOn, nao e a conexao)' : ''}` +
    `, amigo perdendo ${Math.round(perdaRemota * 100)}%` +
    `${disponivel ? `, upload medido ${Math.round(disponivel / 1000)}kbps` : ''}`

  if ((porBanda && saindo < L.envioMuitoFraco) || perdaRemota > L.perdaRemotaMuitoFraca) return { nivel: 2, motivo }
  if ((porBanda && saindo < L.envioFraco) || perdaRemota > L.perdaRemotaFraca) return { nivel: 1, motivo }
  return { nivel: 0, motivo }
}

// --- o icone -----------------------------------------------------------------

function atualizarSinal (id, medicao) {
  const estado = estadoDoSinal(id)
  const antes = estado.nivel

  if (medicao.nivel > 0) {
    estado.ruins++
    estado.boas = 0
    // Aceso, acompanha a medicao (fraco <-> muito fraco) sem esperar.
    if (estado.ruins >= MEDICOES_PARA_ACENDER || estado.nivel > 0) estado.nivel = medicao.nivel
  } else {
    estado.boas++
    estado.ruins = 0
    if (estado.boas >= MEDICOES_PARA_APAGAR) estado.nivel = 0
  }

  if (estado.nivel !== antes) {
    const rotulo = ['bom', 'fraco', 'muito fraco'][estado.nivel]
    const quem = id === meuId ? 'meu envio' : id.slice(0, 8)
    anotar(`sinal ${quem}: ${rotulo}${medicao.motivo ? ' (' + medicao.motivo + ')' : ''}`)
  }

  desenharSinal(id, estado.nivel)
}

function desenharSinal (id, nivel) {
  const card = cardDe(id)
  const selo = card && card.querySelector('.selo')
  if (!selo) return

  // O selo vive escondido ate o mouse mexer; com o alerta aceso, fica a vista.
  card.classList.toggle('com-sinal', nivel > 0)

  let marca = selo.querySelector('.sinal')
  if (!nivel) {
    if (marca) marca.remove()
    return
  }

  if (!marca) {
    marca = document.createElement('span')
    marca.className = 'sinal'
    marca.appendChild(icone('sinal', 18, 3))
    // Logo depois da inicial, antes do nome.
    selo.insertBefore(marca, selo.querySelector('.nome'))
  }
  marca.classList.toggle('muito-fraco', nivel === 2)
  marca.title = id === meuId
    ? 'Sua conexão está derrubando a qualidade do que você transmite.'
    : 'Conexão fraca: a imagem pode travar ou perder qualidade.'
}
