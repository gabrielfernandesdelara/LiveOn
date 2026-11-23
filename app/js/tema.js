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
//
// Desde a 2.0.0 (pedido do dono):
// - PAPEIS PRONTOS: seis papeis de parede desenhados pelo proprio LiveOn
//   (scripts/papeis.js gera os arquivos de app/papeis/). Escolhido um deles,
//   o tema guarda so o caminho ('papeis/aurora.webp'), e nao a imagem;
// - a POSICAO DA ENTRADA: centro, esquerda, direita ou livre (onde a pessoa
//   arrastar), para o papel de parede nao ficar escondido atras da foto e do
//   codigo. Os temas prontos ficam no centro;
// - "Tirar as cores da imagem": sugere o destaque a partir do papel;
// - o FUNDO DA SALA: igual ao papel de parede, uma cor, ou uma imagem propria
//   com os mesmos efeitos. A imagem da sala mora em 'liveon:papel-sala-<lugar>'.
//   Quem escolhe qual fundo vai para a tela e aplicarFundoDaVez(), pela
//   classe na-sala do <html> (posta pelo navegacao.js).

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

// Os papeis que vem com o LiveOn. O id e o nome do arquivo em app/papeis/.
const PAPEIS_PRONTOS = [
  { id: 'aurora', nome: 'Aurora' },
  { id: 'montanhas', nome: 'Montanhas' },
  { id: 'dunas', nome: 'Dunas' },
  { id: 'ondas', nome: 'Ondas' },
  { id: 'oceano', nome: 'Oceano' },
  { id: 'cristais', nome: 'Cristais' }
]
const caminhoDoPapelPronto = (id) => `papeis/${id}.webp`

// Imagem escolhida pela pessoa (data: em WebP) ou um dos prontos.
function papelValido (papel) {
  if (typeof papel !== 'string') return false
  return FORMATO_DE_PAPEL.test(papel) || PAPEIS_PRONTOS.some((p) => caminhoDoPapelPronto(p.id) === papel)
}

// Onde fica a entrada (a foto e o codigo) na tela inicial. Livre guarda o
// ponto, em porcentagem da janela.
const POSICOES_DA_ENTRADA = ['centro', 'esquerda', 'direita', 'livre']
const ENTRADA_PADRAO = { posicao: 'centro', x: 50, y: 50 }

function entradaValida (e) {
  const numero = (v, padrao) => Number.isFinite(Number(v)) ? Math.min(100, Math.max(0, Number(v))) : padrao
  return {
    posicao: POSICOES_DA_ENTRADA.includes(e && e.posicao) ? e.posicao : 'centro',
    x: numero(e && e.x, 50),
    y: numero(e && e.y, 50)
  }
}

function aplicarPosicaoDaEntrada (entrada) {
  const e = entradaValida(entrada)
  const raiz = document.documentElement
  raiz.dataset.entrada = e.posicao
  raiz.style.setProperty('--entrada-x', e.x + '%')
  raiz.style.setProperty('--entrada-y', e.y + '%')
}

// De que lado da entrada fica o trilho dos amigos (2.0.0, pedido do dono:
// "deixe a lista de amigos personalizavel"). Automatico e o lado oposto ao
// da coluna, para nunca ficar em cima da foto e do codigo.
const LADOS_DOS_AMIGOS = ['auto', 'esquerda', 'direita']
const AMIGOS_PADRAO = { lado: 'auto' }

function amigosValidos (a) {
  return { lado: LADOS_DOS_AMIGOS.includes(a && a.lado) ? a.lado : 'auto' }
}

function ladoDosAmigos (amigos, entrada) {
  const lado = amigosValidos(amigos).lado
  if (lado !== 'auto') return lado
  const e = entradaValida(entrada)
  if (e.posicao === 'direita') return 'esquerda'
  if (e.posicao === 'livre' && e.x > 50) return 'esquerda'
  return 'direita'
}

function aplicarLadoDosAmigos (amigos, entrada) {
  document.documentElement.dataset.amigos = ladoDosAmigos(amigos, entrada)
}

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

// Efeitos do papel de parede (2.0.0, a pedido do dono): a pessoa escolhe
// quanto de cada um e pode combinar. Viram filtros de CSS na camada do papel
// (estilo.css), entao nao mexem na imagem guardada: tirar o efeito traz a
// imagem de volta igual. O Escurecer, que ja existia, e o veu da cor do
// fundo e continua a parte.
//
// - desfoque, em px da janela (a previa recebe proporcional ao tamanho dela);
// - brilho e contraste, em % (100 = como a imagem e);
// - cores, a saturacao em %: 0 e preto e branco, 200 e cor forte;
// - vinheta, em %: escurece as bordas e deixa o meio.
const EFEITOS_PADRAO = { desfoque: 0, brilho: 100, cores: 100, contraste: 100, vinheta: 0 }
const LIMITES_DOS_EFEITOS = {
  desfoque: [0, 40],
  brilho: [40, 160],
  cores: [0, 200],
  contraste: [50, 150],
  vinheta: [0, 100]
}

