// Configurações: a janela grande, aberta pela engrenagem da entrada e pela da
// barra da sala. Duas abas:
//
// - Aparência: tema, formato da webcam dos amigos e se a inicial do nome fica
//   sempre no card. Tudo vale na hora e fica no localStorage, porque é gosto
//   de quem olha e só a página usa.
// - Desempenho: se as telas são processadas pela placa de vídeo ou pelo
//   processador, e a prioridade do LiveOn no Windows.
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

function escolherTema (tema) {
  aplicarTema(tema)
  marcarAparencia()
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
function criarPreviaDeTema (papel, escurecer, fundo) {
  const previa = document.createElement('span')
  previa.className = 'previa-tema'
  if (papel) {
    const [r, g, b] = paraRgb(fundo)
    const veu = `rgba(${r}, ${g}, ${b}, ${escurecer})`
    previa.style.backgroundImage = `linear-gradient(${veu}, ${veu}), url("${papel}")`
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
    botao.append(criarPreviaDeTema(papel, tema.escurecer, tema.cores.fundo), nome)
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

  mostrarTemaNoEditor()
  mostrarSecaoConfig('editor', 'aparencia')
  $('#campo-nome-tema').focus()
}

// Os campos, o codigo de cada cor, o papel, o app inteiro e o aviso, tudo a
// partir de temaEmEdicao.
function mostrarTemaNoEditor () {
  const { cores, papel, escurecer } = temaEmEdicao
  // O icone segue o destaque ate a pessoa escolher outra cor para ele.
  const visivel = { ...cores, marca: cores.marca || cores.destaque, marcaPonto: cores.marcaPonto || PONTO_PADRAO }
  for (const campo of document.querySelectorAll('.editor-tema-cor')) {
    const cor = visivel[campo.dataset.cor]
    campo.value = cor
    campo.parentNode.querySelector('.hex-cor').textContent = cor.toUpperCase()
  }

  $('#previa-papel').style.backgroundImage = papel ? `url("${papel}")` : ''
  $('#previa-papel').classList.toggle('vazio', !papel)
  $('#btn-remover-papel').classList.toggle('oculto', !papel)
  $('#btn-escolher-papel').textContent = papel ? 'Trocar imagem' : 'Escolher imagem'
  $('#escurecer-papel').value = String(escurecer)
  $('#escurecer-papel').disabled = !papel

  previaDeTema(temaEmEdicao)
  $('#aviso-contraste').textContent = avisoDeContraste(cores)
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

function mudarEscurecer () {
  if (!temaEmEdicao) return
  temaEmEdicao.escurecer = Number($('#escurecer-papel').value)
  mostrarTemaNoEditor()
}

// Qualquer imagem vira papel de parede: reduzida ate PAPEL_LADO no maior
// lado e comprimida em WebP ate caber em PAPEL_MAXIMO. Se nem na qualidade
// mais baixa couber, diminui a imagem e tenta de novo.
async function escolherPapel (arquivo) {
  $('#aviso-papel').textContent = ''
  if (!arquivo || !temaEmEdicao) return
  if (!arquivo.type.startsWith('image/')) return ($('#aviso-papel').textContent = 'Esse arquivo não é uma imagem.')
  if (arquivo.size > ARQUIVO_MAXIMO) return ($('#aviso-papel').textContent = 'Imagem grande demais. O limite é 20 MB.')

  let bitmap
  try {
    bitmap = await createImageBitmap(arquivo)
  } catch {
    return ($('#aviso-papel').textContent = 'Não consegui abrir essa imagem.')
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
  if (!blob) return ($('#aviso-papel').textContent = 'Não consegui deixar a imagem leve o bastante.')

  if (!temaEmEdicao) return
  temaEmEdicao.papel = await paraDataUrl(blob)
  anotar(`papel de parede escolhido: ${Math.round(blob.size / 1024)} KB`)
  mostrarTemaNoEditor()
}

function removerPapel () {
  if (!temaEmEdicao) return
  temaEmEdicao.papel = ''
  mostrarTemaNoEditor()
}

function salvarTema () {
  if (!edicaoTema) return
  const { lugar } = edicaoTema
  const { cores, papel, escurecer } = temaEmEdicao

  // O papel vai primeiro, e confere: guardar() engole erro, e sem espaco no
  // armazenamento o tema seria salvo sem o papel, calado.
  guardar('liveon:papel-' + lugar, papel)
  if (papel && lembrar('liveon:papel-' + lugar) !== papel) {
    $('#aviso-papel').textContent = 'Sem espaço para guardar esse papel de parede. Tente uma imagem menor ou apague um tema.'
    return
  }

  const lista = temasPessoais()
  lista[lugar] = {
    nome: $('#campo-nome-tema').value.trim().slice(0, 24) || 'Meu tema ' + (lugar + 1),
    cores: { ...cores },
    papel: Boolean(papel),
    escurecer
  }
  guardarTemasPessoais(lista)
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
async function abrirConfig () {
  avisarFoto('')
  mostrarAbaConfig('perfil')
  marcarAparencia()
  $('#config').classList.remove('oculto')
  try {
    const config = await window.ponte.lerConfig()
    videoAtivo = config.videoAtivo
    temAmd = config.amd
    $('#campo-video').value = config.video
    $('#campo-prioridade').value = config.prioridade
    $('#config-placa').textContent = config.placa
    $('#config-placa').title = 'Placa de vídeo deste computador'
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
  $('#config').classList.add('oculto')
}

function atualizarNotaConfig () {
  const escolhido = $('#campo-video').value
  const pendente = escolhido !== videoAtivo
  $('#btn-reiniciar').classList.toggle('oculto', !pendente)
  $('#config-nota').textContent = pendente
    ? 'Vale depois de reiniciar o LiveOn.'
    : 'Se o computador travar com o LiveOn aberto, teste o processador.'

  // O aviso aparece SEMPRE, e não só depois de escolher: a pessoa precisa
  // saber o risco antes de ligar, não depois.
  const alta = $('#campo-prioridade').value === 'alta'
  const nota = $('#config-nota-prioridade')
  nota.classList.toggle('alerta', alta)
  nota.textContent = alta
    ? (temAmd
        ? 'Ligada. Com placa AMD, já travou PCs. Se travar, volte para Normal.'
        : 'Ligada. Se o PC travar ou o som falhar, volte para Normal.')
    : 'Alta pode deixar a tela mais fluida com jogo aberto, mas trava alguns PCs.'
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

async function trocarPrioridade () {
  const campo = $('#campo-prioridade')
  const certo = await window.ponte.gravarConfig({ prioridade: campo.value })
  if (!certo) {
    avisar('Não consegui salvar a configuração.')
    campo.value = campo.value === 'alta' ? 'normal' : 'alta'
  }
  atualizarNotaConfig()
}
