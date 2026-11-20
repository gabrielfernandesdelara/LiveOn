// Tema de cores: os quatro prontos e os quatro lugares de temas da pessoa.
//
// Os prontos moram no estilo.css, uma paleta por :root[data-tema="..."], e
// trocam só os neutros (fundos, bordas, textos). Os da pessoa não cabem no
// CSS: as cores são escolhidas na hora. Por isso eles vão como variáveis no
// próprio <html>, por style.setProperty, que a CSP permite (o que ela barra é
// o atributo style="..." escrito no HTML).
//
// Um tema da pessoa são só CINCO cores: fundo, painéis, bordas, texto e
// destaque. As outras variáveis saem delas em derivarPaleta(), do mesmo jeito
// que as paletas prontas foram feitas: um pouco mais perto do texto para o
// que fica mais claro, um pouco mais perto do fundo para o que fica mais
// apagado. Funciona igual em tema claro, porque "perto do texto" é a direção
// do contraste, seja ela qual for.
//
// Ficam FORA do tema, de propósito: o vermelho de "no ar" (é o sinal de quem
// está transmitindo, tema nenhum pode esconder), o âmbar dos alertas e o azul
// do ícone do LiveOn (é a marca).

'use strict'

const TEMAS = ['grafite', 'marinho', 'carvao', 'preto']

// As cinco cores de cada tema pronto, para servir de ponto de partida no
// editor. Têm que bater com as paletas do estilo.css.
const CORES_PRONTAS = {
  grafite: { fundo: '#0e1013', painel: '#15181d', borda: '#262b35', texto: '#e7eaf0', destaque: '#4f8cff' },
  marinho: { fundo: '#0b0f17', painel: '#111723', borda: '#222c3f', texto: '#e6ebf5', destaque: '#4f8cff' },
  carvao: { fundo: '#11100f', painel: '#191816', borda: '#2c2a27', texto: '#ece8e2', destaque: '#4f8cff' },
  preto: { fundo: '#050506', painel: '#0d0e10', borda: '#1f2125', texto: '#f0f1f3', destaque: '#4f8cff' }
}

const NOMES_PRONTOS = { grafite: 'Grafite', marinho: 'Marinho', carvao: 'Carvão', preto: 'Preto' }

const LUGARES_PESSOAIS = 4
const CHAVES_DE_COR = ['fundo', 'painel', 'borda', 'texto', 'destaque']

// O que está em uso: um dos prontos ou 'pessoal-0' a 'pessoal-3'.
let temaAtual = 'grafite'

// --- cores -------------------------------------------------------------------

function corValida (cor) {
  return typeof cor === 'string' && /^#[0-9a-f]{6}$/i.test(cor)
}