// O fundo da sala de um tema. 'igual' usa o papel de parede (o de sempre).
const MODOS_DO_FUNDO_DA_SALA = ['igual', 'cor', 'imagem']

function salaValida (s, fundo) {
  const escurecer = Number(s && s.escurecer)
  return {
    modo: MODOS_DO_FUNDO_DA_SALA.includes(s && s.modo) ? s.modo : 'igual',
    cor: corValida(s && s.cor) ? s.cor.toLowerCase() : fundo,
    papel: Boolean(s && s.papel),
    escurecer: Number.isFinite(escurecer) ? Math.min(0.9, Math.max(0, escurecer)) : ESCURECER_PADRAO,
    posicao: posicaoValida(s && s.posicao),
    efeitos: efeitosValidos(s && s.efeitos)
  }
}

function efeitosValidos (e) {
  const certos = {}
  for (const [nome, [min, max]] of Object.entries(LIMITES_DOS_EFEITOS)) {
    const v = Number(e && e[nome])
    certos[nome] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : EFEITOS_PADRAO[nome]
  }
  return certos
}

// As variaveis do papel num elemento: o <html> para o app, ou a previa do
// editor. O CSS faz o resto (html.com-papel body::before e .camada-papel).
const VARIAVEIS_DO_PAPEL = ['--papel', '--veu-papel', '--papel-x', '--papel-y', '--papel-zoom',
  '--papel-desfoque', '--papel-brilho', '--papel-cores', '--papel-contraste', '--papel-vinheta']

function variaveisDoPapel (elemento, papel, escurecer, fundo, posicao, efeitos) {
  if (!papel) {
    for (const v of VARIAVEIS_DO_PAPEL) elemento.style.removeProperty(v)
    return
  }
  const [r, g, b] = paraRgb(fundo)
  const p = posicaoValida(posicao)
  const e = efeitosValidos(efeitos)
  elemento.style.setProperty('--papel', corValida(papel) ? `linear-gradient(${papel}, ${papel})` : `url("${papel}")`)
  elemento.style.setProperty('--veu-papel', `rgba(${r}, ${g}, ${b}, ${Math.min(0.9, Math.max(0, escurecer))})`)
  elemento.style.setProperty('--papel-x', p.x + '%')
  elemento.style.setProperty('--papel-y', p.y + '%')
  elemento.style.setProperty('--papel-zoom', String(p.zoom))
  // O desfoque e em px: na previa, que e uma janela em miniatura, ele
  // encolhe na mesma proporcao, senao a previa borraria muito mais que o app.
  const escala = elemento === document.documentElement ? 1 : (elemento.clientWidth || 256) / Math.max(1, window.innerWidth)
  elemento.style.setProperty('--papel-desfoque', (e.desfoque * escala).toFixed(2) + 'px')
  elemento.style.setProperty('--papel-brilho', String(e.brilho / 100))
  elemento.style.setProperty('--papel-cores', String(e.cores / 100))
  elemento.style.setProperty('--papel-contraste', String(e.contraste / 100))
  elemento.style.setProperty('--papel-vinheta', String((e.vinheta / 100) * 0.9))
}

// O papel de parede no fundo do app, com o véu da cor do fundo por cima.
// Sem papel, tira.
function pintarPapel (papel, escurecer, fundo, posicao, efeitos) {
  const raiz = document.documentElement
  variaveisDoPapel(raiz, papel, escurecer, fundo, posicao, efeitos)
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
      posicao: posicaoValida(t.posicao),
      entrada: entradaValida(t.entrada),
      amigos: amigosValidos(t.amigos),
      efeitos: efeitosValidos(t.efeitos),
      sala: salaValida(t.sala, cores.fundo)
    }
  })
}

// O papel de parede de um lugar, ou '' se nao tiver (ou se vier quebrado).
function papelDoLugar (lugar) {
  const papel = lembrar('liveon:papel-' + lugar)
  return papelValido(papel) ? papel : ''
}

// A imagem do fundo da sala de um lugar, ou ''.
function papelDaSala (lugar) {
  const papel = lembrar('liveon:papel-sala-' + lugar)
  return papelValido(papel) ? papel : ''
}

function guardarTemasPessoais (lista) {
  guardar('liveon:temas-pessoais', JSON.stringify(lista))
}

// Tudo de um tema, pronto ou da pessoa: as cores, o papel e o quanto ele
// escurece. É o ponto de partida do editor.
function temaCompleto (nome) {
  if (CORES_PRONTAS[nome]) {
    return {
      cores: { ...CORES_PRONTAS[nome] },
      papel: '',
      escurecer: ESCURECER_PADRAO,
      posicao: { ...POSICAO_PADRAO },
      entrada: { ...ENTRADA_PADRAO },
      amigos: { ...AMIGOS_PADRAO },
      efeitos: { ...EFEITOS_PADRAO },
      sala: { ...salaValida(null, CORES_PRONTAS[nome].fundo), papel: '' }
    }
  }
  const m = /^pessoal-(\d)$/.exec(nome || '')
  const pessoal = m && temasPessoais()[Number(m[1])]
  if (!pessoal) return temaCompleto('grafite')
  return {
    cores: { ...pessoal.cores },
    papel: pessoal.papel ? papelDoLugar(Number(m[1])) : '',
    escurecer: pessoal.escurecer,
    posicao: { ...pessoal.posicao },
    entrada: { ...pessoal.entrada },
    amigos: { ...pessoal.amigos },
    efeitos: { ...pessoal.efeitos },
    sala: { ...pessoal.sala, posicao: { ...pessoal.sala.posicao }, efeitos: { ...pessoal.sala.efeitos }, papel: pessoal.sala.papel ? papelDaSala(Number(m[1])) : '' }
  }
}

