// Amigos (2.0.0, pedido do dono): código de amigo, quem está online e em que
// sala, pedido para entrar e convite. O servidor é o nuvem/src/amigos.js.
//
// - Cada pessoa é um SEGREDO sorteado aqui (liveon:amigos-segredo) e nunca
//   mostrado. O servidor guarda o hash dele; é a ele que a amizade fica
//   presa. Perder o segredo (formatar, apagar os dados do app) é virar outra
//   pessoa: os amigos precisam adicionar de novo.
// - O código de amigo é "Nome#1234". Trocar o nome sorteia outro (pedido do
//   dono); quem já é amigo continua, e vê o nome novo.
// - Na tela inicial, o trilho de fotos na borda (escolha B do dono), do lado
//   que o tema mandar (aplicarLadoDosAmigos, tema.js). O clique abre a lista.
// - O código da SALA nunca vai para a presença: os amigos veem o nome da sala
//   e quantos estão nela. Ele só passa quando alguém de dentro ACEITA um
//   pedido para entrar, ou quando alguém de dentro convida.

'use strict'

let wsAmigos = null
let amigosApresentado = false
let tentativasAmigos = 0
let temporizadorAmigos = null
let batidaAmigos = null

// Quem eu sou para os amigos: o id (hash do segredo) e o código.
const euAmigo = { id: '', tag: '' }
// id -> { id, nome, tag, foto, online, sala }
const amigos = new Map()
let pedidosRecebidos = []
let pedidosEnviados = []
let invisivel = lembrar('liveon:invisivel') === 'sim'
// O nome que o servidor conhece: so troca o codigo quando muda de verdade.
let nomeDosAmigos = ''
let temporizadorNome = null
// O meu pedido para entrar: { pedido, salaId, ateQuando } ou { salaId, nota }.
let meuPedido = null
let relogioPedido = null
// Quem eu chamei, para o botao virar "Chamado" por um tempo: id -> ate quando.
const chamados = new Map()
// O resumo do codigo da minha sala, e o que ja foi mandado de presenca.
let presencaEnviada
const resumos = new Map()

const VALIDADE_CHAMADO = 60000

// --- identidade --------------------------------------------------------------

// Sem conseguir GUARDAR o segredo, nao conecta: senao cada abertura do app
// seria uma pessoa nova, com um codigo novo.
function segredoDosAmigos () {
  const guardado = lembrar('liveon:amigos-segredo') || ''
  if (/^[a-z0-9]{32}$/.test(guardado)) return guardado
  const bytes = new Uint32Array(32)
  crypto.getRandomValues(bytes)
  let novo = ''
  for (const n of bytes) novo += ALFABETO[n % ALFABETO.length]
  guardar('liveon:amigos-segredo', novo)
  return lembrar('liveon:amigos-segredo') === novo ? novo : ''
}

// --- conexao -------------------------------------------------------------------

function conectarAmigos () {
  if (wsAmigos || !meuNomeSalvo()) return
  const segredo = segredoDosAmigos()
  if (!segredo) return anotar('amigos: sem onde guardar a identidade, nao conecta')

  let meu
  try { meu = new WebSocket(`${SERVIDOR}/amigos/${segredo}`) } catch { return }
  wsAmigos = meu
  amigosApresentado = false

  meu.onopen = () => {
    if (wsAmigos !== meu) return
    nomeDosAmigos = meuNomeSalvo()
    meu.send(JSON.stringify({ tipo: 'ola', nome: nomeDosAmigos, foto: minhaFoto(), invisivel }))
    clearInterval(batidaAmigos)
    batidaAmigos = setInterval(() => {
      try { meu.send(JSON.stringify({ tipo: 'ping' })) } catch { /* fechando */ }
    }, 25000)
  }

  meu.onmessage = (evento) => {
    if (wsAmigos !== meu) return
    let msg
    try { msg = JSON.parse(evento.data) } catch { return }
    if (!msg || typeof msg !== 'object' || typeof msg.tipo !== 'string') return
    tratarAmigos(msg)
  }

  meu.onerror = () => {}

  meu.onclose = () => {
    if (wsAmigos !== meu) return
    wsAmigos = null
    amigosApresentado = false
    clearInterval(batidaAmigos)
    // O que estava esperando resposta nao vai receber: solta o botao e o
    // pedido para entrar, senao ficavam presos em "Mandando...".
    $('#btn-mandar-pedido').disabled = false
    if ($('#nota-amigo').textContent === 'Mandando...') mostrarNotaDosAmigos('Sem conexão. Tente de novo em instantes.', true)
    if (meuPedido && !meuPedido.pedido) meuPedido = null
    // Os amigos ficam na tela, mas sem saber quem esta online.
    for (const amigo of amigos.values()) { amigo.online = false; amigo.sala = null }
    desenharAmigos()
    tentativasAmigos++
    const espera = Math.min(1000 * 2 ** (tentativasAmigos - 1), 30000)
    clearTimeout(temporizadorAmigos)
    temporizadorAmigos = setTimeout(conectarAmigos, espera)
  }
}

