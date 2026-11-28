// Configurações: a janela grande, aberta pela engrenagem da entrada e pela da
// barra da sala, com uma aba por assunto (Perfil, Aparência, Telas, Áudio,
// Mini tela, Desempenho e Debug; ver o CLAUDE.md). O que é gosto de quem olha
// vale na hora e fica no localStorage, porque só a página usa.
//
// Sobre o Desempenho:
//
// As escolhas moram num arquivo do processo principal, e não no localStorage,
// porque o vídeo precisa ser lido ANTES da janela existir: desligar a
// aceleração por hardware só vale na abertura. Por isso mudar o vídeo pede
// reiniciar. A prioridade, não: ela muda na hora, nos processos que já estão
// rodando.

'use strict'

// O que esta execução está usando. Diferente do que está no campo quando a
// pessoa trocou e ainda não reiniciou.
let videoAtivo = 'gpu'

// Com placa AMD o aviso da prioridade ALTA fica mais direto: foi nessas
// máquinas que o PC travou.
let temAmd = false

// Tamanho da webcam sobreposta dos amigos (1.6.2): pequena, media ou grande.
// So muda uma classe na grade; os tamanhos estao no CSS.
let tamanhoDaCamera = ['pequena', 'grande'].includes(lembrar('liveon:camera-tamanho')) ? lembrar('liveon:camera-tamanho') : 'media'

function aplicarTamanhoDaCamera () {
  $('#grade').classList.toggle('cam-pequena', tamanhoDaCamera === 'pequena')
  $('#grade').classList.toggle('cam-grande', tamanhoDaCamera === 'grande')
}

function definirTamanhoDaCamera (valor) {
  tamanhoDaCamera = ['pequena', 'grande'].includes(valor) ? valor : 'media'
  guardar('liveon:camera-tamanho', tamanhoDaCamera)
  aplicarTamanhoDaCamera()
  marcarAparencia()
}

// A minha propria tela na grade quando eu transmito (1.6.2): mostrar ou
// esconder. Escondida, ela continua indo para os amigos e continua na lista
// de pessoas; so nao ocupa espaco na MINHA grade.
let minhaTela = lembrar('liveon:minha-tela') === 'esconder' ? 'esconder' : 'mostrar'

function minhaTelaEscondida () {
  return minhaTela === 'esconder'
}

function definirMinhaTela (valor) {
  minhaTela = valor === 'esconder' ? 'esconder' : 'mostrar'
  guardar('liveon:minha-tela', minhaTela)
  marcarAparencia()
  if (meuId) sincronizarGrade()
}

// Se a inicial do nome (o selo) aparece so com o mouse mexendo ou sempre.
let nomeNoCard = lembrar('liveon:nome-no-card') === 'sempre' ? 'sempre' : 'mouse'

function aplicarNomeNoCard () {
  $('#grade').classList.toggle('selo-sempre', nomeNoCard === 'sempre')
}

function definirNomeNoCard (valor) {
  nomeNoCard = valor === 'sempre' ? 'sempre' : 'mouse'
  guardar('liveon:nome-no-card', nomeNoCard)
  aplicarNomeNoCard()
  marcarAparencia()
}

// Banda de envio (aba Desempenho, 2.0.0): automatica ou um limite total. Vale
// na hora: o teto de cada amigo e refeito (reaplicarQualidade).
function definirBanda (valor) {
  const fixa = BANDAS_FIXAS.includes(Number(valor)) ? String(Number(valor)) : 'auto'
  guardar('liveon:banda', fixa)
  anotar(`banda de envio: ${fixa === 'auto' ? 'automatica' : fixa + ' Mbps'}`)
  if (typeof reaplicarQualidade === 'function') reaplicarQualidade()
  mostrarBanda()
}

// O campo e, com um limite escolhido, a nota lembrando que ele e so teto
// (texto do dono; antes ela fazia a conta da divisao entre os amigos).
function mostrarBanda () {
  const fixa = bandaFixa()
  $('#campo-banda').value = fixa ? String(fixa) : 'auto'
  $('#nota-banda').textContent = fixa ? 'A banda escolhida é o limite apenas.' : ''
}

// Servidor STUN (aba Desempenho, 2.1.1): um so, ou o automatico. Vale na
// hora: toda conexao passa a usar o novo (setConfiguration), e a que ainda
// NAO conectou (ou caiu) procura caminho de novo com ele (restartIce). A que
// ja esta conectada fica como esta: o STUN so serve para achar o caminho, e
// reiniciar a busca nela so arriscaria um soluco na imagem.
function definirStun (valor) {
  guardar('liveon:stun', SERVIDORES_STUN[valor] ? valor : 'auto')
  const ice = iceDaVez()
  for (const par of pares.values()) {
    try { par.pc.setConfiguration({ ...par.pc.getConfiguration(), iceServers: ice.iceServers }) } catch { continue }
    if (!['connected', 'closed'].includes(par.pc.connectionState)) {
      try { par.pc.restartIce() } catch { /* fica a busca de antes */ }
    }
  }
  anotar(`servidor STUN: ${stunEscolhido() === 'auto' ? 'automatico' : SERVIDORES_STUN[stunEscolhido()].nome}`)
  mostrarStun()
}

