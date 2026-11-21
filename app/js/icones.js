// Ícones da interface e a marca do app, num lugar só.

'use strict'

// Ícones de traço, 24x24, pontas e junções redondas, cor do texto em volta
// (currentColor). Os desenhos vêm do protótipo do redesign.
//
// Montados com createElementNS, e não com innerHTML: o app não usa innerHTML
// nem para SVG fixo, e assim a regra fica sem exceção para auditar. Atributo de
// apresentação (stroke, fill) e não style="...": a CSP barra estilo inline, e
// o ícone sairia sem traço nenhum, sem erro na tela.
const DESENHOS = {
  ajustes: [
    ['path', { d: 'M3 6h11M18 6h3M3 12h5M12 12h9M3 18h13M20 18h1' }],
    ['circle', { cx: 16, cy: 6, r: 2 }],
    ['circle', { cx: 10, cy: 12, r: 2 }],
    ['circle', { cx: 18, cy: 18, r: 2 }]
  ],
  som: [
    ['path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }],
    ['path', { d: 'M15.5 8.5a5 5 0 0 1 0 7' }],
    ['path', { d: 'M18.5 5.5a9 9 0 0 1 0 13' }]
  ],
  mudo: [
    ['path', { d: 'M11 5 6 9H3v6h3l5 4V5z' }],
    ['path', { d: 'm22 9-6 6M16 9l6 6' }]
  ],
  expandir: [['path', { d: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7' }]],
  telaCheia: [['path', { d: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3' }]],
  atualizar: [
    ['path', { d: 'M21 12a9 9 0 1 1-3-6.7L21 8' }],
    ['path', { d: 'M21 3v5h-5' }]
  ],
  copiar: [
    ['rect', { x: 9, y: 9, width: 12, height: 12, rx: 2 }],
    ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]
  ],
  transmitir: [
    ['rect', { x: 2, y: 3, width: 20, height: 14, rx: 2 }],
    ['path', { d: 'M8 21h8M12 17v4M9 10l3-3 3 3M12 7v6' }]
  ],
  camera: [
    ['rect', { x: 2, y: 6, width: 14, height: 12, rx: 2 }],
    ['path', { d: 'm16 10 6-3v10l-6-3' }]
  ],
  sair: [['path', { d: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9' }]],
  fechar: [['path', { d: 'M18 6 6 18M6 6l12 12' }]],
  janela: [
    ['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }],
    ['path', { d: 'M2 9h20' }]
  ],
  // Configuracoes do app. Diferente do 'ajustes' (os controles deslizantes),
  // que e o do botao Ajustar e o dos ajustes de cada pessoa: na barra da sala
  // os dois ficam lado a lado e nao podiam ser o mesmo desenho.
  engrenagem: [
    ['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }]
  ],
  pincel: [
    ['path', { d: 'm14.6 3.4 6 6-8.3 8.3a2 2 0 0 1-2.8 0l-3.2-3.2a2 2 0 0 1 0-2.8z' }],
    ['path', { d: 'M5.5 14.5 3 21l6.5-2.5' }]
  ],
  desempenho: [
    ['path', { d: 'm12 14 4-4' }],
    ['path', { d: 'M3.34 19a10 10 0 1 1 17.32 0' }]
  ],
  mais: [['path', { d: 'M12 5v14M5 12h14' }]],
  cadeado: [
    ['rect', { x: 4, y: 11, width: 16, height: 10, rx: 2 }],
    ['path', { d: 'M8 11V7a4 4 0 0 1 8 0v4' }]
  ],
  // Mini tela: uma tela com uma menor no canto.
  pip: [
    ['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }],
    ['rect', { x: 12, y: 12, width: 7, height: 5, rx: 1 }]
  ],
  cursor: [['path', { d: 'M5 3l14 7-6 2-2 6z' }]],
  usuario: [
    ['circle', { cx: 12, cy: 8, r: 4 }],
    ['path', { d: 'M4 21a8 8 0 0 1 16 0' }]
  ],
  lapis: [
    ['path', { d: 'M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z' }],
    ['path', { d: 'm15 5 4 4' }]
  ],
  lixeira: [
    ['path', { d: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2' }],
    ['path', { d: 'M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6' }]
  ],
  // Barras de sinal. Cada barra tem classe propria: o CSS apaga as de cima
  // conforme o sinal piora (ver .sinal em estilo.css).
  sinal: [
    ['path', { d: 'M4 20v-3', class: 'barra-1' }],
    ['path', { d: 'M9.33 20v-7', class: 'barra-2' }],
    ['path', { d: 'M14.67 20v-11', class: 'barra-3' }],
    ['path', { d: 'M20 20v-15', class: 'barra-4' }]
  ]
}

const SVG_NS = 'http://www.w3.org/2000/svg'

function elementoSvg (tipo, atributos) {
  const el = document.createElementNS(SVG_NS, tipo)
  for (const [nome, valor] of Object.entries(atributos)) el.setAttribute(nome, String(valor))
  return el
}

// tamanho em px; traco e a espessura da linha (1.8 na maioria, 2 nos menores).
function icone (nome, tamanho = 15, traco = 1.8) {
  if (nome === 'marca') return marca(tamanho)

  const desenho = DESENHOS[nome]
  if (!desenho) throw new Error('icone desconhecido: ' + nome)

  const svg = elementoSvg('svg', {
    width: tamanho,
    height: tamanho,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': traco,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true'
  })
  for (const [tipo, atributos] of desenho) svg.appendChild(elementoSvg(tipo, atributos))
  return svg
}

// A marca do app (opção 3f do redesign): uma tela com pé e o ponto vermelho
// de "no ar" recortando a quina. Branca, porque ela sempre vai sobre o
// quadrado azul. O círculo maior é o recorte: ele tem a cor do fundo atrás da
// marca, que aqui é o próprio azul. O azul e o vermelho não mudam com o tema.
function marca (tamanho) {
  const svg = elementoSvg('svg', { width: tamanho, height: tamanho, viewBox: '0 0 48 48', 'aria-hidden': 'true' })
  svg.append(
    elementoSvg('rect', { x: 5, y: 9, width: 34, height: 26, rx: 6, fill: 'none', stroke: '#ffffff', 'stroke-width': 4 }),
    elementoSvg('path', { d: 'M15 41h14', fill: 'none', stroke: '#ffffff', 'stroke-width': 4, 'stroke-linecap': 'round' }),
    // As cores ficam tambem como classe: o tema da pessoa troca as duas pelo
    // CSS (--marca, --marca-ponto). O atributo e o padrao, se nao houver.
    elementoSvg('circle', { cx: 39, cy: 11, r: 7.5, fill: '#4f8cff', class: 'marca-recorte' }),
    elementoSvg('circle', { cx: 39, cy: 11, r: 4.5, fill: '#ff4d4f', class: 'marca-ponto' })
  )
  return svg
}

// Troca o ícone de dentro de um botão sem mexer no resto dele (o texto ao lado,
// o title). Usado pelo alto-falante, que alterna entre som e mudo.
function trocarIcone (onde, nome, tamanho = 15, traco = 1.8) {
  const velho = onde.querySelector('svg')
  const novo = icone(nome, tamanho, traco)
  if (velho) velho.replaceWith(novo)
  else onde.prepend(novo)
}

// O HTML só marca onde vai cada ícone: <span data-icone="sair"
// data-tamanho="16">. Assim o desenho de cada um existe num lugar só. Roda no
// carregamento porque os scripts estão no fim do <body>: o HTML já existe.
for (const lugar of document.querySelectorAll('[data-icone]')) {
  lugar.replaceWith(icone(
    lugar.dataset.icone,
    Number(lugar.dataset.tamanho) || 15,
    Number(lugar.dataset.traco) || 1.8
  ))
}