function enviarAmigos (msg) {
  if (!wsAmigos || wsAmigos.readyState !== WebSocket.OPEN || !amigosApresentado) return false
  wsAmigos.send(JSON.stringify(msg))
  return true
}

// Fechou o app: offline na hora, e nao depois da carencia de quem cai.
window.addEventListener('pagehide', () => {
  if (wsAmigos && wsAmigos.readyState === WebSocket.OPEN) {
    try { wsAmigos.send(JSON.stringify({ tipo: 'tchau' })) } catch { /* fechando */ }
  }
})

// Voltou a internet: tenta na hora, sem esperar a espera crescente.
window.addEventListener('online', () => {
  if (wsAmigos) return
  clearTimeout(temporizadorAmigos)
  tentativasAmigos = 0
  conectarAmigos()
})

// --- mensagens -----------------------------------------------------------------

function tratarAmigos (msg) {
  switch (msg.tipo) {
    case 'voce': {
      tentativasAmigos = 0
      amigosApresentado = true
      euAmigo.id = msg.id
      euAmigo.tag = msg.tag
      invisivel = Boolean(msg.invisivel)
      amigos.clear()
      for (const amigo of msg.amigos || []) amigos.set(amigo.id, amigo)
      pedidosRecebidos = msg.recebidos || []
      pedidosEnviados = msg.enviados || []
      presencaEnviada = undefined
      atualizarPresencaNaSala()
      // O nome pode ter mudado enquanto estava desconectado.
      if (meuNomeSalvo() && meuNomeSalvo() !== nomeDosAmigos) mandarNomeAosAmigos()
      desenharAmigos()
      return
    }
    case 'codigo':
      euAmigo.tag = msg.tag
      return desenharAmigos()
    case 'invisivel':
      invisivel = Boolean(msg.valor)
      return desenharAmigos()
    case 'amigo': {
      const antes = amigos.get(msg.amigo.id) || {}
      const amigo = { ...antes, ...msg.amigo }
      if (msg.amigo.foto === undefined) amigo.foto = antes.foto || ''
      amigos.set(amigo.id, amigo)
      if (msg.novo) avisoRapido(amigo, `${amigo.nome} entrou na sua lista de amigos.`)
      return desenharAmigos()
    }
    case 'amigo-removido':
      amigos.delete(msg.id)
      return desenharAmigos()
    // A lista inteira de novo (o servidor manda quando uma amizade antiga
    // volta). Sem este caso, o amigo so aparecia depois de reconectar.
    case 'amigos':
      amigos.clear()
      for (const amigo of msg.amigos || []) amigos.set(amigo.id, amigo)
      return desenharAmigos()
    case 'pedidos':
      pedidosRecebidos = msg.recebidos || []
      pedidosEnviados = msg.enviados || []
      return desenharAmigos()
    case 'pedido-amizade':
      notificar(`${msg.de.nome} quer te adicionar como amigo`, msg.de.tag)
      tocarPedidoDeAmizade()
      return avisoDeAmizade(msg.de)
    case 'adicionado':
      return respostaDoAdicionar(msg)
    case 'pedido-entrada-enviado':
      return pedidoEntradaEnviado(msg)
    case 'entrada-aceita':
      return entradaAceita(msg)
    case 'entrada-recusada':
      if (!meuPedido) return
      meuPedido = { salaId: meuPedido.salaId, nota: msg.expirou ? 'Ninguém respondeu.' : 'Não aceitaram o pedido.' }
      return desenharAmigos()
    case 'pedido-entrada':
      return pedidoDeEntrada(msg)
    case 'entrada-encerrada':
    case 'entrada-respondida':
      return tirarAviso('entrada:' + msg.pedido)
    case 'convite':
      notificar(`${msg.de.nome} te chamou`, msg.rotulo || 'para uma sala')
      tocarConvite()
      return avisoDeConvite(msg)
    case 'convite-enviado':
      if (!msg.entregue) chamados.delete(msg.para)
      return desenharChamar()
    case 'erro':
      anotar('amigos: ' + msg.motivo)
      // Recusa do pedido para entrar (muitos pedidos): a nota vai na sala, e
      // nao fica "Mandando..." para sempre.
      if (meuPedido && !meuPedido.pedido) {
        meuPedido = { salaId: meuPedido.salaId, nota: msg.motivo }
        return desenharLista()
      }
      if (/espere/i.test(msg.motivo)) mostrarNotaDosAmigos(msg.motivo, true)
  }
}