function mostrarStun () {
  const campo = $('#campo-stun')
  if (campo.options.length === 1) {
    for (const [valor, s] of Object.entries(SERVIDORES_STUN)) {
      const opcao = document.createElement('option')
      opcao.value = valor
      opcao.textContent = s.nome
      campo.appendChild(opcao)
    }
  }
  campo.value = stunEscolhido()
}

// A troca de tema esmaece de um para o outro (animacoes.js).
function escolherTema (tema) {
  trocarTemaSuave(() => {
    aplicarTema(tema)
    marcarAparencia()
  })
}

function escolherFormatoDaCamera (formato) {
  definirFormatoDaCamera(formato)
  marcarAparencia()
}

// Acende, em cada opção, o que está valendo agora.
function marcarAparencia () {
  const marcar = (botoes, ativo) => {
    for (const botao of botoes) botao.classList.toggle('ativo', botao.dataset.valor === ativo || botao.dataset.tema === ativo)
  }
  marcar(document.querySelectorAll('.tema'), temaAtual)
  marcar(document.querySelectorAll('#opcao-camera button'), formatoDaCamera)
  marcar(document.querySelectorAll('#opcao-selo button'), nomeNoCard)
  marcar(document.querySelectorAll('#opcao-assistir button'), modoAssistir)
  marcar(document.querySelectorAll('#opcao-tamanho-cam button'), tamanhoDaCamera)
  marcar(document.querySelectorAll('#opcao-minha-tela button'), minhaTela)
  marcar(document.querySelectorAll('#opcao-pausa button'), modoPausa)
  marcar(document.querySelectorAll('#opcao-som-novo button'), somDasNovas)
  if (typeof modoAnimacoes !== 'undefined') marcar(document.querySelectorAll('#opcao-animacoes button'), modoAnimacoes)
}

// A aba acesa na lateral e a seção que aparece. O editor de tema e uma seção
// sem aba propria: ele vive dentro da Aparencia.
function mostrarSecaoConfig (secao, aba) {
  for (const botao of document.querySelectorAll('.aba-config')) botao.classList.toggle('ativa', botao.dataset.aba === aba)
  for (const s of document.querySelectorAll('.secao-config')) s.classList.toggle('oculto', s.dataset.secao !== secao)
}

// Trocar de aba no meio de uma edicao e o mesmo que cancelar: o app volta ao
// tema de antes.
function mostrarAbaConfig (aba) {
  cancelarEdicaoDeTema()
  fecharRecorte()
  if (aba === 'aparencia') desenharTemasPessoais()
  if (aba === 'perfil') desenharPerfil()
  if (aba === 'audio') preencherSaidas()
  if (aba === 'mini') mostrarAtalhoDaMini()
  if (aba === 'debug') mostrarMonitoria()
  if (aba === 'desempenho') {
    lerInfoDaPlaca().then(mostrarCodificador)
    mostrarBanda()
    mostrarStun()
  }
  mostrarSecaoConfig(aba, aba)
}

// --- temas da pessoa ---------------------------------------------------------

// O lugar sendo editado ({ lugar, novo }), ou null com o editor fechado, e o
// tema como esta no editor: { cores, papel, escurecer }.
let edicaoTema = null
let temaEmEdicao = null

// Um pedaco do app desenhado com as cores de quem estiver em volta: e a
// classe amostra-* ou as variaveis postas por pintar() que decidem quais.
// Com papel de parede, ele aparece no fundo da miniatura.
function criarPreviaDeTema (papel, escurecer, fundo, posicao) {
  const previa = document.createElement('span')
  previa.className = 'previa-tema'
  if (papel) {
    const [r, g, b] = paraRgb(fundo)
    const veu = `rgba(${r}, ${g}, ${b}, ${escurecer})`
    previa.style.backgroundImage = `linear-gradient(${veu}, ${veu}), url("${papel}")`
    if (posicao) previa.style.backgroundPosition = `center, ${posicao.x}% ${posicao.y}%`
    previa.classList.add('com-papel')
  }
  const barra = document.createElement('span')
  barra.className = 'previa-barra'
  const cards = document.createElement('span')
  cards.className = 'previa-cards'
  cards.append(document.createElement('span'), document.createElement('span'))
  previa.append(barra, cards)
  return previa
}

