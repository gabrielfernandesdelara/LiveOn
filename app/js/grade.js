// Grade de telas: os cards, o vídeo de cada um e o cálculo do tamanho.

'use strict'

function cardDe (id) {
  return document.querySelector('.card[data-id="' + id + '"]')
}

// Liga o stream guardado ao card, se os dois existirem.
function aplicarVideo (id) {
  const card = cardDe(id)
  const stream = streamsRecebidos.get(id)
  if (!card || !stream) return

  const video = card.querySelector('video')
  if (video.srcObject !== stream) video.srcObject = stream
  card.classList.add('com-video')

  // Agora que a pessoa tem trilha, a saida escolhida pode ser aplicada. Se o
  // card nasceu sem audio, esta e a segunda chance dele.
  aplicarSaidaEm(video)

  // Video remoto tem audio, e o Chromium bloqueia autoplay com som sem gesto
  // do usuario, era a tela preta e parada. Entra mudo (que sempre e
  // permitido) e marca; o primeiro clique em qualquer lugar devolve o som.
  video.play().catch(() => {
    video.muted = true
    video.dataset.mudoForcado = '1'
    video.play().catch(() => {})
    anotar('autoplay bloqueado num card: entrou mudo')
  })
}

// Quem parou de transmitir some da grade. Sem isso o card ficava com o ultimo
// quadro congelado, parecendo que a pessoa continuava no ar.
function limparVideo (id) {
  streamsRecebidos.delete(id)

  const card = cardDe(id)
  if (card) {
    const video = card.querySelector('video')
    video.srcObject = null
    video.load()
    card.classList.remove('com-video')
  }

  sincronizarGrade()
}

// Sem foco:      todas as telas do mesmo tamanho, preenchendo a area.
// Uma em foco:   ela grande, as outras numa coluna a direita.
// Duas ou mais:  elas grandes lado a lado, as outras numa faixa embaixo.
//
// O tamanho e sempre calculado, nunca fixo: e o que impede um card de
// empurrar os outros para fora da janela.

const LARGURA_MINIMA = 160

// Piso das miniaturas. Abaixo disso nao da para reconhecer a tela de ninguem,
// e a faixa passa a rolar em vez de encolher mais.
const LARGURA_MINI = 116

// O gap entre miniaturas no CSS. Nao e o mesmo FOLGA dos cards grandes.
const FOLGA_MINI = 10

const PROPORCAO = 16 / 9

const FOLGA = 14

const focados = new Set()

function definirLargura (card, largura) {
  card.style.setProperty('--largura', Math.round(largura) + 'px')

  // A barra de volume abre para cima e o card corta o que passa dele. Os 80px
  // sao o que o popup gasta fora da barra, de baixo para cima: 9 do canto do
  // card (8 + a borda), 34 do bloco de controles (botao de 28 + 3 de padding
  // em cima e embaixo), 11 de folga, 22 de padding e borda da propria barra,
  // e o resto de respiro no topo. Medido varrendo larguras de 210 a 700px:
  // nenhuma estoura. Teto de 92px, que ja e curso de sobra.
  const altura = largura / PROPORCAO
  const barra = Math.max(40, Math.min(92, Math.round(altura - 80)))
  card.style.setProperty('--altura-barra', barra + 'px')

  // Abaixo de 120px de altura o popup nao cabe nem com a barra no minimo de
  // 40. Nesse tamanho o som sai da sobreposicao e fica so na engrenagem, que
  // tambem tem volume.
  card.classList.toggle('minusculo', altura < 120)
}

// Maior largura que faz N cards caberem na area mantendo 16:9. Testa todas as
// divisoes possiveis em colunas e fica com a que rende o card maior.
function melhorLargura (quantidade, largura, altura, rodape) {
  let melhor = 0

  for (let colunas = 1; colunas <= quantidade; colunas++) {
    const linhas = Math.ceil(quantidade / colunas)
    const porLargura = (largura - FOLGA * (colunas - 1)) / colunas
    const alturaPorLinha = (altura - FOLGA * (linhas - 1)) / linhas
    const porAltura = (alturaPorLinha - rodape) * PROPORCAO
    melhor = Math.max(melhor, Math.min(porLargura, porAltura))
  }

  return Math.max(LARGURA_MINIMA, Math.floor(melhor))
}