// --- presenca: em que sala estou -------------------------------------------------

// Um resumo do codigo, para os amigos saberem quem esta na MESMA sala sem
// saberem o codigo. Do resumo nao se volta ao codigo.
async function resumoDaSala (codigo) {
  if (resumos.has(codigo)) return resumos.get(codigo)
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('liveon-sala:' + codigo))
  const resumo = [...new Uint8Array(bytes)].slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('')
  resumos.set(codigo, resumo)
  return resumo
}

let salaAtualResumo = ''

// Chamado pelo desenharPessoas (toda entrada e saida) e pelo
// voltarParaEntrada. Manda so quando muda.
async function atualizarPresencaNaSala () {
  let sala = null
  if (meuId && sessao && sessao.codigo) {
    sala = { id: await resumoDaSala(sessao.codigo), rotulo: rotuloDaSala || 'Sala', quantos: participantes.size + 1 }
  }
  salaAtualResumo = sala ? sala.id : ''
  const texto = JSON.stringify(sala)
  if (texto !== presencaEnviada && enviarAmigos({ tipo: 'presenca', sala })) presencaEnviada = texto
  desenharChamar()
  desenharLista()
}

// --- nome e foto ---------------------------------------------------------------

// O nome grava a cada letra (entrada.js), mas o codigo so troca quando a
// pessoa termina: cada letra sortearia um codigo novo.
function agendarNomeDosAmigos () {
  clearTimeout(temporizadorNome)
  temporizadorNome = setTimeout(mandarNomeAosAmigos, 2000)
}

function mandarNomeAosAmigos () {
  clearTimeout(temporizadorNome)
  const nome = meuNomeSalvo()
  if (!nome) return
  if (!wsAmigos) return conectarAmigos()
  if (nome === nomeDosAmigos) return
  if (enviarAmigos({ tipo: 'perfil', nome })) nomeDosAmigos = nome
}

function mandarFotoAosAmigos () {
  enviarAmigos({ tipo: 'perfil', foto: minhaFoto() })
}

function definirInvisivel (valor) {
  invisivel = valor === 'sim'
  guardar('liveon:invisivel', invisivel ? 'sim' : 'nao')
  enviarAmigos({ tipo: 'invisivel', valor: invisivel })
  desenharAmigos()
}

// --- desenho -------------------------------------------------------------------

function avatarDeAmigo (amigo, estado = true) {
  const avatar = criarAvatar(amigo.nome || '?', false, null)
  const foto = typeof amigo.foto === 'string' && amigo.foto.length <= FOTO_RECEBIDA_MAXIMA && FORMATO_DE_FOTO.test(amigo.foto) ? amigo.foto : ''
  if (foto) {
    const imagem = document.createElement('img')
    imagem.className = 'foto'
    imagem.alt = ''
    imagem.draggable = false
    imagem.src = foto
    avatar.appendChild(imagem)
    avatar.classList.add('com-foto')
  }
  if (estado) {
    const ponto = document.createElement('span')
    ponto.className = 'estado-amigo' + (amigo.sala ? ' em-sala' : amigo.online ? ' online' : '')
    avatar.appendChild(ponto)
  }
  if (!amigo.online) avatar.classList.add('offline')
  return avatar
}

// Numa sala primeiro, depois online, depois offline; por nome em cada grupo.
function amigosEmOrdem () {
  const peso = (a) => (a.sala ? 0 : a.online ? 1 : 2)
  return [...amigos.values()].sort((a, b) => peso(a) - peso(b) || String(a.nome).localeCompare(String(b.nome), 'pt-BR'))
}

