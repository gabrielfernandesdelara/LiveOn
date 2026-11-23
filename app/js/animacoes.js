// Animações (2.0.0, pedido do dono). Até aqui o LiveOn só tinha transições
// de cor e opacidade, como o redesign de 10/2026 pedia; o dono pediu
// movimento, escolhido numa demonstração:
//
// - a passagem da entrada para a sala (trocarDeTela): as partes da entrada
//   sobem e somem em cascata e a sala aparece por baixo; na volta, a
//   entrada desce de volta. Foi a "B" (a entrada crescendo e sumindo) por
//   pouco tempo, e o dono trocou por esta;
// - a grade abre espaço quando alguém entra no ar: os cards que já estavam
//   deslizam até o lugar novo e o novo surge crescendo; quem sai do ar
//   encolhe e some (animarGrade, retirarCard);
// - o ponto de "no ar" acende com uma onda, UMA vez só, quando alguém entra
//   no ar. Pulsar sem parar continua fora, como o redesign pediu;
// - por CSS (estilo.css, html:not(.sem-animacoes)): a entrada em cascata, o
//   arco girando na foto enquanto entra, a lista de pessoas, as janelas, a
//   troca de aba das configurações e os avisos.
//
// Só se anima transform e opacity, que a placa de vídeo faz sem esforço, e
// nada fica animando por cima dos vídeos. Desliga sozinho com o "Mostrar
// animações" do Windows desligado (prefers-reduced-motion) e pela opção
// Animações na aba Aparência. Com a janela escondida também não anima: não
// há quem veja, e é o que deixa os testes (janelas escondidas) iguais a
// antes.

'use strict'

const CURVA = 'cubic-bezier(.2, .8, .2, 1)'
const movimentoReduzido = window.matchMedia('(prefers-reduced-motion: reduce)')

let modoAnimacoes = lembrar('liveon:animacoes') === 'desligadas' ? 'desligadas' : 'ligadas'

function animacoesLigadas () {
  return modoAnimacoes === 'ligadas' && !movimentoReduzido.matches && document.visibilityState === 'visible'
}

// A classe que o CSS olha. Fica tambem com a janela escondida.
function aplicarAnimacoes () {
  document.documentElement.classList.toggle('sem-animacoes', !animacoesLigadas())
}

function definirAnimacoes (valor) {
  modoAnimacoes = valor === 'desligadas' ? 'desligadas' : 'ligadas'
  guardar('liveon:animacoes', modoAnimacoes)
  aplicarAnimacoes()
  marcarAparencia()
}

movimentoReduzido.addEventListener('change', aplicarAnimacoes)
document.addEventListener('visibilitychange', aplicarAnimacoes)
aplicarAnimacoes()

// --- entrada <-> sala ---------------------------------------------------------

// A troca que esta acontecendo, para uma segunda troca rapida terminar a
// primeira na hora em vez de deixar duas telas por cima uma da outra.
let trocaEmCurso = null

// A tela que saiu fica escondida, e as animacoes sao canceladas: cada parte
// volta ao normal para a proxima vez. A entrada perde o "entrando" (o anel
// vermelho) so aqui, para ele continuar aceso enquanto ela some.
function terminarTroca () {
  if (!trocaEmCurso) return
  const { sai, animacoes } = trocaEmCurso
  trocaEmCurso = null
  for (const a of animacoes) a.cancel()
  sai.classList.add('oculto')
  sai.classList.remove('tela-saindo', 'entrando')
}

// As partes da coluna da entrada que estao a vista: a foto, a saudacao, o
// nome, o formulario.
function partesDaEntrada () {
  return [...document.querySelectorAll('#coluna-entrada > :not(.oculto)')]
}