function desenharTemasPessoais () {
  const caixa = $('#temas-pessoais')
  caixa.textContent = ''

  temasPessoais().forEach((tema, i) => {
    const nome = document.createElement('span')
    nome.className = 'nome-tema'

    if (!tema) {
      const vazio = document.createElement('button')
      vazio.className = 'tema tema-vazio'
      const area = document.createElement('span')
      area.className = 'previa-vazia'
      area.appendChild(icone('mais', 18, 2))
      nome.textContent = 'Criar tema'
      vazio.append(area, nome)
      vazio.onclick = () => abrirEditorDeTema(i, true)
      caixa.appendChild(vazio)
      return
    }

    const lugar = document.createElement('div')
    lugar.className = 'lugar-tema'

    const botao = document.createElement('button')
    botao.className = 'tema'
    botao.dataset.tema = 'pessoal-' + i
    pintar(botao, tema.cores)
    nome.textContent = tema.nome
    const papel = tema.papel ? papelDoLugar(i) : ''
    botao.append(criarPreviaDeTema(papel, tema.escurecer, tema.cores.fundo, tema.posicao), nome)
    botao.onclick = () => escolherTema('pessoal-' + i)

    const acoes = document.createElement('div')
    acoes.className = 'acoes-tema'

    const editar = document.createElement('button')
    editar.className = 'botao-mini'
    editar.title = 'Editar'
    editar.appendChild(icone('lapis', 13, 2))
    editar.onclick = () => abrirEditorDeTema(i, false)

    const apagar = document.createElement('button')
    apagar.className = 'botao-mini apagar'
    apagar.title = 'Apagar'
    apagar.appendChild(icone('lixeira', 13, 2))
    apagar.onclick = () => apagarTemaPessoal(i, apagar)

    acoes.append(editar, apagar)
    lugar.append(botao, acoes)
    caixa.appendChild(lugar)
  })

  marcarAparencia()
}

// Apagar pede um segundo clique: nao tem como desfazer, e o botao e pequeno.
function apagarTemaPessoal (i, botao) {
  if (!botao.classList.contains('confirmar')) {
    botao.classList.add('confirmar')
    botao.title = 'Clique de novo para apagar'
    setTimeout(() => {
      botao.classList.remove('confirmar')
      botao.title = 'Apagar'
    }, 3000)
    return
  }
  const lista = temasPessoais()
  lista[i] = null
  guardarTemasPessoais(lista)
  guardar('liveon:papel-' + i, '')
  guardar('liveon:papel-sala-' + i, '')
  // O tema em uso sumiu: volta para o padrao.
  if (temaAtual === 'pessoal-' + i) aplicarTema('grafite')
  desenharTemasPessoais()
}

function abrirEditorDeTema (lugar, novo) {
  edicaoTema = { lugar, novo }
  $('#titulo-editor').textContent = novo ? 'Novo tema' : 'Editar tema'
  $('#aviso-papel').textContent = ''

  // Tema novo comeca de algum, o que esta em uso por padrao. Editando, o
  // ponto de partida e o proprio tema.
  $('#bloco-base-tema').classList.toggle('oculto', !novo)
  if (novo) {
    const base = $('#campo-base-tema')
    base.textContent = ''
    const opcoes = TEMAS.map((t) => [t, NOMES_PRONTOS[t]])
    temasPessoais().forEach((t, i) => { if (t) opcoes.push(['pessoal-' + i, t.nome]) })
    for (const [valor, rotulo] of opcoes) {
      const opcao = document.createElement('option')
      opcao.value = valor
      opcao.textContent = rotulo
      base.appendChild(opcao)
    }
    base.value = temaAtual
    $('#campo-nome-tema').value = ''
  } else {
    $('#campo-nome-tema').value = temasPessoais()[lugar].nome
  }
  temaEmEdicao = temaCompleto(novo ? temaAtual : 'pessoal-' + lugar)

  desenharPapeisProntos()
  mostrarTemaNoEditor()
  mostrarSecaoConfig('editor', 'aparencia')
  $('#campo-nome-tema').focus()
}

// Os campos, o codigo de cada cor, os dois fundos, o app inteiro e o aviso,
// tudo a partir de temaEmEdicao.
function mostrarTemaNoEditor () {
  const { cores } = temaEmEdicao
  // O icone segue o destaque ate a pessoa escolher outra cor para ele.
  const visivel = { ...cores, marca: cores.marca || cores.destaque, marcaPonto: cores.marcaPonto || PONTO_PADRAO }
  for (const campo of document.querySelectorAll('.editor-tema-cor')) {
    const cor = visivel[campo.dataset.cor]
    campo.value = cor
    campo.parentNode.querySelector('.hex-cor').textContent = cor.toUpperCase()
  }

  mostrarFundoNoEditor('entrada')
  mostrarFundoDaSalaNoEditor()
  parteDoFundo('entrada', 'cores-da-imagem').disabled = !temaEmEdicao.papel
  mostrarEntradaNoEditor()
  mostrarAmigosNoEditor()

  previaDeTema(temaEmEdicao)
  $('#aviso-contraste').textContent = avisoDeContraste(cores)
}