function desenharAmigos () {
  desenharTrilho()
  desenharLista()
  desenharChamar()
  desenharCodigoNoPerfil()
}

const FOTOS_NO_TRILHO = 6

function desenharTrilho () {
  const caixa = $('#amigos-entrada')
  if (!caixa) return
  caixa.classList.toggle('oculto', !meuNomeSalvo())
  const fotos = $('#fotos-amigos')
  fotos.textContent = ''
  const lista = amigosEmOrdem()
  for (const amigo of lista.slice(0, FOTOS_NO_TRILHO)) {
    const avatar = avatarDeAmigo(amigo)
    avatar.title = amigo.sala ? `${amigo.nome}, numa sala` : amigo.online ? `${amigo.nome}, online` : amigo.nome
    fotos.appendChild(avatar)
  }
  if (lista.length > FOTOS_NO_TRILHO) {
    const resto = document.createElement('span')
    resto.className = 'resto-amigos'
    resto.textContent = '+' + (lista.length - FOTOS_NO_TRILHO)
    fotos.appendChild(resto)
  }
  const selo = $('#selo-pedidos')
  selo.textContent = String(pedidosRecebidos.length)
  selo.classList.toggle('oculto', pedidosRecebidos.length === 0)
  const online = lista.filter((a) => a.online).length
  $('#btn-amigos').title = online ? `Amigos: ${online} online` : 'Amigos'
}

function linhaDeAmigo (amigo, sub) {
  const linha = document.createElement('div')
  linha.className = 'pessoa amigo' + (amigo.online ? '' : ' offline')
  linha.appendChild(avatarDeAmigo(amigo))
  const textos = document.createElement('span')
  textos.className = 'textos'
  const nome = document.createElement('span')
  nome.className = 'nome'
  nome.textContent = amigo.nome || amigo.tag || '?'
  const legenda = document.createElement('span')
  legenda.className = 'sub'
  legenda.textContent = sub
  textos.append(nome, legenda)
  linha.appendChild(textos)
  return linha
}

function botaoPequeno (texto, acao, classe = '') {
  const botao = document.createElement('button')
  botao.className = 'botao-amigo ' + classe
  botao.textContent = texto
  botao.onclick = (evento) => { evento.stopPropagation(); acao(botao) }
  return botao
}

function tituloDeSecao (texto) {
  const titulo = document.createElement('div')
  titulo.className = 'secao-amigos'
  titulo.textContent = texto
  return titulo
}

// Remover pede dois cliques: o primeiro so pergunta.
function botaoRemover (amigo) {
  const botao = document.createElement('button')
  botao.className = 'remover-amigo botao-icone'
  botao.title = 'Desfazer amizade'
  botao.appendChild(icone('lixeira', 14))
  botao.onclick = (evento) => {
    evento.stopPropagation()
    if (botao.classList.contains('confirmar')) return enviarAmigos({ tipo: 'remover', id: amigo.id })
    botao.classList.add('confirmar')
    botao.textContent = 'Remover?'
    setTimeout(() => {
      if (!botao.isConnected) return
      botao.classList.remove('confirmar')
      botao.textContent = ''
      botao.appendChild(icone('lixeira', 14))
    }, 3000)
  }
  return botao
}

function textoDosNomes (nomes) {
  if (nomes.length <= 1) return nomes[0] || ''
  return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1]
}