// A passagem entre a entrada e a sala (a "1" da demonstracao, escolhida pelo
// dono): na ida, as partes da entrada sobem e somem em cascata, a mesma da
// abertura ao contrario, e a sala aparece por baixo, com a grade subindo de
// leve. Na volta, a sala some e a entrada desce de volta, parte por parte.
//
// A tela que chega aparece na hora (o resto do app conta com isso); a que
// sai fica por cima, fixa e sem receber clique, ate tudo acabar.
function trocarDeTela (sai, entra, ida) {
  terminarTroca()
  entra.classList.remove('oculto')
  if (!animacoesLigadas()) {
    sai.classList.add('oculto')
    sai.classList.remove('entrando')
    return
  }
  sai.classList.add('tela-saindo')
  const animacoes = []
  const animar = (el, quadros, opcoes) => animacoes.push(el.animate(quadros, { easing: CURVA, fill: 'both', ...opcoes }))
  const sobeESome = [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-18px)' }]

  // O escurecido em degrade e a foto desfocada sao SO da entrada, por cima
  // do papel de parede (que e o mesmo nas duas telas e fica parado). Sem
  // esmaecer junto, eles sumiam de uma vez no fim da ida e apareciam de uma
  // vez no comeco da volta, e com o mesmo papel isso ficava estranho (dono).
  // O quadro so com o fim (ou so com o comeco) parte do valor de agora.
  const camadasDaEntrada = [$('#entrada .degrade-entrada'), $('#fundo-foto')]
  // O logo, a engrenagem e a versao, nos cantos. Sem sumir, ficavam por cima
  // da barra da sala, com dois logos e duas engrenagens sobrepostos.
  const cantosDaEntrada = [$('#entrada .topo-entrada'), $('#btn-config'), $('#versao-entrada')]

  if (ida) {
    partesDaEntrada().forEach((parte, i) => animar(parte, sobeESome, { duration: 260, delay: i * 45 }))
    for (const canto of cantosDaEntrada) animar(canto, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 })
    for (const camada of camadasDaEntrada) animar(camada, [{ opacity: 0 }], { duration: 460, delay: 80, fill: 'forwards' })
    animar(entra, [{ opacity: 0 }, { opacity: 1 }], { duration: 360, delay: 200 })
    animar($('#grade'), [{ transform: 'translateY(14px)' }, { transform: 'none' }], { duration: 420, delay: 220 })
  } else {
    animar(sai, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 })
    for (const camada of camadasDaEntrada) animar(camada, [{ opacity: 0, offset: 0 }], { duration: 460, delay: 60 })
    for (const canto of cantosDaEntrada) animar(canto, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, delay: 200 })
    partesDaEntrada().forEach((parte, i) => animar(parte, [...sobeESome].reverse(), { duration: 360, delay: 160 + i * 45 }))
  }

  const esta = { sai, animacoes }
  trocaEmCurso = esta
  Promise.all(animacoes.map((a) => a.finished))
    .then(() => { if (trocaEmCurso === esta) terminarTroca() })
    .catch(() => { /* cancelada por uma troca nova, que ja terminou esta */ })
}

// O fundo na troca entre a entrada e a sala, nos dois sentidos (pedido do
// dono: "alguma animacao para a imagem de fundo aparecer", e depois "o mesmo
// ao voltar para a entrada"). A camada do papel e o body::before, animado
// pelo pseudoElement. Dois casos:
// - o fundo mudou (a sala tem fundo proprio): o novo aparece esmaecendo e se
//   acomodando, de um pouco maior para o tamanho certo;
// - o mesmo papel: enquanto uma tela sai, ele escurece um pouco e se
//   aproxima, como uma camera passando de um lugar para outro, e se acomoda
//   quando a outra chega.
// Nunca encolhe abaixo do tamanho certo: menor que a janela, a camada
// mostraria as bordas. O zoom escolhido no tema entra na conta: o transform
// da animacao substitui o do CSS enquanto ela roda.
function animarFundoNaTroca (mudou) {
  const raiz = document.documentElement
  if (!animacoesLigadas() || !raiz.classList.contains('com-papel')) return
  const zoom = Number(getComputedStyle(raiz).getPropertyValue('--papel-zoom')) || 1
  const quadros = mudou
    ? [{ opacity: 0, transform: `scale(${zoom * 1.08})` }, { opacity: 1, transform: `scale(${zoom})` }]
    : [
        { opacity: 1, transform: `scale(${zoom})` },
        { opacity: 0.55, transform: `scale(${zoom * 1.045})`, offset: 0.35 },
        { opacity: 1, transform: `scale(${zoom})` }
      ]
  document.body.animate(quadros, { pseudoElement: '::before', duration: mudou ? 900 : 1000, easing: CURVA, fill: 'backwards' })
}

// --- a grade -------------------------------------------------------------------

// Onde cada card estava antes de a grade mudar. O sincronizarGrade mede
// ANTES de tirar e por cards: depois disso o resto ja escorregou de lugar.
let posicoesAntes = null

function medirCards () {
  if (!animacoesLigadas()) return null
  const mapa = new Map()
  for (const card of document.querySelectorAll('#grade .card')) mapa.set(card, card.getBoundingClientRect())
  return mapa
}

function guardarPosicoesDaGrade () {
  posicoesAntes = medirCards()
}

