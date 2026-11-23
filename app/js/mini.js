// Mini tela: a tela de um amigo numa janelinha sempre por cima de tudo, para
// deixar em cima de um jogo (1.6.2, a pedido do dono). Uma por vez.
//
// A janela e aberta daqui com window.open('about:blank', ...): fica no mesmo
// processo e na mesma origem desta pagina, e e por isso que o video pode ir
// direto para ela (um MediaStream nao atravessa processos). O conteudo dela e
// montado por aqui, com DOM, e o estilo vem do mesmo estilo.css. O processo
// principal so deixa abrir esta janela (setWindowOpenHandler) e cuida do
// "sempre por cima" e de travar.
//
// TRAVAR deixa o mouse passar direto pela janelinha. Destrava com a tecla
// escolhida nas configuracoes (aba Mini tela) ou com Alt+Tab ate ela. A tecla
// e guardada pela POSICAO fisica (event.code), convertida para o nome que o
// Electron entende no teclado americano: o atalho global do Electron segue a
// posicao americana, e num ABNT2 a tecla do apostrofo e a que la seria o "`".

'use strict'

const MINI_NOME = 'liveon-mini-tela'

let miniJanela = null
let miniId = null
let miniTravada = false
let tempoAvisoMini = null

// --- a tecla de destravar -----------------------------------------------------

// Posicao fisica -> nome no acelerador do Electron (posicao americana).
const ACELERADOR_POR_CODIGO = {
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  Space: 'Space', Insert: 'Insert', Delete: 'Delete', Home: 'Home', End: 'End',
  PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'Up', ArrowDown: 'Down',
  ArrowLeft: 'Left', ArrowRight: 'Right', Pause: 'Pause', ScrollLock: 'Scrolllock',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv', NumpadDecimal: 'numdec'
}

function codigoParaAcelerador (codigo) {
  if (/^Key[A-Z]$/.test(codigo)) return codigo.slice(3)
  if (/^Digit[0-9]$/.test(codigo)) return codigo.slice(5)
  if (/^Numpad[0-9]$/.test(codigo)) return 'num' + codigo.slice(6)
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(codigo)) return codigo
  return ACELERADOR_POR_CODIGO[codigo] || ''
}

// A tecla padrao e o apostrofo, onde quer que ele esteja no teclado desta
// pessoa. Sem a API de layout, o portugues do Brasil (ABNT2) o tem na
// posicao do "`" americano.
async function atalhoPadrao () {
  try {
    const mapa = navigator.keyboard && await navigator.keyboard.getLayoutMap()
    if (mapa) {
      for (const [codigo, caractere] of mapa) {
        if (caractere === "'" && codigoParaAcelerador(codigo)) return { acelerador: codigoParaAcelerador(codigo), rotulo: "'" }
      }
    }
  } catch { /* sem a API */ }
  const abnt = /^pt(-BR)?$/i.test(navigator.language || '')
  return { acelerador: abnt ? '`' : "'", rotulo: "'" }
}

async function atalhoDaMini () {
  try {
    const guardado = JSON.parse(lembrar('liveon:atalho-mini') || 'null')
    if (guardado && typeof guardado.acelerador === 'string' && guardado.acelerador && typeof guardado.rotulo === 'string') return guardado
  } catch { /* volta para o padrao */ }
  return atalhoPadrao()
}

// O que a pessoa apertou, ou null se foi so um modificador (ainda montando a
// combinacao) ou uma tecla que nao da para usar.
function atalhoDoEvento (evento) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(evento.key)) return null
  const tecla = codigoParaAcelerador(evento.code)
  if (!tecla) return null
  const partes = []
  const rotulos = []
  if (evento.ctrlKey) { partes.push('Ctrl'); rotulos.push('Ctrl') }
  if (evento.altKey) { partes.push('Alt'); rotulos.push('Alt') }
  if (evento.shiftKey) { partes.push('Shift'); rotulos.push('Shift') }
  partes.push(tecla)
  // O rotulo mostra o que esta escrito na tecla da pessoa, nao o nome
  // americano. Com Shift, o evento.key ja vem trocado ('"' no lugar de "'"),
  // entao o caractere so vale sem Shift.
  const caractere = evento.key && evento.key.length === 1 && !evento.shiftKey ? evento.key.toUpperCase() : tecla
  rotulos.push(caractere)
  return { acelerador: partes.join('+'), rotulo: rotulos.join(' + ') }
}