function desenharLista () {
  const corpo = $('#corpo-amigos')
  if (!corpo) return
  corpo.textContent = ''
  $('#meu-codigo-amigo').textContent = euAmigo.tag || '...'
  const lista = amigosEmOrdem()
  const online = lista.filter((a) => a.online).length
  $('#total-online').textContent = online ? `${online} online` : ''

  if (!amigosApresentado && !amigos.size) {
    const vazio = document.createElement('p')
    vazio.className = 'vazio-amigos'
    vazio.textContent = navigator.onLine ? 'Conectando...' : 'Sem internet.'
    corpo.appendChild(vazio)
    return
  }

  // Pedidos de amizade esperando resposta.
  if (pedidosRecebidos.length) {
    corpo.appendChild(tituloDeSecao('Pedidos de amizade'))
    for (const pedido of pedidosRecebidos) {
      const linha = linhaDeAmigo({ ...pedido, online: true }, pedido.tag)
      linha.classList.add('pedido')
      linha.append(
        botaoPequeno('Recusar', () => enviarAmigos({ tipo: 'responder-amizade', id: pedido.id, aceitar: false })),
        botaoPequeno('Aceitar', () => enviarAmigos({ tipo: 'responder-amizade', id: pedido.id, aceitar: true }), 'principal')
      )
      corpo.appendChild(linha)
    }
  }

  // Numa sala: agrupados por sala. Um pedido vai para todos os amigos que
  // estao nela, e o primeiro que aceitar manda o codigo.
  const salas = new Map()
  for (const amigo of lista) {
    if (!amigo.sala) continue
    if (!salas.has(amigo.sala.id)) salas.set(amigo.sala.id, { sala: amigo.sala, amigos: [] })
    salas.get(amigo.sala.id).amigos.push(amigo)
  }
  if (salas.size) corpo.appendChild(tituloDeSecao('Numa sala'))
  for (const [id, grupo] of salas) {
    const linha = document.createElement('div')
    linha.className = 'pessoa sala-amigos'
    const pilha = document.createElement('span')
    pilha.className = 'pilha-amigos'
    for (const amigo of grupo.amigos.slice(0, 3)) pilha.appendChild(avatarDeAmigo(amigo, false))
    const textos = document.createElement('span')
    textos.className = 'textos'
    const nome = document.createElement('span')
    nome.className = 'nome'
    nome.textContent = textoDosNomes(grupo.amigos.map((a) => a.nome))
    const sub = document.createElement('span')
    sub.className = 'sub'
    const pessoas = grupo.sala.quantos === 1 ? '1 pessoa' : `${grupo.sala.quantos} pessoas`
    sub.textContent = `${grupo.sala.rotulo} · ${pessoas}`
    textos.append(nome, sub)
    linha.append(pilha, textos)

    if (id === salaAtualResumo) {
      sub.textContent = 'Na sua sala'
    } else if (meuPedido && meuPedido.salaId === id && meuPedido.pedido) {
      const restam = Math.max(0, Math.ceil((meuPedido.ateQuando - Date.now()) / 1000))
      linha.appendChild(botaoPequeno(`Esperando ${restam} s`, cancelarMeuPedido, 'esperando'))
      linha.lastChild.title = 'Cancelar o pedido'
    } else {
      linha.appendChild(botaoPequeno('Pedir', () => pedirParaEntrar(id, grupo.amigos.map((a) => a.id)), 'principal'))
      linha.lastChild.title = 'Pedir para entrar nessa sala'
      if (meuPedido && meuPedido.salaId === id && meuPedido.nota) sub.textContent = meuPedido.nota
    }
    corpo.appendChild(linha)
  }

  const soOnline = lista.filter((a) => a.online && !a.sala)
  if (soOnline.length) corpo.appendChild(tituloDeSecao('Online'))
  for (const amigo of soOnline) {
    const linha = linhaDeAmigo(amigo, 'Online')
    linha.appendChild(botaoRemover(amigo))
    corpo.appendChild(linha)
  }

  const offline = lista.filter((a) => !a.online)
  if (offline.length) corpo.appendChild(tituloDeSecao('Offline'))
  for (const amigo of offline) {
    const linha = linhaDeAmigo(amigo, amigo.tag)
    linha.appendChild(botaoRemover(amigo))
    corpo.appendChild(linha)
  }

  if (pedidosEnviados.length) {
    corpo.appendChild(tituloDeSecao('Esperando resposta'))
    for (const pedido of pedidosEnviados) {
      const linha = linhaDeAmigo({ ...pedido, online: false }, pedido.tag)
      linha.appendChild(botaoPequeno('Cancelar', () => enviarAmigos({ tipo: 'cancelar-amizade', id: pedido.id })))
      corpo.appendChild(linha)
    }
  }

  if (!lista.length && !pedidosRecebidos.length && !pedidosEnviados.length) {
    const vazio = document.createElement('p')
    vazio.className = 'vazio-amigos'
    vazio.textContent = 'Nenhum amigo ainda. Mande o seu código para alguém, ou adicione o de um amigo.'
    corpo.appendChild(vazio)
  }
}