// --- os dois fundos no editor: o papel de parede e o fundo da sala ----------
//
// Os dois blocos saem do mesmo molde no index.html (.editor-fundo com
// data-alvo), e cada peca e achada pelo data-parte. O que eles editam tem os
// mesmos campos (papel, escurecer, posicao, efeitos): o papel de parede mora
// no proprio temaEmEdicao, e o fundo da sala em temaEmEdicao.sala.

function fundoEmEdicao (alvo) {
  return alvo === 'sala' ? temaEmEdicao.sala : temaEmEdicao
}

function parteDoFundo (alvo, parte) {
  return document.querySelector(`.editor-fundo[data-alvo="${alvo}"] [data-parte="${parte}"]`)
}

function avisarNoFundo (alvo, texto) {
  parteDoFundo(alvo, 'aviso').textContent = texto
}

// Como cada efeito aparece ao lado da barra.
const VALOR_DO_EFEITO = {
  desfoque: (v) => v ? String(Math.round(v)) : 'Nenhum',
  brilho: (v) => Math.round(v) + '%',
  cores: (v) => v === 0 ? 'Preto e branco' : Math.round(v) + '%',
  contraste: (v) => Math.round(v) + '%',
  vinheta: (v) => v ? Math.round(v) + '%' : 'Nenhuma'
}

function mostrarFundoNoEditor (alvo) {
  const fundo = fundoEmEdicao(alvo)
  const { papel } = fundo
  const previa = parteDoFundo(alvo, 'previa')
  variaveisDoPapel(previa, papel, fundo.escurecer, temaEmEdicao.cores.fundo, fundo.posicao, fundo.efeitos)
  previa.classList.toggle('vazio', !papel)
  parteDoFundo(alvo, 'remover').classList.toggle('oculto', !papel)
  parteDoFundo(alvo, 'escolher').textContent = papel ? 'Trocar imagem' : 'Escolher imagem'
  for (const botao of document.querySelectorAll(`.editor-fundo[data-alvo="${alvo}"] .papel-pronto`)) {
    botao.classList.toggle('ativo', botao.dataset.papel === papel)
  }
  mostrarEfeitosNoEditor(alvo)
}

function mostrarEfeitosNoEditor (alvo = 'entrada') {
  const fundo = fundoEmEdicao(alvo)
  const efeitos = efeitosValidos(fundo.efeitos)
  fundo.efeitos = efeitos
  const semPapel = !fundo.papel
  for (const barra of document.querySelectorAll(`.editor-fundo[data-alvo="${alvo}"] .barra-efeito`)) {
    const nome = barra.dataset.efeito
    barra.value = String(efeitos[nome])
    barra.disabled = semPapel
    barra.closest('.efeito').querySelector('.valor-efeito').textContent = VALOR_DO_EFEITO[nome](efeitos[nome])
  }
  // O Zoom e o Escurecer moram na lista dos efeitos desde que o dono pediu
  // tudo junto, mas continuam guardados onde sempre estiveram (posicao.zoom
  // e escurecer).
  const { zoom } = fundo.posicao
  const escurecer = fundo.escurecer
  parteDoFundo(alvo, 'zoom').value = String(zoom)
  parteDoFundo(alvo, 'zoom').disabled = semPapel
  parteDoFundo(alvo, 'escurecer').value = String(escurecer)
  parteDoFundo(alvo, 'escurecer').disabled = semPapel
  parteDoFundo(alvo, 'valor-zoom').textContent = zoom <= 1 ? 'Nenhum' : zoom.toFixed(1).replace('.', ',') + 'x'
  parteDoFundo(alvo, 'valor-escurecer').textContent = escurecer ? Math.round(escurecer * 100) + '%' : 'Nenhum'
  const mexido = Object.keys(EFEITOS_PADRAO).some((nome) => efeitos[nome] !== EFEITOS_PADRAO[nome]) ||
    zoom !== 1 || escurecer !== ESCURECER_PADRAO
  parteDoFundo(alvo, 'sem-efeitos').disabled = semPapel || !mexido
}