// FLIP: cada card ja no lugar novo, puxado de volta para onde estava e
// solto. O novo surge crescendo.
function animarGrade (antes) {
  if (!antes || !animacoesLigadas() || $('#sala').classList.contains('oculto')) return
  for (const card of document.querySelectorAll('#grade .card')) {
    if (card.dataset.novo) {
      delete card.dataset.novo
      card.animate([{ opacity: 0, transform: 'scale(.9)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: CURVA })
      continue
    }
    const de = antes.get(card)
    if (!de) continue
    const para = card.getBoundingClientRect()
    if (!para.width || !para.height) continue
    const dx = de.left - para.left
    const dy = de.top - para.top
    const sx = de.width / para.width
    const sy = de.height / para.height
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) continue
    card.animate([
      { transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: 'top left', transform: 'none' }
    ], { duration: 380, easing: CURVA })
  }
}

// Quem sai do ar: o card sai da grade na hora (o resto do app conta com
// isso), e uma copia dele, solta por cima no mesmo lugar, encolhe e some.
// A copia perde o data-id, para ninguem achar ela pelo cardDe.
function retirarCard (card) {
  if (!animacoesLigadas()) return card.remove()
  const r = card.getBoundingClientRect()
  card.remove()
  if (!r.width) return
  delete card.dataset.id
  card.classList.add('card-saindo')
  Object.assign(card.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' })
  $('#sala').appendChild(card)
  const a = card.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(.9)' }], { duration: 260, easing: CURVA, fill: 'forwards' })
  a.onfinish = () => card.remove()
}

// --- o ponto de "no ar" --------------------------------------------------------

// Quem eu vi no ar, e quando cada um acendeu. Quem ja estava no ar quando eu
// cheguei nao acende: a onda e para quem ENTRA no ar com a sala aberta.
const noArVisto = new Map()
const acendeuEm = new Map()

function acabouDeAcender (id, noAr) {
  if (!id) return false
  const antes = noArVisto.get(id)
  noArVisto.set(id, Boolean(noAr))
  if (noAr && antes === false) acendeuEm.set(id, Date.now())
  return Boolean(noAr) && animacoesLigadas() && Date.now() - (acendeuEm.get(id) || 0) < 1200
}

function esquecerPontosDaSala () {
  noArVisto.clear()
  acendeuEm.clear()
}

// --- mais animacoes (2.0.0, segunda leva, escolhidas numa demonstracao) ------

// Trocar de tema esmaecendo: o Chromium fotografa a tela antes e depois e
// mistura as duas (View Transitions). So na escolha de um tema pronto ou da
// pessoa: no editor, que muda a cada cor arrastada, ficaria arrastado.
function trocarTemaSuave (aplicar) {
  if (!animacoesLigadas() || typeof document.startViewTransition !== 'function') return aplicar()
  document.startViewTransition(aplicar)
}

// Os avatares do botao de pessoas: medir antes de redesenhar e, depois,
// cada um desliza de onde estava; quem chegou aparece crescendo. A chave e o
// id da pessoa (data-id no avatar), porque a pilha e refeita do zero.
function medirPilha () {
  if (!animacoesLigadas()) return null
  const mapa = new Map()
  for (const av of document.querySelectorAll('#pilha-pessoas .avatar')) mapa.set(av.dataset.id, av.getBoundingClientRect())
  return mapa
}

function animarPilha (antes) {
  if (!antes || !antes.size || !animacoesLigadas()) return
  for (const av of document.querySelectorAll('#pilha-pessoas .avatar')) {
    const de = antes.get(av.dataset.id)
    if (!de) {
      av.animate([{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: CURVA })
      continue
    }
    const dx = de.left - av.getBoundingClientRect().left
    if (Math.abs(dx) >= 1) av.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 360, easing: CURVA })
  }
}

// "Assistir": a tela do amigo aparece saindo de um desfoque, em vez de
// surgir de repente. So o video principal; a webcam por cima fica como esta.
function revelarTela (card) {
  const video = card && card.querySelector('.palco > video')
  if (!video || !animacoesLigadas()) return
  video.animate([
    { filter: 'blur(14px)', opacity: 0.4, transform: 'scale(1.04)' },
    { filter: 'blur(0)', opacity: 1, transform: 'none' }
  ], { duration: 600, easing: CURVA })
}

// Uma janela que nasce de um botao: cresce a partir dele (a previa da
// webcam, pelo botao da camera na barra).
function abrirDoBotao (painel, botao) {
  if (!painel || !botao || !animacoesLigadas()) return
  const p = painel.getBoundingClientRect()
  const b = botao.getBoundingClientRect()
  painel.style.transformOrigin = `${b.left + b.width / 2 - p.left}px ${b.top + b.height / 2 - p.top}px`
  painel.animate([{ opacity: 0, transform: 'scale(.15)' }, { opacity: 1, transform: 'none' }], { duration: 380, easing: CURVA })
}

// A mini tela: o conteudo dela aparece esmaecendo e crescendo um pouco. Ela
// e outra janela, entao a regra do CSS (sem-animacoes) nao chega la: quem
// decide e esta janela.
function aparecerMini (doc) {
  if (!doc || !doc.body || !animacoesLigadas()) return
  doc.body.animate([{ opacity: 0, transform: 'scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 300, easing: CURVA })
}

// O "certo" do Copiar com um pulinho.
function pularIcone (botao) {
  const svg = botao && botao.querySelector('svg')
  if (!svg || !animacoesLigadas()) return
  svg.animate([
    { opacity: 0, transform: 'scale(.4)' },
    { opacity: 1, transform: 'scale(1.3)', offset: 0.6 },
    { transform: 'scale(1)' }
  ], { duration: 380, easing: CURVA })
}

// A escolhida no seletor de telas ganha um pulinho junto com o contorno.
function destacarEscolhida (item) {
  if (!item || !animacoesLigadas()) return
  item.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 280, easing: CURVA })
}
