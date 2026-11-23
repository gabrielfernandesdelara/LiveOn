// Tela de entrada (2.0.0, "você em destaque", escolhida pelo dono entre
// muitos esboços): sem cartão, a foto grande no meio, a saudação pela hora,
// o nome e uma linha só, com o campo e o botão.
//
// - Primeira vez que o app abre: só o nome e Continuar. Depois o nome fica
//   salvo e a tela abre com o cursor no código: colar e Enter.
// - O nome não é mais campo aqui: mora na aba Perfil. Clicar na foto abre o
//   Perfil, para trocar a foto ou o nome.
// - Entrar e Criar trocam pelo link de baixo ("ou criar uma sala"). Criar
//   pede só o nome da sala, opcional: o código é sorteado no clique e
//   aparece na barra da sala, com o Copiar (escolha A do dono).
// - Colar (botão ou Ctrl+V) acha o código no meio da mensagem inteira. Ao
//   abrir e ao voltar para o app com um código copiado, aparece "Usar o
//   código copiado". O processo principal só devolve o CÓDIGO, nunca o resto
//   do que a pessoa copiou.
// - O erro aparece embaixo da linha; o campo culpado fica contornado, e erro
//   de nome contorna a foto.
// - Entrando, o anel e o ponto da foto ficam vermelhos de "no ar". Caiu da
//   sala de vez: âmbar, com o código daquela sala preenchido (só na memória,
//   nunca gravado: ele é a chave da sala).
// - O fundo: papel de parede do tema; sem papel, a foto desfocada; sem foto,
//   o fundo liso. Com qualquer fundo, o lado da coluna escurece num degradê
//   (estilo.css). A posição da coluna vem do tema (aplicarPosicaoDaEntrada).
// - O código aparece junto, sem hífen (pedido do dono). Colado com hífen ou
//   espaço, fica junto e em minúsculo.

'use strict'

const LETRAS_DO_CODIGO = new RegExp(`^[${ALFABETO}]*$`)
const CODIGO_NA_MENSAGEM = new RegExp(
  `(?:^|[^a-z0-9])([${ALFABETO}]{4})[- ]?([${ALFABETO}]{4})[- ]?([${ALFABETO}]{4})(?![a-z0-9])`, 'i')

// Sem hifens e espacos, so se for um codigo do jeito que o app sorteia.
// Qualquer outra coisa vai como a pessoa digitou: o servidor e quem decide.
function limparCodigo (texto) {
  const digitado = String(texto || '').trim()
  const junto = digitado.replace(/[-\s]/g, '').toLowerCase()
  return junto.length === TAMANHO_DO_CODIGO && LETRAS_DO_CODIGO.test(junto) ? junto : digitado
}

// Junto e em minusculo, enquanto parecer codigo (ate 12 letras do alfabeto).
// Qualquer outra coisa fica como esta.
function formatarCodigo (texto) {
  const junto = String(texto || '').replace(/[-\s]/g, '').toLowerCase()
  if (!junto || junto.length > TAMANHO_DO_CODIGO || !LETRAS_DO_CODIGO.test(junto)) return String(texto || '')
  return junto
}

function codigoNaMensagem (texto) {
  const achado = CODIGO_NA_MENSAGEM.exec(String(texto || ''))
  return achado ? (achado[1] + achado[2] + achado[3]).toLowerCase() : ''
}

function entradaAberta () {
  return !$('#entrada').classList.contains('oculto') && $('#primeira-vez').classList.contains('oculto')
}

function meuNomeSalvo () {
  return (lembrar('liveon:nome') || '').trim().slice(0, 32)
}

// --- quem sou eu: foto, saudacao e nome ---------------------------------------

function saudacaoDaHora (agora = new Date()) {
  const hora = agora.getHours()
  if (hora >= 5 && hora < 12) return 'Bom dia,'
  if (hora >= 12 && hora < 18) return 'Boa tarde,'
  return 'Boa noite,'
}

function atualizarAvatarEntrada () {
  const lugar = $('#avatar-entrada')
  if (!lugar) return
  lugar.textContent = ''
  lugar.appendChild(criarAvatar(meuNomeSalvo() || '?', false, EU))
  $('#nome-entrada').textContent = meuNomeSalvo()
  $('#nome-entrada').title = meuNomeSalvo()
  const primeira = $('#entrada').classList.contains('primeira')
  // A saudacao pela hora saiu (pedido do dono): o lugar dela fica so para o
  // convite da primeira vez.
  $('#saudacao').textContent = primeira ? 'Pôr uma foto (opcional)' : ''
  $('#entrada').classList.toggle('tem-foto', typeof minhaFoto === 'function' && Boolean(minhaFoto()))
  atualizarFundoDaEntrada()
}