// --- aplicar -----------------------------------------------------------------

// Mostra um tema sem guardar nada: é o que o editor usa enquanto a pessoa
// escolhe. aplicarTema() desfaz.
// O tema que esta pintado agora (o da pessoa, ou null num pronto), para a
// troca de fundo entre a entrada e a sala.
let temaNaTela = null

function previaDeTema (tema) {
  temaNaTela = tema
  document.documentElement.dataset.tema = 'pessoal'
  pintar(document.documentElement, tema.cores)
  aplicarPosicaoDaEntrada(tema.entrada)
  aplicarLadoDosAmigos(tema.amigos, tema.entrada)
  aplicarFundoDaVez()
}

// O fundo certo para onde a pessoa esta: na sala, o fundo da sala do tema
// (uma cor ou uma imagem); fora dela, ou com o fundo da sala 'igual', o papel
// de parede.
function aplicarFundoDaVez () {
  const t = temaNaTela
  const naSala = document.documentElement.classList.contains('na-sala')
  const s = t && t.sala
  if (!t) pintarPapel('')
  else if (naSala && s && s.modo === 'cor') pintarPapel(s.cor, 0, t.cores.fundo, POSICAO_PADRAO, EFEITOS_PADRAO)
  else if (naSala && s && s.modo === 'imagem' && s.papel) pintarPapel(s.papel, s.escurecer, t.cores.fundo, s.posicao, s.efeitos)
  else pintarPapel(t.papel, t.escurecer, t.cores.fundo, t.posicao, t.efeitos)
  if (typeof atualizarFundoDaEntrada === 'function') atualizarFundoDaEntrada()
}

function aplicarTema (nome) {
  const m = /^pessoal-(\d)$/.exec(nome || '')
  const pessoal = m && temasPessoais()[Number(m[1])]

  if (pessoal) {
    temaAtual = nome
    previaDeTema(temaCompleto(nome))
  } else {
    temaAtual = TEMAS.includes(nome) ? nome : 'grafite'
    temaNaTela = null
    pintar(document.documentElement, null)
    aplicarPosicaoDaEntrada(ENTRADA_PADRAO)
    aplicarLadoDosAmigos(AMIGOS_PADRAO, ENTRADA_PADRAO)
    document.documentElement.dataset.tema = temaAtual
    aplicarFundoDaVez()
  }

  guardar('liveon:tema', temaAtual)
  return temaAtual
}

// --- tirar as cores da imagem -------------------------------------------------

// O destaque sugerido por um papel de parede: a cor viva que mais aparece
// nele. A imagem e reduzida para 96x54, cada pixel vai para uma de 24 faixas
// de matiz, pesado pelo quanto ele e vivo (saturado e nem escuro nem claro
// demais), e a faixa mais pesada vence. A cor sai com o brilho de um botao:
// saturada e com luminosidade media, para o texto branco continuar legivel.
// Sem nenhuma cor viva (imagem cinza), devolve ''.
async function corDoPapel (papel) {
  const imagem = new Image()
  imagem.src = papel
  try { await imagem.decode() } catch { return '' }
  const tela = new OffscreenCanvas(96, 54)
  const ctx = tela.getContext('2d')
  ctx.drawImage(imagem, 0, 0, 96, 54)
  const dados = ctx.getImageData(0, 0, 96, 54).data
  const faixas = Array.from({ length: 24 }, () => ({ peso: 0, h: 0, s: 0 }))
  for (let i = 0; i < dados.length; i += 4) {
    const r = dados[i] / 255
    const g = dados[i + 1] / 255
    const b = dados[i + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    if (d < 0.08) continue
    const s = d / (1 - Math.abs(2 * l - 1))
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = (h * 60 + 360) % 360
    const peso = s * (1 - Math.abs(2 * l - 1))
    const faixa = faixas[Math.floor(h / 15) % 24]
    faixa.peso += peso
    faixa.h += h * peso
    faixa.s += s * peso
  }
  const melhor = faixas.reduce((a, b) => (b.peso > a.peso ? b : a))
  if (melhor.peso < 3) return ''
  const h = melhor.h / melhor.peso
  const s = Math.max(0.55, Math.min(0.85, melhor.s / melhor.peso))
  return deHsl(h, s, 0.56)
}

function deHsl (h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return paraHex([(r + m) * 255, (g + m) * 255, (b + m) * 255])
}
