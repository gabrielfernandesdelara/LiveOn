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
// Fica FORA do tema, de propósito: o vermelho de "no ar" nas pessoas e nos
// cards (é o sinal de quem está transmitindo, tema nenhum pode esconder) e o
// âmbar dos alertas.
//
// Desde a 1.5.9 o tema da pessoa também pode ter:
// - as cores do ÍCONE do LiveOn (o quadrado e o ponto), a pedido do dono,
//   para combinar com o resto. Sem escolha, o quadrado segue o destaque e o
//   ponto fica vermelho. Só dentro do app: o ícone da barra de tarefas é o
//   do instalador;
// - um PAPEL DE PAREDE, que aparece no fundo (atrás das telas e na entrada),
//   com um véu da cor do fundo por cima para escurecer. A imagem é reduzida e
//   comprimida na hora (até PAPEL_MAXIMO) e fica numa chave própria,
//   'liveon:papel-<lugar>', para o JSON dos temas não carregar 400 KB a cada
//   leitura.

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
// Opcionais: sem elas, o ícone segue o destaque e o ponto fica vermelho.
const CHAVES_DO_ICONE = ['marca', 'marcaPonto']
const MARCA_PADRAO = '#4f8cff'
const PONTO_PADRAO = '#ff4d4f'

const PAPEL_MAXIMO = 450 * 1024
const PAPEL_LADO = 1920
const ESCURECER_PADRAO = 0.35
// Onde o papel fica: o ponto da imagem que a pessoa escolheu para o meio
// (x e y de 0 a 100) e o zoom (1 = a imagem cobrindo a janela, ate 3).
const POSICAO_PADRAO = { x: 50, y: 50, zoom: 1 }
const ZOOM_PAPEL_MAXIMO = 3
const FORMATO_DE_PAPEL = /^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/

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
    '--realce-hover': misturar(c.destaque, '#000000', 0.1),
    '--marca': c.marca || c.destaque,
    '--marca-ponto': c.marcaPonto || PONTO_PADRAO
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

// A posicao que vier do armazenamento, dentro dos limites.
function posicaoValida (p) {
  const numero = (v, padrao, min, max) => Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : padrao
  return {
    x: numero(p && p.x, 50, 0, 100),
    y: numero(p && p.y, 50, 0, 100),
    zoom: numero(p && p.zoom, 1, 1, ZOOM_PAPEL_MAXIMO)
  }
}

// As variaveis do papel num elemento: o <html> para o app, ou a previa do
// editor. O CSS faz o resto (html.com-papel body::before e .camada-papel).
function variaveisDoPapel (elemento, papel, escurecer, fundo, posicao) {
  if (!papel) {
    for (const v of ['--papel', '--veu-papel', '--papel-x', '--papel-y', '--papel-zoom']) elemento.style.removeProperty(v)
    return
  }
  const [r, g, b] = paraRgb(fundo)
  const p = posicaoValida(posicao)
  elemento.style.setProperty('--papel', `url("${papel}")`)
  elemento.style.setProperty('--veu-papel', `rgba(${r}, ${g}, ${b}, ${Math.min(0.9, Math.max(0, escurecer))})`)
  elemento.style.setProperty('--papel-x', p.x + '%')
  elemento.style.setProperty('--papel-y', p.y + '%')
  elemento.style.setProperty('--papel-zoom', String(p.zoom))
}

// O papel de parede no fundo do app, com o véu da cor do fundo por cima.
// Sem papel, tira.
function pintarPapel (papel, escurecer, fundo, posicao) {
  const raiz = document.documentElement
  variaveisDoPapel(raiz, papel, escurecer, fundo, posicao)
  raiz.classList.toggle('com-papel', Boolean(papel))
}

// O que mostrar embaixo das cores no editor. Não impede salvar.
function avisoDeContraste (cores) {
  if (contraste(cores.texto, cores.fundo) < 4.5 || contraste(cores.texto, cores.painel) < 4.5) {
    return 'O texto pode ficar difícil de ler.'
  }
  if (contraste('#ffffff', cores.destaque) < 3) return 'O texto dos botões pode ficar difícil de ler.'
  // O desenho do ícone é branco: num quadrado claro ele some.
  if (contraste('#ffffff', cores.marca || cores.destaque) < 2) return 'O desenho do ícone pode sumir nessa cor.'
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
    for (const k of CHAVES_DO_ICONE) if (corValida(t.cores[k])) cores[k] = t.cores[k].toLowerCase()
    const escurecer = Number(t.escurecer)
    return {
      nome: String(t.nome || '').trim().slice(0, 24) || 'Meu tema ' + (i + 1),
      cores,
      papel: t.papel === true,
      escurecer: Number.isFinite(escurecer) ? Math.min(0.9, Math.max(0, escurecer)) : ESCURECER_PADRAO,
      posicao: posicaoValida(t.posicao)
    }
  })
}

// O papel de parede de um lugar, ou '' se nao tiver (ou se vier quebrado).
function papelDoLugar (lugar) {
  const papel = lembrar('liveon:papel-' + lugar)
  return FORMATO_DE_PAPEL.test(papel) ? papel : ''
}

function guardarTemasPessoais (lista) {
  guardar('liveon:temas-pessoais', JSON.stringify(lista))
}

// Tudo de um tema, pronto ou da pessoa: as cores, o papel e o quanto ele
// escurece. É o ponto de partida do editor.
function temaCompleto (nome) {
  if (CORES_PRONTAS[nome]) return { cores: { ...CORES_PRONTAS[nome] }, papel: '', escurecer: ESCURECER_PADRAO, posicao: { ...POSICAO_PADRAO } }
  const m = /^pessoal-(\d)$/.exec(nome || '')
  const pessoal = m && temasPessoais()[Number(m[1])]
  if (!pessoal) return temaCompleto('grafite')
  return {
    cores: { ...pessoal.cores },
    papel: pessoal.papel ? papelDoLugar(Number(m[1])) : '',
    escurecer: pessoal.escurecer,
    posicao: { ...pessoal.posicao }
  }
}

// --- aplicar -----------------------------------------------------------------

// Mostra um tema sem guardar nada: é o que o editor usa enquanto a pessoa
// escolhe. aplicarTema() desfaz.
function previaDeTema ({ cores, papel, escurecer, posicao }) {
  document.documentElement.dataset.tema = 'pessoal'
  pintar(document.documentElement, cores)
  pintarPapel(papel, escurecer, cores.fundo, posicao)
}

function aplicarTema (nome) {
  const m = /^pessoal-(\d)$/.exec(nome || '')
  const pessoal = m && temasPessoais()[Number(m[1])]

  if (pessoal) {
    temaAtual = nome
    previaDeTema(temaCompleto(nome))
  } else {
    temaAtual = TEMAS.includes(nome) ? nome : 'grafite'
    pintar(document.documentElement, null)
    pintarPapel('')
    document.documentElement.dataset.tema = temaAtual
  }

  guardar('liveon:tema', temaAtual)
  return temaAtual
}