// Destrava o que o autoplay barrou. So mexe em quem foi mudado a forca ,
// quem o usuario mutou de proposito continua mudo.
function destravarVideos () {
  for (const video of document.querySelectorAll('.palco video')) {
    if (!video.srcObject) continue

    if (video.dataset.mudoForcado) {
      delete video.dataset.mudoForcado
      // A marca e do autoplay, nao da escolha do usuario: quem esta em 0%
      // continua mudo. Sem este if, um clique qualquer tirava o mudo de um
      // card que a pessoa tinha silenciado de proposito.
      if (video.volume > 0) video.muted = false
    }
    if (video.paused) video.play().catch(() => {})
  }
}

document.addEventListener('click', destravarVideos)

// Mover um <video> no DOM pode pausar a reproducao; retomar e barato.
function moverCard (card, destino, antesDe) {
  destino.insertBefore(card, antesDe || null)
  const video = card.querySelector('video')
  if (video && video.srcObject) video.play().catch(() => {})
}

// Coloca a lista na ordem dentro do destino, mexendo so em quem esta fora
// do lugar, mover a toa reiniciaria os videos.
function acomodar (lista, destino) {
  for (let i = 0; i < lista.length; i++) {
    if (destino.children[i] !== lista[i]) {
      moverCard(lista[i], destino, destino.children[i] || null)
    }
  }
}

function organizarGrade () {
  const grade = $('#grade')
  const cards = [...grade.querySelectorAll('.card')]

  // Quem saiu da sala nao continua em foco.
  for (const id of [...focados]) {
    if (!cards.some((c) => c.dataset.id === id)) focados.delete(id)
  }

  // Tela cheia manda em tudo: uma tela so, sem barra e sem miniaturas.
  if (idTelaCheia && !cards.some((c) => c.dataset.id === idTelaCheia)) idTelaCheia = null
  $('#sala').classList.toggle('tela-cheia', Boolean(idTelaCheia) && janelaAcompanha)
  $('#sala').classList.toggle('expandido', Boolean(idTelaCheia) && !janelaAcompanha)
  // A lista marca quem esta em destaque, entao ela e redesenhada junto.
  desenharPessoas()

  let emFoco = idTelaCheia
    ? cards.filter((c) => c.dataset.id === idTelaCheia)
    : cards.filter((c) => focados.has(c.dataset.id))

  // Focar TODAS da exatamente o mesmo layout de nao focar nenhuma, a unica
  // diferenca era acender a borda em todo mundo. Focar a unica tela da sala
  // cai no mesmo caso. Em tela cheia isto nao vale: la o destaque e legitimo.
  if (!idTelaCheia && emFoco.length === cards.length) {
    focados.clear()
    emFoco = []
  }
  const grandes = emFoco.length ? emFoco : cards
  // Derivar de emFoco, e nao do conjunto `focados`: em tela cheia o destaque
  // vem de idTelaCheia, e usar `focados` mandava ate o card em destaque para
  // a faixa oculta.
  const pequenos = emFoco.length ? cards.filter((c) => !emFoco.includes(c)) : []

  grade.classList.toggle('sem-foco', emFoco.length === 0)
  grade.classList.toggle('foco-lateral', emFoco.length === 1)
  grade.classList.toggle('foco-inferior', emFoco.length >= 2)

  for (const card of cards) card.classList.toggle('focado', focados.has(card.dataset.id))

  acomodar(grandes, $('#principal'))
  acomodar(pequenos, $('#miniaturas'))

  // Na miniatura nao ha controles: o gesto e o duplo clique, e o title avisa.
  for (const card of grandes) card.removeAttribute('title')
  for (const card of pequenos) card.title = 'Duplo clique para destacar'

  distribuir()
}