// O fundo da sala: os segmentos, a cor, e o bloco da imagem so no modo
// Imagem. O app mostra a escolha na hora se a pessoa estiver numa sala.
function mostrarFundoDaSalaNoEditor () {
  const sala = temaEmEdicao.sala
  for (const botao of document.querySelectorAll('#opcao-fundo-sala button')) {
    botao.classList.toggle('ativo', botao.dataset.valor === sala.modo)
  }
  parteDoFundo('sala', 'bloco-cor').classList.toggle('oculto', sala.modo !== 'cor')
  parteDoFundo('sala', 'bloco-imagem').classList.toggle('oculto', sala.modo !== 'imagem')
  const cor = parteDoFundo('sala', 'cor')
  cor.value = sala.cor
  cor.parentNode.querySelector('.hex-cor').textContent = sala.cor.toUpperCase()
  mostrarFundoNoEditor('sala')
}

function definirModoDoFundoDaSala (modo) {
  if (!temaEmEdicao) return
  temaEmEdicao.sala = { ...temaEmEdicao.sala, modo: MODOS_DO_FUNDO_DA_SALA.includes(modo) ? modo : 'igual' }
  mostrarTemaNoEditor()
}

function mudarCorDoFundoDaSala (valor) {
  if (!temaEmEdicao || !corValida(valor)) return
  temaEmEdicao.sala.cor = valor.toLowerCase()
  mostrarTemaNoEditor()
}

function mudarEfeito (nome, valor, alvo = 'entrada') {
  const fundo = temaEmEdicao && fundoEmEdicao(alvo)
  if (!fundo || !fundo.papel) return
  fundo.efeitos = efeitosValidos({ ...fundo.efeitos, [nome]: valor })
  mostrarTemaNoEditor()
}

// Volta tudo da lista: os efeitos, o zoom e o escurecer. A parte da imagem
// escolhida arrastando (x e y) fica.
function tirarEfeitos (alvo = 'entrada') {
  if (!temaEmEdicao) return
  const fundo = fundoEmEdicao(alvo)
  fundo.efeitos = { ...EFEITOS_PADRAO }
  fundo.escurecer = ESCURECER_PADRAO
  fundo.posicao = { ...fundo.posicao, zoom: 1 }
  mostrarTemaNoEditor()
}

// --- papeis prontos, cores da imagem e posicao da entrada (2.0.0) -----------

function desenharPapeisProntos () {
  for (const alvo of ['entrada', 'sala']) {
    const caixa = parteDoFundo(alvo, 'prontos')
    if (caixa.childElementCount) continue
    for (const p of PAPEIS_PRONTOS) {
      const botao = document.createElement('button')
      botao.className = 'papel-pronto'
      botao.dataset.papel = caminhoDoPapelPronto(p.id)
      botao.title = p.nome
      botao.style.backgroundImage = `url("${caminhoDoPapelPronto(p.id)}")`
      const nome = document.createElement('span')
      nome.className = 'nome-papel'
      nome.textContent = p.nome
      botao.appendChild(nome)
      botao.onclick = () => escolherPapelPronto(p.id, alvo)
      caixa.appendChild(botao)
    }
  }
}

function escolherPapelPronto (id, alvo = 'entrada') {
  if (!temaEmEdicao) return
  avisarNoFundo(alvo, '')
  const fundo = fundoEmEdicao(alvo)
  fundo.papel = caminhoDoPapelPronto(id)
  fundo.posicao = { ...POSICAO_PADRAO }
  anotar(`papel pronto escolhido (${alvo}): ${id}`)
  mostrarTemaNoEditor()
}

// Sugere o destaque a partir do papel de parede. O icone segue o destaque, a
// nao ser que a pessoa ja tenha escolhido outra cor para ele.
async function tirarCoresDoPapel () {
  if (!temaEmEdicao || !temaEmEdicao.papel) return
  const cor = await corDoPapel(temaEmEdicao.papel)
  if (!temaEmEdicao) return
  if (!cor) return avisarNoFundo('entrada', 'Essa imagem não tem uma cor forte o bastante para virar destaque.')
  avisarNoFundo('entrada', '')
  temaEmEdicao.cores.destaque = cor
  anotar(`cor tirada do papel de parede: ${cor}`)
  mostrarTemaNoEditor()
}

// A previa da entrada no editor: o papel, o degrade e o marcador no lugar.
function mostrarEntradaNoEditor () {
  const { papel, escurecer, cores } = temaEmEdicao
  const entrada = entradaValida(temaEmEdicao.entrada)
  temaEmEdicao.entrada = entrada
  for (const botao of document.querySelectorAll('#opcao-entrada button')) {
    botao.classList.toggle('ativo', botao.dataset.valor === entrada.posicao)
  }
  const previa = $('#previa-entrada')
  variaveisDoPapel(previa, papel, escurecer, cores.fundo, temaEmEdicao.posicao, temaEmEdicao.efeitos)
  previa.classList.toggle('sem-papel', !papel)
  previa.dataset.posicao = entrada.posicao
  previa.style.setProperty('--x', entrada.x + '%')
  previa.style.setProperty('--y', entrada.y + '%')
  $('#nota-entrada').textContent = entrada.posicao === 'livre' ? 'Arraste a prévia para escolher o lugar.' : ''
}

