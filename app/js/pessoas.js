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
function criarAvatar (nome, noAr = true) {
  const avatar = document.createElement('span')
  avatar.className = 'avatar'
  avatar.textContent = inicialDe(nome)

  if (noAr) {
    const ponto = document.createElement('span')
    ponto.className = 'ponto'
    avatar.appendChild(ponto)
  }
  return avatar
}

// TODO mundo na sala, inclusive quem não está transmitindo, que é justamente
// quem não aparece na grade. Eu sempre primeiro.
function quemEstaNaSala () {
  return [
    { id: meuId, nome: meuNome, souEu: true, transmitindo: Boolean(streamLocal) },
    ...[...participantes.values()].map((p) => ({
      ...p,
      souEu: false,
      // Mesma regra da grade: o vídeo pode chegar antes do aviso.
      transmitindo: p.transmitindo || streamsRecebidos.has(p.id)
    }))
  ]
}

// O que aparece embaixo do nome. Só da minha transmissão eu sei o nome da
// fonte: o dos outros não viaja pela sala, o protocolo não manda. E é melhor
// assim, título de janela costuma ter nome de documento ou assunto de e-mail.
function legendaDe (pessoa) {
  if (!pessoa.transmitindo) return 'assistindo'
  if (pessoa.souEu) {
    const fonte = fontesCarregadas.find((f) => f.id === fonteAtual)
    if (fonte) return 'transmitindo · ' + fonte.nome
  }
  return 'transmitindo'
}

function criarEngrenagem (titulo, aoClicar) {
  const botao = document.createElement('button')
  botao.className = 'engrenagem'
  botao.title = titulo
  botao.appendChild(icone('ajustes'))
  botao.onclick = () => {
    // Abrir qualquer diálogo fecha o pop-over.
    fecharPessoas()
    aoClicar()
  }
  return botao
}

function desenharPessoas () {
  const todos = quemEstaNaSala()
  const noAr = todos.filter((p) => p.transmitindo).length

  // O botão: até três avatares empilhados, e o total.
  const pilha = $('#pilha-pessoas')
  pilha.textContent = ''
  for (const pessoa of todos.slice(0, 3)) pilha.appendChild(criarAvatar(pessoa.nome, pessoa.transmitindo))
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

    const sub = document.createElement('span')
    sub.className = 'sub'
    sub.textContent = legendaDe(pessoa)

    textos.append(nome, sub)
    linha.append(criarAvatar(pessoa.nome, pessoa.transmitindo), textos)

    // No modo expandido as miniaturas somem, então a lista vira o único jeito
    // de trocar de transmissão sem sair do destaque. O pop-over fica aberto
    // depois da troca, para dar para ir passando de uma em uma.
    const emDestaque = Boolean(idTelaCheia) && idTelaCheia === pessoa.id
    const trocavel = Boolean(idTelaCheia) && pessoa.transmitindo && !emDestaque
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

    // Na minha linha a engrenagem é a saída de áudio: por onde EU ouço. Não
    // depende de estar transmitindo, então ela fica sempre.
    if (pessoa.souEu) linha.appendChild(criarEngrenagem('Saída de áudio', abrirSaida))

    // Nos outros ela é a qualidade e o volume daquela pessoa, e só faz sentido
    // para quem está no ar. Da minha própria transmissão quem manda é o
    // seletor de fontes.
    if (!pessoa.souEu && pessoa.transmitindo) {
      linha.appendChild(criarEngrenagem(`Configurações de ${pessoa.nome}`, () => abrirAjustes(pessoa.id)))
    }

    alvo.appendChild(linha)
  }
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