function distribuir () {
  const grade = $('#grade')
  const principal = $('#principal')

  const grandes = [...principal.querySelectorAll('.card')]
  const pequenos = [...$('#miniaturas').querySelectorAll('.card')]
  if (grandes.length === 0) return

  // Nada rouba altura do video: nome e controles sao sobreposicao.
  const rodape = 0

  // As miniaturas primeiro: o tamanho delas tira espaco do resto.
  //
  // O tamanho sai do espaco que a faixa REALMENTE tem, e nao de uma largura
  // fixa. Antes a coluna travava entre 170 e 280px sem olhar a altura: com 6
  // telas e uma em foco, duas das cinco miniaturas ficavam fora da tela, atras
  // de uma rolagem que ninguem percebe. Sumir com a tela de um amigo sem aviso
  // e pior do que mostra-la pequena.
  if (pequenos.length) {
    const lateral = grade.classList.contains('foco-lateral')
    const n = pequenos.length

    // O card tem 1px de borda em cima e embaixo, e o 16:9 vale para o palco
    // DENTRO dela. Sem descontar isso, cada miniatura sai 2px mais alta que a
    // conta e a faixa ganha barra de rolagem por alguns pixels.
    const alturaPorMini = (grade.clientHeight - 32 - FOLGA_MINI * (n - 1)) / n

    const largura = lateral
      // Coluna: manda a altura disponivel dividida entre todas.
      ? Math.max(LARGURA_MINI, Math.min(280, (alturaPorMini - 2) * PROPORCAO + 2))
      // Faixa embaixo: manda a largura.
      : Math.max(LARGURA_MINI, Math.min(240,
          (grade.clientWidth - 32 - FOLGA_MINI * (n - 1)) / n))

    for (const card of pequenos) definirLargura(card, largura)
  }

  // clientWidth/Height aqui ja descontam o espaco das miniaturas.
  const largura = melhorLargura(
    grandes.length,
    principal.clientWidth,
    principal.clientHeight,
    rodape
  )
  for (const card of grandes) definirLargura(card, largura)
}

window.addEventListener('resize', distribuir)

function criarCard (id, nome, souEu) {
  const card = document.createElement('article')
  card.className = 'card'
  card.dataset.id = id

  const palco = document.createElement('div')
  palco.className = 'palco'

  const video = document.createElement('video')
  video.autoplay = true
  video.playsInline = true
  // O proprio video entra mudo: ouvir o proprio audio do sistema vira eco.
  video.muted = souEu

  // Card novo nasce ja tocando na saida escolhida.
  aplicarSaidaEm(video)

  const vazio = document.createElement('div')
  vazio.className = 'vazio'
  vazio.textContent = 'conectando...'

  palco.append(video, vazio)

  // Quem e, sobreposto ao video: a inicial com o ponto de "no ar", e o nome
  // por extenso, que abre com o mouse em cima (o CSS cuida disso).
  const selo = document.createElement('div')
  selo.className = 'selo'

  const nomeDoSelo = document.createElement('span')
  nomeDoSelo.className = 'nome'

  const quem = document.createElement('span')
  quem.className = 'quem'
  quem.textContent = souEu ? nome + ' (você)' : nome

  // Estado da conexao com aquela pessoa ("instável", "falhou"), ao lado do
  // nome. Escrito por escreverEstado(), em pessoas.js.
  const estado = document.createElement('span')
  estado.className = 'estado'

  nomeDoSelo.append(quem, estado)
  selo.append(criarAvatar(nome), nomeDoSelo)

  const flutuantes = document.createElement('div')
  flutuantes.className = 'controles-flutuantes'

  // O proprio card nao tem volume nem ajustes: ele e mudo para nao dar eco,
  // e a qualidade da minha transmissao sai do seletor de fontes.
  if (!souEu) {
    const engrenagem = document.createElement('button')
    engrenagem.className = 'icone-card'
    engrenagem.title = 'Configurações da tela'
    engrenagem.appendChild(icone('ajustes'))
    engrenagem.onclick = () => abrirAjustes(id)

    const caixaSom = document.createElement('div')
    caixaSom.className = 'caixa-som'

    // O icone (som ou mudo) e posto por aplicarVolume(), que e chamado logo
    // que o card nasce.
    const altoFalante = document.createElement('button')
    altoFalante.className = 'icone-card alto-falante'
    altoFalante.title = 'Silenciar'
    altoFalante.appendChild(icone('som'))
    altoFalante.onclick = () => alternarMudo(id)

    const barra = document.createElement('div')
    barra.className = 'barra-vertical'

    const volume = document.createElement('input')
    volume.type = 'range'
    volume.className = 'volume'
    volume.min = '0'
    volume.max = '100'
    volume.value = '100'
    volume.title = 'Volume desta tela'
    volume.oninput = () => aplicarVolume(id, Number(volume.value))
    volume.onchange = () => registrarVolume(id)

    barra.appendChild(volume)
    caixaSom.append(altoFalante, barra)
    flutuantes.append(engrenagem, caixaSom)
  }

  const botaoExpandir = document.createElement('button')
  botaoExpandir.className = 'icone-card'
  botaoExpandir.title = 'Preencher a janela (Esc para sair)'
  botaoExpandir.appendChild(icone('expandir'))
  botaoExpandir.onclick = () => expandir(id)

  const botaoCheia = document.createElement('button')
  botaoCheia.className = 'icone-card'
  botaoCheia.title = 'Tela cheia (Esc para sair)'
  botaoCheia.appendChild(icone('telaCheia'))
  botaoCheia.onclick = () => alternarTelaCheia(id)

  flutuantes.append(botaoExpandir, botaoCheia)

  palco.append(selo, flutuantes)

  // Focar e so por duplo clique: o botao proprio saiu, era mais um item
  // disputando espaco na sobreposicao.
  palco.addEventListener('dblclick', () => alternarFoco(id))

  card.appendChild(palco)
  return card
}