// O lado do trilho dos amigos, com a previa da entrada mostrando onde ele cai.
function mostrarAmigosNoEditor () {
  if (!temaEmEdicao) return
  const amigos = amigosValidos(temaEmEdicao.amigos)
  temaEmEdicao.amigos = amigos
  for (const botao of document.querySelectorAll('#opcao-amigos button')) {
    botao.classList.toggle('ativo', botao.dataset.valor === amigos.lado)
  }
  $('#previa-entrada').dataset.amigos = ladoDosAmigos(amigos, temaEmEdicao.entrada)
}

function definirLadoDosAmigos (lado) {
  if (!temaEmEdicao) return
  temaEmEdicao.amigos = amigosValidos({ lado })
  mostrarTemaNoEditor()
}

function definirPosicaoDaEntrada (posicao) {
  if (!temaEmEdicao) return
  temaEmEdicao.entrada = { ...entradaValida(temaEmEdicao.entrada), posicao }
  mostrarTemaNoEditor()
}

// Livre: arrastar (ou clicar) na previa poe o meio da coluna ali.
function ligarPreviaDaEntrada () {
  const previa = $('#previa-entrada')
  let arrastando = false
  const mover = (evento) => {
    if (!temaEmEdicao) return
    const r = previa.getBoundingClientRect()
    const x = Math.round(Math.min(100, Math.max(0, ((evento.clientX - r.left) / r.width) * 100)))
    const y = Math.round(Math.min(100, Math.max(0, ((evento.clientY - r.top) / r.height) * 100)))
    temaEmEdicao.entrada = { posicao: 'livre', x, y }
    mostrarTemaNoEditor()
  }
  previa.addEventListener('pointerdown', (evento) => {
    if (!temaEmEdicao || entradaValida(temaEmEdicao.entrada).posicao !== 'livre') return
    arrastando = true
    previa.setPointerCapture(evento.pointerId)
    mover(evento)
  })
  previa.addEventListener('pointermove', (evento) => { if (arrastando) mover(evento) })
  const soltar = () => { arrastando = false }
  previa.addEventListener('pointerup', soltar)
  previa.addEventListener('pointercancel', soltar)
}

function mudarCorDoEditor (campo) {
  if (!temaEmEdicao || !corValida(campo.value)) return
  temaEmEdicao.cores[campo.dataset.cor] = campo.value.toLowerCase()
  mostrarTemaNoEditor()
}

function mudarBaseDoTema () {
  temaEmEdicao = temaCompleto($('#campo-base-tema').value)
  mostrarTemaNoEditor()
}

// Arrastar na previa move a imagem junto com o mouse: o ponto escolhido
// anda no sentido contrario do arraste. Com zoom, o mesmo arraste anda menos
// na imagem, por isso a divisao.
function moverPapel (dx, dy, alvo = 'entrada') {
  const fundo = temaEmEdicao && fundoEmEdicao(alvo)
  if (!fundo || !fundo.papel) return
  const previa = parteDoFundo(alvo, 'previa')
  const p = fundo.posicao
  p.x = Math.min(100, Math.max(0, p.x - (dx / previa.clientWidth) * 100 / p.zoom))
  p.y = Math.min(100, Math.max(0, p.y - (dy / previa.clientHeight) * 100 / p.zoom))
  mostrarTemaNoEditor()
}

function mudarZoomDoPapel (valor, alvo = 'entrada') {
  const fundo = temaEmEdicao && fundoEmEdicao(alvo)
  if (!fundo || !fundo.papel) return
  fundo.posicao.zoom = Math.min(ZOOM_PAPEL_MAXIMO, Math.max(1, valor))
  mostrarTemaNoEditor()
}

function ligarPreviaDoPapel (alvo = 'entrada') {
  const previa = parteDoFundo(alvo, 'previa')
  let ultimo = null
  const temPapel = () => temaEmEdicao && fundoEmEdicao(alvo).papel
  previa.addEventListener('pointerdown', (evento) => {
    if (!temPapel()) return
    previa.setPointerCapture(evento.pointerId)
    ultimo = { x: evento.clientX, y: evento.clientY }
  })
  previa.addEventListener('pointermove', (evento) => {
    if (!ultimo) return
    moverPapel(evento.clientX - ultimo.x, evento.clientY - ultimo.y, alvo)
    ultimo = { x: evento.clientX, y: evento.clientY }
  })
  const soltar = () => { ultimo = null }
  previa.addEventListener('pointerup', soltar)
  previa.addEventListener('pointercancel', soltar)
  previa.addEventListener('wheel', (evento) => {
    if (!temPapel()) return
    evento.preventDefault()
    mudarZoomDoPapel(fundoEmEdicao(alvo).posicao.zoom * (evento.deltaY < 0 ? 1.06 : 1 / 1.06), alvo)
  }, { passive: false })
}