// Na sala, dentro da lista de pessoas: amigos online que nao estao aqui.
function desenharChamar () {
  const caixa = $('#chamar-amigos')
  if (!caixa) return
  const alvo = $('#lista-chamar')
  alvo.textContent = ''
  const fora = meuId ? amigosEmOrdem().filter((a) => a.online && (!a.sala || a.sala.id !== salaAtualResumo)) : []
  caixa.classList.toggle('oculto', fora.length === 0)
  for (const amigo of fora) {
    const linha = linhaDeAmigo(amigo, amigo.sala ? amigo.sala.rotulo : 'Online')
    const chamado = (chamados.get(amigo.id) || 0) > Date.now()
    const botao = botaoPequeno(chamado ? 'Chamado' : 'Chamar', () => chamarAmigo(amigo.id), chamado ? '' : 'principal')
    botao.disabled = chamado
    linha.appendChild(botao)
    alvo.appendChild(linha)
  }
}

function desenharCodigoNoPerfil () {
  const lugar = $('#codigo-amigo-perfil')
  if (lugar) lugar.textContent = euAmigo.tag || (navigator.onLine ? 'Conectando...' : 'Sem internet')
  for (const botao of document.querySelectorAll('#opcao-invisivel button')) {
    botao.classList.toggle('ativo', botao.dataset.valor === (invisivel ? 'sim' : 'nao'))
  }
}

// --- a lista na entrada ----------------------------------------------------------

function listaDeAmigosAberta () {
  return !$('#lista-amigos').classList.contains('oculto')
}

function abrirListaDeAmigos () {
  $('#lista-amigos').classList.remove('oculto')
  $('#btn-amigos').setAttribute('aria-expanded', 'true')
  desenharLista()
}

function fecharListaDeAmigos () {
  $('#lista-amigos').classList.add('oculto')
  $('#btn-amigos').setAttribute('aria-expanded', 'false')
  $('#adicionar-amigo').classList.add('oculto')
}

function mostrarAdicionar (codigo = '') {
  abrirListaDeAmigos()
  $('#adicionar-amigo').classList.remove('oculto')
  const campo = $('#campo-amigo')
  if (codigo) campo.value = codigo
  mostrarNotaDosAmigos('')
  campo.focus()
}

function mostrarNotaDosAmigos (texto, alerta = false) {
  const nota = $('#nota-amigo')
  nota.textContent = texto
  nota.classList.toggle('alerta', alerta)
}

// Nome#1234, do jeito que a pessoa colou ou digitou.
const CODIGO_DE_AMIGO = /^\s*(.{1,32}?)\s*#\s*(\d{4})\s*$/

function codigoDeAmigo (texto) {
  const achado = CODIGO_DE_AMIGO.exec(String(texto || ''))
  return achado ? `${achado[1].trim()}#${achado[2]}` : ''
}

function mandarPedidoDeAmizade () {
  const tag = codigoDeAmigo($('#campo-amigo').value)
  if (!tag) return mostrarNotaDosAmigos('Escreva o código do amigo, como Ana#1234.', true)
  if (!enviarAmigos({ tipo: 'adicionar', tag })) return mostrarNotaDosAmigos('Sem conexão. Tente de novo em instantes.', true)
  $('#btn-mandar-pedido').disabled = true
  mostrarNotaDosAmigos('Mandando...')
}

function respostaDoAdicionar (msg) {
  $('#btn-mandar-pedido').disabled = false
  if (!msg.ok) return mostrarNotaDosAmigos(msg.motivo || 'Não deu certo.', true)
  $('#campo-amigo').value = ''
  mostrarNotaDosAmigos('Pedido enviado. Falta a outra pessoa aceitar.')
}

// O campo da sala recebeu um codigo de AMIGO: em vez de "codigo incompleto",
// oferece adicionar. Chamado pelo entrarOuCriar.
function codigoDeAmigoNaEntrada (texto) {
  const tag = codigoDeAmigo(texto)
  if (!tag) return false
  mostrarErroEntrada('Esse é um código de amigo, não de sala.', 'codigo')
  mostrarAdicionar(tag)
  return true
}

async function copiarMeuCodigo (botao) {
  if (!euAmigo.tag) return
  let ok = false
  try { ok = await window.ponte.copiar(euAmigo.tag) } catch { /* sem ponte */ }
  if (ok) tocarCopiado()
  if (!ok || !botao) return
  botao.classList.add('copiado')
  setTimeout(() => botao.classList.remove('copiado'), 1600)
}

// --- pedir para entrar -----------------------------------------------------------

function pedirParaEntrar (salaId, ids) {
  if (!enviarAmigos({ tipo: 'pedir-entrada', para: ids })) return
  meuPedido = { salaId, pedido: null, nota: 'Mandando...' }
  desenharLista()
}