function sincronizarGrade () {
  const grade = $('#grade')

  // So quem esta transmitindo ganha um card. Quem esta na sala sem compartilhar
  // nada nao ocupa espaco na grade, aparece so na contagem da barra.
  //
  // "tem stream" entra na conta porque o video pode chegar antes do aviso; sem
  // isso a tela ficaria de fora ate a mensagem alcancar.
  const esperados = [
    { id: meuId, nome: meuNome, souEu: true, transmitindo: Boolean(streamLocal) },
    ...[...participantes.values()].map((p) => ({
      ...p,
      souEu: false,
      transmitindo: p.transmitindo || streamsRecebidos.has(p.id)
    }))
  ].filter((pessoa) => pessoa.transmitindo)

  // Remove cards de quem saiu. Busca por .card e nao por filhos diretos,
  // porque no modo foco parte deles vive dentro da faixa de miniaturas.
  for (const card of [...grade.querySelectorAll('.card')]) {
    if (!esperados.some((e) => e.id === card.dataset.id)) card.remove()
  }

  for (const pessoa of esperados) {
    let card = cardDe(pessoa.id)
    if (!card) {
      card = criarCard(pessoa.id, pessoa.nome, pessoa.souEu)
      $('#principal').appendChild(card)
      if (!pessoa.souEu) {
        aplicarVideo(pessoa.id)
        // O card e novo, mas a escolha de volume da pessoa nao e.
        aplicarVolume(pessoa.id, volumeDe(pessoa.id))
      }
    }
    card.classList.toggle('no-ar', Boolean(pessoa.transmitindo))

    // O meu card mostra a previa do que estou mandando.
    if (pessoa.souEu) {
      const video = card.querySelector('video')
      if (streamLocal) {
        if (video.srcObject !== streamLocal) video.srcObject = streamLocal
        card.classList.add('com-video')
      } else {
        video.srcObject = null
        card.classList.remove('com-video')
      }
    }
  }

  // A contagem de gente e os avatares do botao saem daqui tambem.
  desenharPessoas()

  // Grade vazia precisa dizer o porque, senao parece que o app travou.
  $('#grade-vazia').classList.toggle('oculto', esperados.length > 0)

  // Recoloca cada card no lugar certo (foco ou grade normal) e reencaixa
  // os tamanhos, inclusive quando alguem entra ou sai.
  organizarGrade()
}