// Papel de parede do tema primeiro; sem ele, a foto desfocada; sem foto, liso.
function atualizarFundoDaEntrada () {
  const entrada = $('#entrada')
  const imagem = $('#fundo-foto')
  if (!entrada || !imagem) return
  const temPapel = document.documentElement.classList.contains('com-papel')
  const foto = typeof minhaFoto === 'function' ? minhaFoto() : ''
  const usarFoto = !temPapel && Boolean(foto)
  if (usarFoto) {
    if (imagem.getAttribute('src') !== foto) imagem.src = foto
  } else {
    imagem.removeAttribute('src')
  }
  imagem.classList.toggle('oculto', !usarFoto)
  entrada.classList.toggle('com-fundo', temPapel || usarFoto)
}

// --- modo: entrar ou criar ------------------------------------------------------

function definirModo (novo) {
  modo = novo === 'criar' ? 'criar' : 'entrar'
  const criando = modo === 'criar'
  $('#bloco-sala').classList.toggle('oculto', !criando)
  $('#bloco-codigo').classList.toggle('oculto', criando)
  $('#btn-entrar').textContent = criando ? 'Criar sala' : 'Entrar'
  const trocar = $('#btn-trocar-modo')
  trocar.textContent = 'ou'
  const alvo = document.createElement('b')
  alvo.textContent = criando ? 'entrar numa sala' : 'criar uma sala'
  trocar.appendChild(alvo)
  esconderSugestao()
  limparErroEntrada()
  sairDoEstadoDeQueda()
  atualizarBotaoEntrar()
}

// O botão principal fica apagado enquanto falta algo, mas continua clicável:
// o clique diz o que falta, e o Enter dos campos continua respondendo.
// Os 10 caracteres são o piso que o servidor confere no código.
function atualizarBotaoEntrar () {
  const pronto = modo === 'criar' || limparCodigo($('#campo-codigo').value).length >= 10
  $('#btn-entrar').classList.toggle('incompleto', !pronto)
}

// --- erros embaixo da linha ---------------------------------------------------

// campo: 'codigo' ou 'sala' (contorna o campo), 'nome' (contorna a foto) ou
// 'geral' (so o texto).
function mostrarErroEntrada (texto, campo = 'geral') {
  const erro = $('#erro-entrada')
  erro.textContent = texto
  erro.classList.remove('oculto')
  $('#bloco-codigo').classList.toggle('com-erro', campo === 'codigo')
  $('#bloco-sala').classList.toggle('com-erro', campo === 'sala')
  $('#btn-foto-entrada').classList.toggle('com-erro', campo === 'nome')
}

function limparErroEntrada () {
  $('#erro-entrada').classList.add('oculto')
  for (const id of ['#bloco-codigo', '#bloco-sala', '#btn-foto-entrada']) $(id).classList.remove('com-erro')
}

// A recusa do servidor. O texto vem em minusculo e sem ponto (worker.js e
// signaling/server.js). Erro de nome ensina onde trocar: o nome nao e mais
// campo na entrada.
function mostrarRecusa (motivo) {
  const texto = String(motivo || 'O servidor recusou.')
  let campo = 'geral'
  if (/alguém chamado|seu nome/.test(texto)) campo = 'nome'
  else if (/código/.test(texto)) campo = 'codigo'
  else if (/nome da sala/.test(texto)) campo = 'sala'
  let frase = texto.charAt(0).toUpperCase() + texto.slice(1)
  if (!/[.!?]$/.test(frase)) frase += '.'
  if (campo === 'nome') frase += ' Clique na sua foto para trocar o nome.'
  mostrarErroEntrada(frase, campo)
}

// --- estado na foto: entrando e caiu ----------------------------------------------

function mostrarEstadoEntrada (texto) {
  const estado = $('#estado-entrada')
  estado.textContent = texto || ''
  estado.classList.toggle('oculto', !texto)
}

function sairDoEstadoDeQueda () {
  if (!$('#entrada').classList.contains('caiu')) return
  $('#entrada').classList.remove('caiu')
  mostrarEstadoEntrada('')
}

// --- colar e o codigo copiado ----------------------------------------------

function codigoDigitado () {
  const campo = $('#campo-codigo')
  esconderSugestao()
  limparErroEntrada()
  sairDoEstadoDeQueda()
  atualizarBotaoEntrar()
  // Junta e poe em minusculo enquanto digita, mas so com o cursor no fim:
  // mexer no meio puxaria o cursor para longe de onde a pessoa esta.
  if (campo.selectionStart === campo.value.length) campo.value = formatarCodigo(campo.value)
}

