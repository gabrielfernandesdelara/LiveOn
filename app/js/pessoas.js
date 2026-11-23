// Quem está na sala: o botão com avatares na barra e o pop-over com a lista.

'use strict'

// A inicial de alguém. Array.from em vez de nome[0]: num nome que começa com
// emoji, [0] parte o caractere ao meio e o avatar mostraria um símbolo
// quebrado.
function inicialDe (nome) {
  const primeira = Array.from(String(nome || '').trim())[0]
  return primeira ? primeira.toLocaleUpperCase('pt-BR') : '?'
}

// Quadradinho com a inicial e, para quem está no ar, o ponto vermelho. O
// tamanho e as cores vêm do CSS de cada lugar: .selo, .pilha, .pessoa.
//
// Com o id, mostra a foto de perfil por cima da inicial, se a pessoa tiver
// (perfil.js). A inicial fica embaixo: se a imagem falhar, ela aparece. O
// ponto vem depois da foto, para ficar por cima dela.
function criarAvatar (nome, noAr = true, id = null) {
  const avatar = document.createElement('span')
  avatar.className = 'avatar'
  avatar.textContent = inicialDe(nome)

  const foto = id ? fotoDe(id) : ''
  if (foto) {
    const imagem = document.createElement('img')
    imagem.className = 'foto'
    imagem.alt = ''
    imagem.draggable = false
    imagem.src = foto
    avatar.appendChild(imagem)
    avatar.classList.add('com-foto')
  }

  // Quem acabou de entrar no ar ganha a onda no ponto, uma vez (animacoes.js).
  const acendeu = id && typeof acabouDeAcender === 'function' && acabouDeAcender(id, noAr)
  if (noAr) {
    const ponto = document.createElement('span')
    ponto.className = acendeu ? 'ponto acendendo' : 'ponto'
    avatar.appendChild(ponto)
  }
  return avatar
}

// TODO mundo na sala, inclusive quem não está transmitindo, que é justamente
// quem não aparece na grade. Eu sempre primeiro.
//
// `transmitindo` é a tela, `camera` é a webcam, e `noAr` é qualquer uma das
// duas: é o que acende o ponto vermelho e dá um card na grade. A grade usa
// esta mesma função, para as duas nunca discordarem sobre quem está no ar.
function quemEstaNaSala () {
  const eu = {
    id: meuId,
    nome: meuNome,
    souEu: true,
    transmitindo: Boolean(streamLocal),
    camera: Boolean(streamCamera)
  }
  const outros = [...participantes.values()].map((p) => ({
    id: p.id,
    nome: p.nome,
    souEu: false,
    // O vídeo pode chegar antes do aviso: os dois caminhos são independentes.
    transmitindo: Boolean(p.transmitindo) || streamsRecebidos.has(p.id),
    camera: Boolean(p.camera) || camerasRecebidas.has(p.id)
  }))

  return [eu, ...outros].map((p) => ({ ...p, noAr: p.transmitindo || p.camera }))
}

// O que aparece embaixo do nome. Só da minha transmissão eu sei o nome da
// fonte: o dos outros não viaja pela sala, o protocolo não manda. E é melhor
// assim, título de janela costuma ter nome de documento ou assunto de e-mail.
function legendaDe (pessoa) {
  if (!pessoa.transmitindo) return pessoa.camera ? 'com a câmera ligada' : 'assistindo'

  let texto = 'transmitindo'
  if (pessoa.souEu) {
    const fonte = fontesCarregadas.find((f) => f.id === fonteAtual)
    if (fonte) texto += ' · ' + fonte.nome
  }
  return pessoa.camera ? texto + ' · câmera' : texto
}