function mudarEscurecer (alvo = 'entrada') {
  if (!temaEmEdicao) return
  fundoEmEdicao(alvo).escurecer = Number(parteDoFundo(alvo, 'escurecer').value)
  mostrarTemaNoEditor()
}

// Qualquer imagem vira papel de parede: reduzida ate PAPEL_LADO no maior
// lado e comprimida em WebP ate caber em PAPEL_MAXIMO. Se nem na qualidade
// mais baixa couber, diminui a imagem e tenta de novo.
async function escolherPapel (arquivo, alvo = 'entrada') {
  avisarNoFundo(alvo, '')
  if (!arquivo || !temaEmEdicao) return
  if (!arquivo.type.startsWith('image/')) return avisarNoFundo(alvo, 'Esse arquivo não é uma imagem.')
  if (arquivo.size > ARQUIVO_MAXIMO) return avisarNoFundo(alvo, 'Imagem grande demais. O limite é 20 MB.')

  let bitmap
  try {
    bitmap = await createImageBitmap(arquivo)
  } catch {
    return avisarNoFundo(alvo, 'Não consegui abrir essa imagem.')
  }

  let lado = PAPEL_LADO
  let blob = null
  while (!blob && lado >= 480) {
    const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height))
    const tela = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * escala)), Math.max(1, Math.round(bitmap.height * escala)))
    const ctx = tela.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, tela.width, tela.height)
    for (const qualidade of [0.82, 0.7, 0.6, 0.5, 0.4]) {
      const tentativa = await tela.convertToBlob({ type: 'image/webp', quality: qualidade })
      if (tentativa.size <= PAPEL_MAXIMO) { blob = tentativa; break }
    }
    lado = Math.round(lado * 0.75)
  }
  bitmap.close()
  if (!blob) return avisarNoFundo(alvo, 'Não consegui deixar a imagem leve o bastante.')

  if (!temaEmEdicao) return
  const fundo = fundoEmEdicao(alvo)
  fundo.papel = await paraDataUrl(blob)
  // Imagem nova comeca no meio, sem zoom.
  fundo.posicao = { ...POSICAO_PADRAO }
  anotar(`imagem de fundo escolhida (${alvo}): ${Math.round(blob.size / 1024)} KB`)
  mostrarTemaNoEditor()
}

function removerPapel (alvo = 'entrada') {
  if (!temaEmEdicao) return
  fundoEmEdicao(alvo).papel = ''
  mostrarTemaNoEditor()
}

// Guarda uma imagem e confere: guardar() engole erro, e sem espaco no
// armazenamento o tema seria salvo sem ela, calado.
function guardarImagemDoFundo (chave, papel, alvo) {
  guardar(chave, papel)
  if (papel && lembrar(chave) !== papel) {
    avisarNoFundo(alvo, 'Sem espaço para guardar essa imagem. Tente uma menor ou apague um tema.')
    return false
  }
  return true
}

function salvarTema () {
  if (!edicaoTema) return
  const { lugar } = edicaoTema
  const { cores, papel, escurecer, sala } = temaEmEdicao

  // As imagens vao primeiro. A da sala so e guardada no modo Imagem: nos
  // outros ela nao aparece, e nao precisa ocupar espaco.
  const papelDaSalaGuardado = sala.modo === 'imagem' ? sala.papel : ''
  // O que havia antes, para devolver se algo nao couber: o papel novo
  // gravado e o resto falhando deixava o tema antigo com a imagem nova.
  const antes = {
    papel: lembrar('liveon:papel-' + lugar),
    sala: lembrar('liveon:papel-sala-' + lugar),
    temas: lembrar('liveon:temas-pessoais')
  }
  const devolver = () => {
    guardar('liveon:papel-' + lugar, antes.papel)
    guardar('liveon:papel-sala-' + lugar, antes.sala)
    guardar('liveon:temas-pessoais', antes.temas)
  }
  if (!guardarImagemDoFundo('liveon:papel-' + lugar, papel, 'entrada')) return devolver()
  if (!guardarImagemDoFundo('liveon:papel-sala-' + lugar, papelDaSalaGuardado, 'sala')) return devolver()

  const lista = temasPessoais()
  lista[lugar] = {
    nome: $('#campo-nome-tema').value.trim().slice(0, 24) || 'Meu tema ' + (lugar + 1),
    cores: { ...cores },
    papel: Boolean(papel),
    escurecer,
    posicao: { ...temaEmEdicao.posicao },
    entrada: entradaValida(temaEmEdicao.entrada),
    amigos: amigosValidos(temaEmEdicao.amigos),
    efeitos: efeitosValidos(temaEmEdicao.efeitos),
    sala: {
      modo: sala.modo,
      cor: sala.cor,
      papel: Boolean(papelDaSalaGuardado),
      escurecer: sala.escurecer,
      posicao: { ...sala.posicao },
      efeitos: efeitosValidos(sala.efeitos)
    }
  }
  guardarTemasPessoais(lista)
  // guardar() engole erro: confere, senao o editor fecharia como se tivesse
  // salvo.
  if (lembrar('liveon:temas-pessoais') !== JSON.stringify(lista)) {
    devolver()
    return avisarNoFundo('entrada', 'Sem espaço para guardar o tema. Apague um tema ou use imagens menores.')
  }
  edicaoTema = null
  temaEmEdicao = null
  aplicarTema('pessoal-' + lugar)
  mostrarAbaConfig('aparencia')
}