function preencherCodigo (codigo) {
  const campo = $('#campo-codigo')
  campo.value = formatarCodigo(codigo)
  codigoDigitado()
  campo.focus()
}

async function colarCodigo () {
  try {
    const texto = await window.ponte.colar()
    if (texto) preencherCodigo(texto)
  } catch {
    mostrarErroEntrada('Não consegui colar.', 'codigo')
  }
}

function esconderSugestao () {
  $('#sugestao-codigo').classList.add('oculto')
}

// Ao abrir e ao voltar para o app: so com a entrada na tela, em Entrar e com
// o campo vazio. A pessoa nao pediu nada, entao nada e preenchido sozinho.
async function procurarCodigoCopiado () {
  if (!entradaAberta() || modo !== 'entrar' || $('#campo-codigo').value.trim()) return
  let codigo = ''
  try { codigo = await window.ponte.codigoCopiado() } catch { return }
  if (!codigo || $('#campo-codigo').value.trim()) return
  const sugestao = $('#sugestao-codigo')
  sugestao.textContent = `Usar o código copiado (${codigo.slice(0, 4)}…)`
  sugestao.dataset.codigo = codigo
  sugestao.classList.remove('oculto')
}

// --- entrar ----------------------------------------------------------------

function entrarOuCriar () {
  const entrada = $('#entrada')
  if (entrada.classList.contains('entrando')) return
  limparErroEntrada()

  const nome = meuNomeSalvo()
  const criando = modo === 'criar'
  // Criando, o codigo e sorteado agora: e o que impede alguem de escolher
  // "132". Ele aparece na barra da sala, com o Copiar.
  const codigo = criando ? gerarCodigo() : limparCodigo($('#campo-codigo').value)

  if (!nome) return mostrarPrimeiraVez()
  // Colou um codigo de AMIGO (Nome#1234) no campo da sala: oferece adicionar.
  if (!criando && codigoDeAmigoNaEntrada($('#campo-codigo').value)) return
  if (!codigo) return mostrarErroEntrada('Cole o código da sala.', 'codigo')
  if (codigo.length < 10) return mostrarErroEntrada('Esse código está incompleto.', 'codigo')
  // Sem internet nenhuma, nem tenta: o servidor nao vai responder.
  if (!navigator.onLine) return mostrarErroEntrada('Sem conexão com a internet.')

  // Nome da sala opcional: vazio vira "Sala do <nome>" (cabe nos 40).
  const rotulo = criando ? ($('#campo-sala').value.trim() || 'Sala do ' + nome) : ''

  meuNome = nome
  esconderSugestao()
  entrada.classList.remove('caiu')
  entrada.classList.add('entrando')
  mostrarEstadoEntrada('Entrando na sala...')

  anotar(criando ? `criando sala "${rotulo}"` : 'entrando com um codigo')
  conectar({ nome, codigo, rotulo, criando })
}

// Chamado pelo voltarParaEntrada: a tela volta pronta para tentar de novo.
// O ponto da foto mostra a conexao, e so quando ha algo a dizer
// (estilo.css): sem internet, ambar, com "Sem internet" embaixo do nome. O
// entrando e o caiu tem prioridade, porque ja dizem mais.
function atualizarRedeNaEntrada () {
  const entrada = $('#entrada')
  if (!entrada) return
  const semRede = !navigator.onLine
  const ocupado = entrada.classList.contains('entrando') || entrada.classList.contains('caiu')
  const antes = entrada.classList.contains('sem-rede')
  entrada.classList.toggle('sem-rede', semRede && !ocupado)
  if (semRede && !ocupado) mostrarEstadoEntrada('Sem internet')
  else if (antes && !ocupado) mostrarEstadoEntrada('')
}
window.addEventListener('online', atualizarRedeNaEntrada)
window.addEventListener('offline', atualizarRedeNaEntrada)

function reabrirEntrada () {
  $('#entrada').classList.remove('entrando')
  mostrarEstadoEntrada('')
  atualizarAvatarEntrada()
  atualizarBotaoEntrar()
  atualizarRedeNaEntrada()
  if (modo === 'criar') $('#campo-sala').focus()
  else $('#campo-codigo').focus()
}

// Caiu da sala e nao deu para voltar: a entrada abre em Entrar, com o codigo
// daquela sala, e a foto fica ambar. Um Enter e a pessoa tenta de novo.
function prepararVolta (codigo, aviso) {
  definirModo('entrar')
  $('#campo-codigo').value = formatarCodigo(codigo)
  atualizarBotaoEntrar()
  if (aviso) {
    $('#entrada').classList.add('caiu')
    mostrarEstadoEntrada(aviso)
  }
  $('#btn-entrar').focus()
}