function desenharPessoas () {
  const todos = quemEstaNaSala()
  const noAr = todos.filter((p) => p.noAr).length

  // O botão: até três avatares empilhados, e o total.
  const pilha = $('#pilha-pessoas')
  // Onde cada avatar estava, para deslizarem ate o lugar novo (animacoes.js).
  const antes = medirPilha()
  pilha.textContent = ''
  for (const pessoa of todos.slice(0, 3)) {
    const avatar = criarAvatar(pessoa.nome, pessoa.noAr, pessoa.id)
    avatar.dataset.id = pessoa.id
    pilha.appendChild(avatar)
  }
  animarPilha(antes)
  $('#total-pessoas').textContent = String(todos.length)

  // O cabeçalho do pop-over.
  $('#pop-total').textContent = String(todos.length)
  $('#pop-no-ar-texto').textContent = noAr + ' no ar'
  $('#pop-no-ar').classList.toggle('oculto', noAr === 0)

  const alvo = $('#lista-pessoas')
  alvo.textContent = ''

  for (const pessoa of todos) {
    const linha = document.createElement('div')
    linha.className = 'pessoa' + (pessoa.souEu ? ' eu' : '')

    const textos = document.createElement('span')
    textos.className = 'textos'

    const nome = document.createElement('span')
    nome.className = 'nome'
    nome.textContent = pessoa.souEu ? `${pessoa.nome} (você)` : pessoa.nome
    nome.title = nome.textContent
    marcarDono(nome, pessoa.id)

    const sub = document.createElement('span')
    sub.className = 'sub'
    sub.textContent = legendaDe(pessoa)

    textos.append(nome, sub)
    linha.append(criarAvatar(pessoa.nome, pessoa.noAr, pessoa.id), textos)

    // No modo expandido as miniaturas somem, então a lista vira o único jeito
    // de trocar de transmissão sem sair do destaque. O pop-over fica aberto
    // depois da troca, para dar para ir passando de uma em uma.
    const emDestaque = Boolean(idTelaCheia) && idTelaCheia === pessoa.id
    const trocavel = Boolean(idTelaCheia) && pessoa.noAr && !emDestaque
    linha.classList.toggle('em-destaque', emDestaque)
    linha.classList.toggle('trocavel', trocavel)
    if (trocavel) {
      linha.onclick = (evento) => {
        // A engrenagem tem o clique dela. Sem stopPropagation de propósito: o
        // clique precisa chegar ao document, que é onde o autoplay barrado
        // é destravado.
        if (evento.target.closest('.engrenagem')) return
        destacar(pessoa.id, janelaAcompanha)
      }
    }

    // As engrenagens da lista (a minha, saída de áudio; a dos outros,
    // qualidade e volume) saíram na 2.1.0, a pedido do dono: a saída mora na
    // aba Áudio e a qualidade de todas as telas na aba Telas. A qualidade e o
    // volume de UMA pessoa continuam nos ajustes do card dela.

    // Tirar da sala: o dono direto, os outros por votacao (remocao.js).
    if (!pessoa.souEu && podeTirar()) linha.appendChild(criarBotaoTirar(pessoa))

    alvo.appendChild(linha)
  }

  // Quem entra e sai muda a lotacao que os amigos veem (amigos.js).
  if (meuId) atualizarPresencaNaSala()
}

// --- pop-over ----------------------------------------------------------------
//
// Abre e fecha no clique do botão. Fecha também ao clicar fora, no Esc, ao
// abrir qualquer diálogo e ao expandir um card.

function pessoasAbertas () {
  return !$('#pessoas').classList.contains('oculto')
}

function abrirPessoas () {
  $('#pessoas').classList.remove('oculto')
  $('#btn-pessoas').setAttribute('aria-expanded', 'true')
}

function fecharPessoas () {
  $('#pessoas').classList.add('oculto')
  $('#btn-pessoas').setAttribute('aria-expanded', 'false')
}

function alternarPessoas () {
  if (pessoasAbertas()) fecharPessoas()
  else abrirPessoas()
}

function escreverEstado (id, estado) {
  const card = cardDe(id)
  if (!card) return
  const rotulos = {
    new: '',
    connecting: 'conectando...',
    connected: '',
    disconnected: 'instável',
    failed: 'falhou',
    closed: ''
  }
  card.querySelector('.estado').textContent = rotulos[estado] !== undefined ? rotulos[estado] : estado
}