// Desfaz a previa: o app volta ao tema que estava guardado.
function cancelarEdicaoDeTema () {
  if (!edicaoTema) return
  edicaoTema = null
  temaEmEdicao = null
  aplicarTema(temaAtual)
}
// Abre no Perfil, ou na aba pedida. O clique do botao chega aqui como
// evento, por isso o teste do texto.
async function abrirConfig (aba) {
  avisarFoto('')
  mostrarAbaConfig(typeof aba === 'string' ? aba : 'perfil')
  marcarAparencia()
  mostrarQualidadePadrao()
  $('#config').classList.remove('oculto')
  try {
    const config = await window.ponte.lerConfig()
    videoAtivo = config.videoAtivo
    temAmd = config.amd
    $('#campo-video').value = config.video
    $('#campo-prioridade').value = config.prioridade
    $('#config-placa').textContent = config.placa ? `Sua placa de vídeo: ${config.placa}.` : ''
    mostrarRegistro(config.registro !== false)
  } catch (erro) {
    $('#config-placa').textContent = ''
    anotar('nao consegui ler as configuracoes: ' + erro.message)
  }
  atualizarNotaConfig()
}

// Fechar no meio de uma edicao de tema e cancelar: nada fica pela metade.
function fecharConfig () {
  cancelarEdicaoDeTema()
  fecharRecorte()
  if (terminarCapturaDoAtalho) terminarCapturaDoAtalho()
  $('#config').classList.add('oculto')
}

function atualizarNotaConfig () {
  const escolhido = $('#campo-video').value
  const pendente = escolhido !== videoAtivo
  $('#btn-reiniciar').classList.toggle('oculto', !pendente)
  // O "se travar, teste o processador" ja esta na descricao da opcao.
  $('#config-nota').textContent = pendente ? 'Vale depois de reiniciar o LiveOn.' : ''

  // O aviso aparece SEMPRE, e não só depois de escolher: a pessoa precisa
  // saber o risco antes de ligar, não depois.
  const alta = $('#campo-prioridade').value === 'alta'
  const nota = $('#config-nota-prioridade')
  nota.classList.toggle('alerta', alta)
  nota.textContent = alta
    ? (temAmd
        ? 'Ligada. Com placa AMD, já travou PCs. Se travar, volte para Normal.'
        : 'Ligada. Se o PC travar ou o som falhar, volte para Normal.')
    : 'Alta pode deixar a transmissão mais fluida com jogo aberto, mas já travou alguns PCs.'
}

async function trocarVideo () {
  const video = $('#campo-video').value
  const certo = await window.ponte.gravarConfig({ video })
  if (!certo) {
    avisar('Não consegui salvar a configuração.')
    $('#campo-video').value = videoAtivo
  }
  atualizarNotaConfig()
}

// O registro (aba Debug) mora no config.json do processo principal, e nao
// no localStorage: ele comeca a gravar antes de a janela existir. Vale na
// hora, nos dois sentidos.
function mostrarRegistro (ligado) {
  for (const botao of document.querySelectorAll('#opcao-registro button')) {
    botao.classList.toggle('ativo', (botao.dataset.valor === 'ligado') === ligado)
  }
}

async function definirRegistro (ligado) {
  let certo = false
  try { certo = await window.ponte.gravarConfig({ registro: ligado }) } catch { certo = false }
  if (!certo) {
    avisar('Não consegui salvar a configuração.')
    ligado = !ligado
  }
  mostrarRegistro(ligado)
}

async function trocarPrioridade () {
  const campo = $('#campo-prioridade')
  const certo = await window.ponte.gravarConfig({ prioridade: campo.value })
  if (!certo) {
    avisar('Não consegui salvar a configuração.')
    campo.value = campo.value === 'alta' ? 'normal' : 'alta'
  }
  atualizarNotaConfig()
}