// --- primeira vez ------------------------------------------------------------

function mostrarPrimeiraVez () {
  $('#entrada').classList.add('primeira')
  $('#saudacao').textContent = 'Pôr uma foto (opcional)'
  $('#formulario-entrada').classList.add('oculto')
  $('#primeira-vez').classList.remove('oculto')
  $('#campo-primeiro-nome').focus()
}

function continuarPrimeiraVez () {
  const campo = $('#campo-primeiro-nome')
  const erro = $('#primeira-vez .erro-entrada')
  const nome = campo.value.trim().slice(0, 32)
  if (!nome) {
    erro.textContent = 'Escreva seu nome.'
    erro.classList.remove('oculto')
    return campo.focus()
  }
  guardar('liveon:nome', nome)
  $('#campo-nome').value = nome
  $('#entrada').classList.remove('primeira')
  $('#primeira-vez').classList.add('oculto')
  $('#formulario-entrada').classList.remove('oculto')
  definirModo('entrar')
  reabrirEntrada()
  procurarCodigoCopiado()
  // Com nome, ja pode ter codigo de amigo (amigos.js).
  desenharAmigos()
  mandarNomeAosAmigos()
}

// Chamado pela partida. Sem nome salvo e a primeira vez.
function iniciarEntrada () {
  const nome = meuNomeSalvo()
  $('#campo-nome').value = nome
  definirModo('entrar')
  atualizarAvatarEntrada()
  if (!nome) return mostrarPrimeiraVez()
  $('#entrada').classList.remove('primeira')
  $('#primeira-vez').classList.add('oculto')
  $('#formulario-entrada').classList.remove('oculto')
  atualizarAvatarEntrada()
  $('#campo-codigo').focus()
  procurarCodigoCopiado()
}

// --- o nome, na aba Perfil ---------------------------------------------------

// Grava a cada letra (vazio nao: o nome e obrigatorio), e a entrada mostra na
// hora. Dentro de uma sala, vale na proxima: o servidor ja conhece o nome.
function mudarNome () {
  const nome = $('#campo-nome').value.trim().slice(0, 32)
  $('#aviso-nome').textContent = nome ? '' : 'O nome não pode ficar vazio.'
  if (!nome) return
  guardar('liveon:nome', nome)
  atualizarAvatarEntrada()
  desenharPerfil()
}

// --- ligacoes ----------------------------------------------------------------

$('#btn-trocar-modo').onclick = () => {
  definirModo(modo === 'criar' ? 'entrar' : 'criar')
  reabrirEntrada()
}
$('#btn-colar-codigo').onclick = colarCodigo
$('#btn-entrar').onclick = entrarOuCriar
$('#btn-continuar').onclick = continuarPrimeiraVez
$('#btn-foto-entrada').onclick = () => abrirConfig('perfil')
$('#sugestao-codigo').onclick = () => preencherCodigo($('#sugestao-codigo').dataset.codigo)

$('#campo-primeiro-nome').addEventListener('keydown', (evento) => {
  if (evento.key === 'Enter') continuarPrimeiraVez()
})
$('#campo-primeiro-nome').addEventListener('input', () => $('#primeira-vez .erro-entrada').classList.add('oculto'))

for (const campo of ['#campo-sala', '#campo-codigo']) {
  $(campo).addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') entrarOuCriar()
  })
}
$('#campo-sala').addEventListener('input', limparErroEntrada)
$('#campo-codigo').addEventListener('input', codigoDigitado)
$('#campo-codigo').addEventListener('blur', () => {
  const campo = $('#campo-codigo')
  campo.value = formatarCodigo(campo.value)
})
$('#campo-nome').addEventListener('input', mudarNome)
// Saiu do campo vazio: volta o nome que estava valendo.
$('#campo-nome').addEventListener('blur', () => {
  if (!$('#campo-nome').value.trim()) {
    $('#campo-nome').value = meuNomeSalvo()
    $('#aviso-nome').textContent = ''
  }
})

// Ctrl+V da mensagem inteira ("entra ai: rr29vtxantxd"): fica so o codigo.
$('#campo-codigo').addEventListener('paste', (evento) => {
  const codigo = codigoNaMensagem(evento.clipboardData && evento.clipboardData.getData('text'))
  if (!codigo) return
  evento.preventDefault()
  preencherCodigo(codigo)
})

// Copiou o codigo no Discord e voltou para o app.
window.addEventListener('focus', () => { procurarCodigoCopiado() })
// A abertura e a volta da sala conferem a rede tambem.
setTimeout(atualizarRedeNaEntrada, 0)
