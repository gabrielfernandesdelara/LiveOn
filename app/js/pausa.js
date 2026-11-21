// Pausar a imagem quando o LiveOn não está à vista (1.6.4, a pedido do dono,
// aba Desempenho). Minimizado, ou coberto por outro programa, eu não estou
// vendo as telas, e receber e decodificar vídeo que ninguém vê gasta
// processador, memória e a internet dos dois lados.
//
// Três escolhas: nunca, só minimizado, ou minimizado ou coberto. "Coberto" é
// QUASE toda a janela atrás de outro programa (fracaoCoberta, no addon, numa
// grade de pontos): um programa só em parte por cima não pausa, e o LiveOn
// aberto em outro monitor não está coberto. Sem o addon, a cobertura não é
// medida e só o minimizado vale.
//
// O que pausa é só a IMAGEM: o pedido de qualidade leva `pausado: true`, e
// quem transmite desliga o vídeo para mim mas mantém o som (aplicarQualidade).
// Muita gente minimiza o LiveOn e continua ouvindo o jogo do amigo. A tela que
// está na mini tela nunca pausa: é ela que eu estou vendo.

'use strict'

const INTERVALO_PAUSA = 1500
// Coberto a partir daqui: um canto de fora ainda e "coberto", porque
// ninguem assiste por uma fresta.
const COBERTURA_PARA_PAUSAR = 0.9
// Quantas medicoes seguidas fora de vista para pausar (voltar e na hora).
const MEDICOES_PARA_PAUSAR = 2

let modoPausa = ['minimizado', 'coberto'].includes(lembrar('liveon:pausa')) ? lembrar('liveon:pausa') : 'nunca'
let pausada = false
let foraDeVista = 0
let relogioPausa = null

function pausaAtiva () {
  return pausada
}

// Se a imagem de alguem esta pausada para mim agora.
function imagemPausadaDe (id) {
  return pausada && id !== miniId
}

function definirModoPausa (modo) {
  modoPausa = ['minimizado', 'coberto'].includes(modo) ? modo : 'nunca'
  guardar('liveon:pausa', modoPausa)
  marcarAparencia()
  if (modoPausa === 'nunca') mudarPausa(false)
  else conferirVisibilidade()
}

function iniciarPausa () {
  pararPausa()
  relogioPausa = setInterval(conferirVisibilidade, INTERVALO_PAUSA)
}

function pararPausa () {
  clearInterval(relogioPausa)
  relogioPausa = null
  foraDeVista = 0
  pausada = false
}

async function conferirVisibilidade () {
  if (!meuId || modoPausa === 'nunca') return mudarPausa(false)
  let v = null
  try { v = await window.ponte.visibilidade() } catch { v = null }
  if (!v) return
  const coberta = modoPausa === 'coberto' && typeof v.coberta === 'number' && v.coberta >= COBERTURA_PARA_PAUSAR
  const escondida = v.minimizada || coberta
  if (!escondida) {
    foraDeVista = 0
    return mudarPausa(false)
  }
  foraDeVista++
  if (foraDeVista >= MEDICOES_PARA_PAUSAR) mudarPausa(true, v.minimizada ? 'minimizado' : 'coberto')
}

function mudarPausa (pausar, motivo) {
  if (pausar === pausada) return
  pausada = pausar
  anotar(pausar ? `imagens pausadas (${motivo}): o som continua` : 'imagens de volta')
  // Avisa cada um que esta com a tela no ar: o pedido leva o "pausado".
  for (const [id, p] of participantes) {
    if (p.transmitindo) pedirQualidade(id)
  }
}

// Voltar ao app e na hora, sem esperar o relogio.
window.addEventListener('focus', () => { if (pausada) conferirVisibilidade() })
document.addEventListener('visibilitychange', () => { if (pausada && document.visibilityState === 'visible') conferirVisibilidade() })