function paraRgb (cor) {
  const n = parseInt(cor.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function paraHex (rgb) {
  return '#' + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')
}

// t = 0 devolve a, t = 1 devolve b.
function misturar (a, b, t) {
  const x = paraRgb(a)
  const y = paraRgb(b)
  return paraHex(x.map((c, i) => c + (y[i] - c) * t))
}

function luminancia (cor) {
  const [r, g, b] = paraRgb(cor).map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// Razão de contraste da WCAG: 1 (igual) a 21 (preto no branco).
function contraste (a, b) {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x)
  return (claro + 0.05) / (escuro + 0.05)
}

// As variáveis do tema, a partir das cinco escolhidas. As proporções foram
// tiradas do Grafite: aplicadas às cinco cores dele, dão de volta as cores
// dele com diferença de poucos tons.
function derivarPaleta (c) {
  return {
    '--fundo': c.fundo,
    '--painel': c.painel,
    '--painel-alto': misturar(c.painel, c.texto, 0.04),
    '--painel-hover': misturar(c.painel, c.texto, 0.07),
    '--borda': c.borda,
    '--borda-hover': misturar(c.borda, c.texto, 0.06),
    '--avatar': misturar(c.painel, c.texto, 0.1),
    '--campo': misturar(c.fundo, c.painel, 0.15),
    '--apagado': misturar(c.texto, c.fundo, 0.42),
    '--texto': c.texto,
    '--fraco': misturar(c.texto, c.fundo, 0.65),
    '--texto-avatar': misturar(c.texto, c.fundo, 0.14),
    '--listra-1': misturar(c.fundo, c.painel, 0.7),
    '--listra-2': misturar(c.fundo, c.painel, 0.3),
    '--anel-escuro': misturar(c.fundo, '#000000', 0.25),
    '--realce': c.destaque,
    '--realce-hover': misturar(c.destaque, '#000000', 0.1)
  }
}

// Põe as cores num elemento: o <html> para o app inteiro, ou a miniatura de
// um tema nas configurações. Sem cores, tira o que havia.
function pintar (elemento, cores) {
  const paleta = derivarPaleta(cores || CORES_PRONTAS.grafite)
  for (const [variavel, valor] of Object.entries(paleta)) {
    if (cores) elemento.style.setProperty(variavel, valor)
    else elemento.style.removeProperty(variavel)
  }
}

// O que mostrar embaixo das cores no editor. Não impede salvar.
function avisoDeContraste (cores) {
  if (contraste(cores.texto, cores.fundo) < 4.5 || contraste(cores.texto, cores.painel) < 4.5) {
    return 'O texto pode ficar difícil de ler.'
  }
  if (contraste('#ffffff', cores.destaque) < 3) return 'O texto dos botões pode ficar difícil de ler.'
  return ''
}

// --- os temas da pessoa ------------------------------------------------------

// Sempre quatro posições, vazias com null. O que vier quebrado do
// armazenamento vira lugar vazio, em vez de derrubar a abertura do app.
function temasPessoais () {
  let lista = []
  try { lista = JSON.parse(lembrar('liveon:temas-pessoais') || '[]') } catch { lista = [] }
  if (!Array.isArray(lista)) lista = []
  return Array.from({ length: LUGARES_PESSOAIS }, (_, i) => {
    const t = lista[i]
    if (!t || typeof t !== 'object' || !t.cores) return null
    if (!CHAVES_DE_COR.every((k) => corValida(t.cores[k]))) return null
    const cores = {}
    for (const k of CHAVES_DE_COR) cores[k] = t.cores[k].toLowerCase()
    return { nome: String(t.nome || '').trim().slice(0, 24) || 'Meu tema ' + (i + 1), cores }
  })
}

function guardarTemasPessoais (lista) {
  guardar('liveon:temas-pessoais', JSON.stringify(lista))
}

// As cinco cores de qualquer tema, pronto ou da pessoa.
function coresDoTema (nome) {
  if (CORES_PRONTAS[nome]) return { ...CORES_PRONTAS[nome] }
  const m = /^pessoal-(\d)$/.exec(nome || '')
  const pessoal = m && temasPessoais()[Number(m[1])]
  return pessoal ? { ...pessoal.cores } : { ...CORES_PRONTAS.grafite }
}

// --- aplicar -----------------------------------------------------------------

// Mostra cores sem guardar nada: é o que o editor usa enquanto a pessoa
// escolhe. aplicarTema() desfaz.
function previaDeCores (cores) {
  document.documentElement.dataset.tema = 'pessoal'
  pintar(document.documentElement, cores)
}

function aplicarTema (nome) {
  const m = /^pessoal-(\d)$/.exec(nome || '')
  const pessoal = m && temasPessoais()[Number(m[1])]

  if (pessoal) {
    temaAtual = nome
    previaDeCores(pessoal.cores)
  } else {
    temaAtual = TEMAS.includes(nome) ? nome : 'grafite'
    pintar(document.documentElement, null)
    document.documentElement.dataset.tema = temaAtual
  }

  guardar('liveon:tema', temaAtual)
  return temaAtual
}