function pedidoEntradaEnviado (msg) {
  if (!meuPedido) return
  if (!msg.entregues) {
    meuPedido = { salaId: meuPedido.salaId, nota: 'Ninguém recebeu o pedido.' }
    return desenharLista()
  }
  meuPedido = { salaId: meuPedido.salaId, pedido: msg.pedido, ateQuando: Date.now() + (msg.validade || 60000) }
  clearInterval(relogioPedido)
  relogioPedido = setInterval(() => {
    if (!meuPedido || !meuPedido.pedido) return clearInterval(relogioPedido)
    if (Date.now() > meuPedido.ateQuando) {
      clearInterval(relogioPedido)
      enviarAmigos({ tipo: 'cancelar-entrada' })
      meuPedido = { salaId: meuPedido.salaId, nota: 'Ninguém respondeu.' }
    }
    desenharLista()
  }, 1000)
  desenharLista()
}

function cancelarMeuPedido () {
  clearInterval(relogioPedido)
  enviarAmigos({ tipo: 'cancelar-entrada' })
  meuPedido = null
  desenharLista()
}

// Aceito (ou convite aceito): entra com o codigo que veio, como se a pessoa
// tivesse colado. Se ja estiver numa sala, sai dela antes.
function entrarComCodigoDeAmigo (codigo) {
  clearInterval(relogioPedido)
  meuPedido = null
  fecharListaDeAmigos()
  // Ja estou nessa sala (o convite cruzou com a minha entrada): sair e
  // entrar de novo derrubaria a malha a toa.
  if (meuId && sessao && sessao.codigo === codigo) return
  if (meuId) $('#btn-sair').click()
  definirModo('entrar')
  $('#campo-codigo').value = codigo
  entrarOuCriar()
}

function entradaAceita (msg) {
  tocarPedidoAceito()
  anotar('amigos: pedido para entrar aceito, entrando')
  entrarComCodigoDeAmigo(msg.codigo)
}

// Alguem quer entrar na minha sala. Fora de sala, recusa calado: a presenca
// dele estava velha.
function pedidoDeEntrada (msg) {
  if (!meuId || !sessao) {
    return enviarAmigos({ tipo: 'responder-entrada', pedido: msg.pedido, de: msg.de.id, aceitar: false })
  }
  const amigo = amigos.get(msg.de.id) || msg.de
  notificar(`${msg.de.nome} quer entrar na sala`, rotuloDaSala)
  tocarPedidoDeEntrada()
  mostrarAviso({
    chave: 'entrada:' + msg.pedido,
    amigo,
    titulo: `${msg.de.nome} quer entrar`,
    validade: msg.validade || 60000,
    botoes: [
      { texto: 'Recusar', acao: () => enviarAmigos({ tipo: 'responder-entrada', pedido: msg.pedido, de: msg.de.id, aceitar: false }) },
      {
        texto: 'Aceitar',
        principal: true,
        acao: () => {
          if (!meuId || !sessao) return
          enviarAmigos({ tipo: 'responder-entrada', pedido: msg.pedido, de: msg.de.id, aceitar: true, codigo: sessao.codigo, rotulo: rotuloDaSala })
        }
      }
    ]
  })
}

// --- convidar ----------------------------------------------------------------------

function chamarAmigo (id) {
  if (!meuId || !sessao) return
  if (!enviarAmigos({ tipo: 'convidar', para: id, codigo: sessao.codigo, rotulo: rotuloDaSala })) return
  chamados.set(id, Date.now() + VALIDADE_CHAMADO)
  setTimeout(desenharChamar, VALIDADE_CHAMADO + 100)
  desenharChamar()
}

function avisoDeConvite (msg) {
  const amigo = amigos.get(msg.de.id) || msg.de
  mostrarAviso({
    chave: 'convite:' + msg.de.id,
    amigo,
    titulo: `${msg.de.nome} te chamou`,
    sub: msg.rotulo || '',
    validade: VALIDADE_CHAMADO,
    botoes: [
      { texto: 'Agora não', acao: () => {} },
      { texto: 'Entrar', principal: true, acao: () => entrarComCodigoDeAmigo(msg.codigo) }
    ]
  })
}

