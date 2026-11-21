// Exemplos: passando o mouse numa opção que muda algo que se vê, aparece um
// desenho pequeno de como vai ficar (pedido do dono, 1.5.9).
//
// O desenho é montado aqui, com elementos e as cores do tema em uso, e não
// é imagem pronta: assim ele acompanha o tema, inclusive o da pessoa, e não
// fica desatualizado quando a interface muda. Quem quiser um exemplo marca o
// elemento com data-exemplo="<nome>"; os nomes estão em EXEMPLOS.
//
// Opção que não muda nada visível (placa de vídeo, prioridade) não ganha
// exemplo: não há o que desenhar. Os temas também não: a miniatura deles já
// é o exemplo.

'use strict'

// Um card de mentira: a "tela" de alguém, com uns blocos no lugar do
// conteúdo.
function cardDeExemplo () {
  const card = document.createElement('div')
  card.className = 'ex-card'
  const tela = document.createElement('div')
  tela.className = 'ex-tela'
  for (const classe of ['ex-bloco ex-bloco-1', 'ex-bloco ex-bloco-2', 'ex-bloco ex-bloco-3']) {
    const bloco = document.createElement('span')
    bloco.className = classe
    tela.appendChild(bloco)
  }
  card.appendChild(tela)
  return card
}

function seloDeExemplo () {
  const selo = document.createElement('span')
  selo.className = 'ex-selo'
  const inicial = document.createElement('span')
  inicial.className = 'ex-inicial'
  inicial.textContent = 'A'
  const ponto = document.createElement('span')
  ponto.className = 'ex-ponto'
  inicial.appendChild(ponto)
  selo.appendChild(inicial)
  return selo
}

function webcamDeExemplo (formato) {
  const cam = document.createElement('span')
  cam.className = 'ex-cam ex-cam-' + formato
  // Uma "pessoa": cabeça e ombros.
  cam.appendChild(icone('usuario', formato === 'selo' ? 14 : 18, 2))
  return cam
}

const EXEMPLOS = {
  'camera-canto': () => {
    const card = cardDeExemplo()
    card.append(webcamDeExemplo('canto'), seloDeExemplo())
    return [card, 'A webcam fica num retângulo, no canto de cima.']
  },
  'camera-selo': () => {
    const card = cardDeExemplo()
    card.appendChild(webcamDeExemplo('selo'))
    return [card, 'A webcam fica redonda, no lugar da inicial.']
  },
  // Dois cards: parado, sem nada; com o mouse mexendo, a inicial aparece.
  'selo-mouse': () => {
    const par = document.createElement('div')
    par.className = 'ex-par'
    const parado = cardDeExemplo()
    const mexendo = cardDeExemplo()
    const cursor = document.createElement('span')
    cursor.className = 'ex-cursor'
    cursor.appendChild(icone('cursor', 14, 1.8))
    mexendo.append(seloDeExemplo(), cursor)
    par.append(parado, mexendo)
    return [par, 'Parado, o card fica limpo. Com o mouse mexendo em cima, a inicial aparece.']
  },
  'selo-sempre': () => {
    const card = cardDeExemplo()
    card.appendChild(seloDeExemplo())
    return [card, 'A inicial fica sempre no canto do card.']
  }
}

function mostrarExemplo (alvo) {
  const montar = EXEMPLOS[alvo.dataset.exemplo]
  if (!montar) return
  const [desenho, legenda] = montar()

  const caixa = $('#exemplo')
  caixa.textContent = ''
  const texto = document.createElement('span')
  texto.className = 'ex-legenda'
  texto.textContent = legenda
  caixa.append(desenho, texto)
  caixa.classList.remove('oculto')

  // Em cima da opção, centrado; sem espaço em cima, embaixo. Nunca para
  // fora da janela.
  const r = alvo.getBoundingClientRect()
  const largura = caixa.offsetWidth
  const altura = caixa.offsetHeight
  const x = Math.min(window.innerWidth - largura - 8, Math.max(8, r.left + r.width / 2 - largura / 2))
  const cabeEmCima = r.top - altura - 10 >= 8
  const y = cabeEmCima ? r.top - altura - 10 : r.bottom + 10
  caixa.style.left = Math.round(x) + 'px'
  caixa.style.top = Math.round(y) + 'px'
}

function esconderExemplo () {
  $('#exemplo').classList.add('oculto')
}

// Delegado no documento: vale para qualquer elemento com data-exemplo, mesmo
// os criados depois.
document.addEventListener('mouseover', (evento) => {
  const alvo = evento.target.closest && evento.target.closest('[data-exemplo]')
  if (alvo) mostrarExemplo(alvo)
})
document.addEventListener('mouseout', (evento) => {
  const alvo = evento.target.closest && evento.target.closest('[data-exemplo]')
  if (alvo && !alvo.contains(evento.relatedTarget)) esconderExemplo()
})
// Clicou, escolheu: o exemplo já cumpriu o papel.
document.addEventListener('click', esconderExemplo)