async function mostrarAtalhoDaMini () {
  const atalho = await atalhoDaMini()
  $('#btn-atalho-mini').textContent = atalho.rotulo
}

// Clicou no campo: o proximo aperto vira a tecla. Esc desiste.
function capturarAtalhoDaMini () {
  const botao = $('#btn-atalho-mini')
  botao.textContent = 'Aperte a tecla...'
  botao.classList.add('capturando')
  const aoApertar = (evento) => {
    evento.preventDefault()
    evento.stopPropagation()
    if (evento.key === 'Escape') return terminar()
    const atalho = atalhoDoEvento(evento)
    if (!atalho) return
    guardar('liveon:atalho-mini', JSON.stringify(atalho))
    anotar(`tecla de destravar a mini tela: ${atalho.acelerador}`)
    terminar()
  }
  const terminar = () => {
    document.removeEventListener('keydown', aoApertar, true)
    botao.classList.remove('capturando')
    mostrarAtalhoDaMini()
  }
  document.addEventListener('keydown', aoApertar, true)
}

function voltarAtalhoPadrao () {
  guardar('liveon:atalho-mini', '')
  mostrarAtalhoDaMini()
}

// --- a janela -----------------------------------------------------------------

function miniAberta () {
  return Boolean(miniJanela && !miniJanela.closed)
}

function abrirMiniTela (id) {
  if (miniAberta() && miniId === id) return miniJanela.focus()
  // Quem ainda nao foi aberto ("com um clique"): abrir a mini e assistir.
  if (!estouAssistindo(id) && telasDecididas.has(id)) assistir(id)

  miniId = id
  if (!miniAberta()) {
    miniJanela = window.open('about:blank', MINI_NOME, 'width=480,height=270')
    if (!miniJanela) {
      miniId = null
      return avisar('Não consegui abrir a mini tela.')
    }
    montarMiniTela()
  }
  mostrarNaMini()
  anotar(`mini tela: ${id.slice(0, 8)}`)
  avisarPausaDaMini()
}

// A tela da mini nunca pausa: abrir, trocar ou fechar a mini muda quem pode
// estar pausado, e quem transmite precisa saber.
function avisarPausaDaMini () {
  if (!pausaAtiva()) return
  for (const [id, p] of participantes) if (p.transmitindo) pedirQualidade(id)
}

function montarMiniTela () {
  const doc = miniJanela.document
  doc.title = 'LiveOn: mini tela'
  const estilo = doc.createElement('link')
  estilo.rel = 'stylesheet'
  estilo.href = new URL('estilo.css', location.href).href
  doc.head.appendChild(estilo)
  doc.body.className = 'mini-tela'
  aparecerMini(doc)

  const video = doc.createElement('video')
  video.className = 'mini-video'
  video.autoplay = true
  video.playsInline = true
  // O som continua saindo pelo card, na janela principal: aqui seria eco.
  video.muted = true

  const topo = doc.createElement('div')
  topo.className = 'mini-topo'
  const nome = doc.createElement('span')
  nome.className = 'mini-nome'
  const espaco = doc.createElement('span')
  espaco.className = 'cresce'
  const fechar = doc.createElement('button')
  fechar.className = 'mini-botao'
  fechar.title = 'Fechar'
  fechar.appendChild(icone('fechar', 15, 2))
  fechar.onclick = fecharMiniTela
  topo.append(nome, espaco, fechar)

  // Travar fica no MEIO da mini tela, grande, aparecendo com o mouse em cima
  // (pedido do dono): e um gesto de proposito, nao um botaozinho de canto.
  const travar = doc.createElement('button')
  travar.className = 'mini-travar'
  travar.title = 'Travar: o mouse passa direto pela mini tela'
  travar.appendChild(icone('cadeado', 22, 2))
  const textoTravar = doc.createElement('span')
  textoTravar.textContent = 'Travar'
  travar.appendChild(textoTravar)
  travar.onclick = travarMiniTela

  const aviso = doc.createElement('div')
  aviso.className = 'mini-aviso'
  aviso.appendChild(icone('cadeado', 14, 2))
  const textoAviso = doc.createElement('span')
  aviso.appendChild(textoAviso)

  doc.body.append(video, topo, travar, aviso)
}