function avisoDeAmizade (de) {
  mostrarAviso({
    chave: 'amizade:' + de.id,
    amigo: { ...de, online: true },
    titulo: `${de.nome} quer te adicionar`,
    sub: de.tag,
    validade: 20000,
    botoes: [
      { texto: 'Recusar', acao: () => enviarAmigos({ tipo: 'responder-amizade', id: de.id, aceitar: false }) },
      { texto: 'Aceitar', principal: true, acao: () => enviarAmigos({ tipo: 'responder-amizade', id: de.id, aceitar: true }) }
    ]
  })
}

// --- avisos ------------------------------------------------------------------------

const avisos = new Map()

// Um aviso por chave, embaixo no meio. Com validade, mostra quanto falta e
// some sozinho; ignorar um pedido de amizade nao o recusa (ele continua na
// lista).
function mostrarAviso ({ chave, amigo, titulo, sub = '', validade = 0, botoes = [] }) {
  tirarAviso(chave)
  const aviso = document.createElement('div')
  aviso.className = 'aviso-amigo'
  aviso.appendChild(avatarDeAmigo(amigo, false))
  const textos = document.createElement('div')
  textos.className = 'textos'
  const linha1 = document.createElement('div')
  linha1.className = 'titulo-aviso'
  linha1.textContent = titulo
  const linha2 = document.createElement('div')
  linha2.className = 'sub'
  textos.append(linha1, linha2)
  aviso.appendChild(textos)
  for (const b of botoes) {
    aviso.appendChild(botaoPequeno(b.texto, () => { tirarAviso(chave); b.acao() }, b.principal ? 'principal' : ''))
  }

  const ate = validade ? Date.now() + validade : 0
  const atualizar = () => {
    if (!ate) { linha2.textContent = sub; return }
    const restam = Math.ceil((ate - Date.now()) / 1000)
    if (restam <= 0) return tirarAviso(chave)
    linha2.textContent = sub ? `${sub} · ${restam} s` : `Expira em ${restam} s`
  }
  atualizar()
  const relogio = ate ? setInterval(atualizar, 1000) : null
  avisos.set(chave, { aviso, relogio })
  $('#avisos-amigos').appendChild(aviso)
}

function tirarAviso (chave) {
  const atual = avisos.get(chave)
  if (!atual) return
  clearInterval(atual.relogio)
  atual.aviso.remove()
  avisos.delete(chave)
}

// Aviso que so informa, sem botao: some em 4 s.
function avisoRapido (amigo, texto) {
  const chave = 'rapido:' + amigo.id
  mostrarAviso({ chave, amigo, titulo: texto })
  setTimeout(() => tirarAviso(chave), 4000)
}

// Aviso do Windows, so com a janela sem foco (main.js confere).
function notificar (titulo, texto) {
  try { window.ponte.notificar(titulo, texto || '') } catch { /* sem ponte */ }
}

// --- ligacoes ------------------------------------------------------------------------

$('#btn-amigos').onclick = (evento) => {
  evento.stopPropagation()
  if (listaDeAmigosAberta()) fecharListaDeAmigos()
  else abrirListaDeAmigos()
}
$('#btn-adicionar-amigo').onclick = () => {
  if ($('#adicionar-amigo').classList.contains('oculto')) mostrarAdicionar()
  else $('#adicionar-amigo').classList.add('oculto')
}
$('#btn-mandar-pedido').onclick = mandarPedidoDeAmizade
$('#campo-amigo').addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter') mandarPedidoDeAmizade()
})
$('#campo-amigo').addEventListener('input', () => mostrarNotaDosAmigos(''))
$('#btn-copiar-amigo').onclick = () => copiarMeuCodigo($('#btn-copiar-amigo'))
$('#btn-copiar-amigo-perfil').onclick = () => copiarMeuCodigo($('#btn-copiar-amigo-perfil'))
for (const botao of document.querySelectorAll('#opcao-invisivel button')) botao.onclick = () => definirInvisivel(botao.dataset.valor)
$('#campo-nome').addEventListener('input', agendarNomeDosAmigos)
$('#campo-nome').addEventListener('blur', mandarNomeAosAmigos)

// Clique fora fecha a lista, como o pop-over de pessoas.
document.addEventListener('click', (evento) => {
  if (listaDeAmigosAberta() && !evento.target.closest('#amigos-entrada')) fecharListaDeAmigos()
})

// Comeca ja na abertura, se a pessoa ja tem nome (sem nome, o Continuar da
// primeira vez chama o mandarNomeAosAmigos, que conecta).
desenharAmigos()
setTimeout(conectarAmigos, 0)