// O que vai na mini: a tela da pessoa, ou a webcam se ela so estiver com
// ela. A pessoa saiu do ar de vez: fecha.
function mostrarNaMini () {
  if (!miniAberta() || !miniId) return
  const stream = streamsRecebidos.get(miniId) || camerasRecebidas.get(miniId) || null
  const pessoa = participantes.get(miniId)
  if (!pessoa || (!stream && !pessoa.transmitindo && !pessoa.camera)) return fecharMiniTela()
  const doc = miniJanela.document
  const video = doc.querySelector('.mini-video')
  if (video && video.srcObject !== stream) {
    video.srcObject = stream
    if (stream) video.play().catch(() => {})
  }
  // "Tela de Five": no topo da mini e no titulo da janela, que e o que
  // aparece no Alt+Tab e na barra de tarefas.
  const titulo = 'Tela de ' + pessoa.nome
  const nome = doc.querySelector('.mini-nome')
  if (nome) nome.textContent = titulo
  if (doc.title !== titulo) doc.title = titulo
}

async function travarMiniTela () {
  if (!miniAberta()) return
  const atalho = await atalhoDaMini()
  let resposta = null
  try { resposta = await window.ponte.miniTravar(atalho.acelerador) } catch { resposta = null }
  if (!resposta || !resposta.ok) return avisar('Não consegui travar a mini tela.')
  const texto = resposta.atalho
    ? `Travada. Aperte ${atalho.rotulo} ou use Alt+Tab para destravar.`
    : 'Travada. A tecla escolhida não pôde ser usada: destrave com Alt+Tab.'
  avisoNaMini(texto)
}

function avisoNaMini (texto) {
  if (!miniAberta()) return
  const doc = miniJanela.document
  const aviso = doc.querySelector('.mini-aviso span')
  if (aviso) aviso.textContent = texto
  doc.body.classList.add('mostrar-aviso')
  clearTimeout(tempoAvisoMini)
  tempoAvisoMini = setTimeout(() => {
    if (miniAberta()) miniJanela.document.body.classList.remove('mostrar-aviso')
  }, 3500)
}

function fecharMiniTela () {
  const tinha = miniId
  if (miniAberta()) miniJanela.close()
  miniJanela = null
  miniId = null
  miniTravada = false
  if (tinha) avisarPausaDaMini()
}

// A pessoa da mini parou de mandar a tela (ou saiu): reavalia o que mostrar.
function atualizarMiniDe (id) {
  if (miniId === id) mostrarNaMini()
}

try {
  window.ponte.aoMudarMini((mudanca) => {
    if (mudanca.fechada) {
      miniJanela = null
      miniId = null
      miniTravada = false
      return
    }
    miniTravada = Boolean(mudanca.travada)
    if (miniAberta()) miniJanela.document.body.classList.toggle('travada', miniTravada)
    if (!miniTravada) avisoNaMini('Destravada.')
  })
} catch { /* sem ponte */ }

// Fechar o app fecha a mini junto.
window.addEventListener('pagehide', fecharMiniTela)
