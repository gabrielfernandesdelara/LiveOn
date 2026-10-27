// Ligações dos botões e campos da interface.

'use strict'

function definirModo (novo) {
  modo = novo

  for (const nome of ['criar', 'entrar']) {
    $('#modo-' + nome).classList.toggle('ativo', novo === nome)
  }

  // So "criar" pede nome da sala; entrar trabalha so com o codigo.
  $('#bloco-sala').classList.toggle('oculto', novo !== 'criar')
  $('#dica-entrada').textContent = novo === 'criar'
    ? 'O código é a chave da sala. Copie e mande para os seus amigos.'
    : 'Peça o código para quem criou a sala.'

  const criando = novo === 'criar'
  const campo = $('#campo-codigo')

  // Criando, o codigo e sorteado e nao se digita: e o que impede alguem de
  // escolher "132" de novo. Entrando, ele e digitado normalmente.
  campo.readOnly = criando
  $('#btn-gerar-codigo').classList.toggle('oculto', !criando)
  $('#btn-copiar-codigo').classList.toggle('oculto', !criando)

  if (criando) {
    if (!campo.value || !campo.dataset.sorteado) novoCodigo()
  } else if (campo.dataset.sorteado) {
    // O codigo sorteado era para a sala que EU criaria; nao serve para entrar.
    campo.value = ''
    delete campo.dataset.sorteado
  }

  $('#btn-entrar').textContent = criando ? 'Criar sala' : 'Entrar na sala'
  atualizarBotaoEntrar()
}

// O botão principal fica apagado enquanto falta algo, mas continua clicável:
// o clique diz o que falta, e o Enter dos campos continua respondendo.
// Os 10 caracteres são o piso que o servidor confere no código.
function atualizarBotaoEntrar () {
  const nome = $('#campo-nome').value.trim()
  const pronto = modo === 'criar'
    ? Boolean(nome && $('#campo-sala').value.trim())
    : Boolean(nome && $('#campo-codigo').value.trim().length >= 10)
  $('#btn-entrar').classList.toggle('incompleto', !pronto)
}

function novoCodigo () {
  const campo = $('#campo-codigo')
  campo.value = gerarCodigo()
  campo.dataset.sorteado = '1'
}

$('#modo-criar').onclick = () => definirModo('criar')

$('#modo-entrar').onclick = () => definirModo('entrar')

$('#btn-gerar-codigo').onclick = novoCodigo

// "Copiado" no próprio botão por 1,6s. Continua pelo processo principal
// (window.ponte.copiar) e não pelo navigator.clipboard: o do renderer falha
// calado sob file:// quando a janela perde o foco.
const temposDeCopia = new WeakMap()

async function copiarCodigo (codigo, botao) {
  if (!codigo) return
  const certo = await window.ponte.copiar(codigo)
  if (!certo) return avisar('Não consegui copiar.')

  const rotulo = botao.querySelector('.rotulo-copiar') || botao
  rotulo.textContent = 'Copiado'
  clearTimeout(temposDeCopia.get(botao))
  temposDeCopia.set(botao, setTimeout(() => { rotulo.textContent = 'Copiar' }, 1600))
}

$('#btn-copiar-codigo').onclick = () => copiarCodigo($('#campo-codigo').value, $('#btn-copiar-codigo'))

$('#btn-entrar').onclick = () => {
  const nome = $('#campo-nome').value.trim()
  const rotulo = $('#campo-sala').value.trim()
  const codigo = $('#campo-codigo').value.trim()

  if (!nome) return avisar('Preencha seu nome.')
  if (!codigo) return avisar('Preencha o código da sala.')
  if (modo === 'criar' && !rotulo) return avisar('Preencha o nome da sala.')

  meuNome = nome
  guardar('liveon:nome', nome)

  anotar(modo === 'criar' ? `criando sala "${rotulo}"` : 'entrando com um codigo')
  conectar({ nome, codigo, rotulo, criando: modo === 'criar' })
}

for (const campo of ['#campo-nome', '#campo-sala', '#campo-codigo']) {
  $(campo).addEventListener('keydown', (evento) => {
    if (evento.key === 'Enter') $('#btn-entrar').click()
  })
  $(campo).addEventListener('input', atualizarBotaoEntrar)
}

$('#btn-copiar-sala').onclick = () => copiarCodigo(sessao && sessao.codigo, $('#btn-copiar-sala'))

$('#btn-transmitir').onclick = () => abrirSeletor('iniciar')

// A grade vazia tem o mesmo botão, para quem chega e quer começar.
$('#btn-transmitir-vazio').onclick = () => abrirSeletor('iniciar')

$('#btn-ajustar').onclick = () => abrirSeletor('ajustar')

$('#btn-parar').onclick = pararTransmissao

$('#btn-pessoas').onclick = alternarPessoas

// Clicar fora fecha o pop-over. Isso cobre também abrir um diálogo por fora
// dele (Transmitir, Ajustar, a engrenagem de um card): o clique é fora.
document.addEventListener('click', (evento) => {
  if (pessoasAbertas() && !evento.target.closest('.ancora-pessoas')) fecharPessoas()
})

$('#ajustes-resolucao').onchange = () => ajustesAbertos && escolherQualidade(ajustesAbertos)

$('#ajustes-fps').onchange = () => ajustesAbertos && escolherQualidade(ajustesAbertos)

$('#ajustes-volume').oninput = () => {
  if (ajustesAbertos) aplicarVolume(ajustesAbertos, Number($('#ajustes-volume').value))
}

$('#ajustes-volume').onchange = () => {
  if (ajustesAbertos) registrarVolume(ajustesAbertos)
}

$('#btn-fechar-ajustes').onclick = fecharAjustes

$('#campo-saida').onchange = () => {
  const campo = $('#campo-saida')
  saidaEscolhida = campo.value
  guardar('liveon:saida', saidaEscolhida)
  anotar(`saida de audio: ${campo.selectedOptions[0].textContent}`)
  aplicarSaidaEmTodos()
}

$('#btn-fechar-saida').onclick = () => $('#saida').classList.add('oculto')

$('#saida').onclick = (evento) => {
  if (evento.target === $('#saida')) $('#saida').classList.add('oculto')
}

// Headset conectado ou desconectado no meio da sala: a lista aberta atualiza,
// e o som vai para onde ainda existe.
navigator.mediaDevices.addEventListener('devicechange', () => {
  if (!$('#saida').classList.contains('oculto')) abrirSaida()
  aplicarSaidaEmTodos()
})

// Clicar no escuro em volta fecha, como no seletor de fontes.
$('#ajustes').onclick = (evento) => {
  if (evento.target === $('#ajustes')) fecharAjustes()
}

$('#btn-sair').onclick = () => {
  // Marca antes de fechar, senao o onclose acha que caiu e tenta reconectar.
  saindoDeProposito = true

  if (ws) {
    try { ws.close() } catch { /* ja estava fechando */ }
  }

  // Sai da sala AGORA, sem esperar o onclose. Se o socket ja estiver fechando
  // ou travado, aquele evento pode nao vir, e o botao ficava sem efeito.
  // Chamar duas vezes e inofensivo: a limpeza e idempotente.
  voltarParaEntrada()
}

$('#btn-cancelar-fonte').onclick = () => $('#seletor').classList.add('oculto')

$('#btn-fechar-seletor').onclick = () => $('#seletor').classList.add('oculto')

// Clicar no escuro em volta fecha, como nos outros diálogos.
$('#seletor').onclick = (evento) => {
  if (evento.target === $('#seletor')) $('#seletor').classList.add('oculto')
}

$('#btn-atualizar-fontes').onclick = carregarFontes

$('#campo-resolucao').onchange = () => {
  guardar('liveon:resolucao', $('#campo-resolucao').value)
  atualizarAvisoDeQualidade()
}

$('#campo-fps').onchange = () => {
  guardar('liveon:fps', $('#campo-fps').value)
  atualizarAvisoDeQualidade()
}

$('#campo-audio-modo').onchange = atualizarOpcoesDeAudio

$('#campo-audio-app').onchange = atualizarOpcoesDeAudio

$('#btn-confirmar-fonte').onclick = async () => {
  if (!fonteEscolhida) return

  let configAudio
  try {
    configAudio = await configuracaoDeAudio()
  } catch (erro) {
    return avisar(erro.message)
  }

  $('#seletor').classList.add('oculto')

  if (modoDoSeletor === 'ajustar') ajustarTransmissao(fonteEscolhida, configAudio)
  else iniciarTransmissao(fonteEscolhida, configAudio)
}

for (const aba of document.querySelectorAll('.aba')) {
  aba.onclick = () => {
    abaAtual = aba.dataset.aba
    for (const outra of document.querySelectorAll('.aba')) {
      outra.classList.toggle('ativa', outra === aba)
    }
    desenharFontes()
    atualizarOpcoesDeAudio()
  }
}

// --- atualizacao automatica --------------------------------------------------

// O aviso de atualizacao cobre a tela inteira e nao pode ser dispensado: a
// versao nova costuma mudar o protocolo, e quem fica para tras simplesmente
// nao consegue entrar nas salas dos outros.
//
// A excecao e falha: se o download nao completar, liberar o app e melhor do
// que trancar todo mundo do lado de fora por causa de uma queda do GitHub.
function mostrarAtualizacao (estado) {
  const tela = $('#tela-atualizacao')
  const botao = $('#btn-atualizar')
  const titulo = $('#titulo-atualizacao')
  const texto = $('#texto-atualizacao')
  const progresso = $('#progresso-atualizacao')

  const bloqueia = estado.situacao === 'baixando' || estado.situacao === 'pronta'
  tela.classList.toggle('oculto', !bloqueia)
  if (!bloqueia) {
    if (estado.situacao === 'falhou') anotar('atualizacao falhou: ' + estado.motivo)
    return
  }

  if (estado.situacao === 'baixando') {
    const porcento = estado.porcento || 0
    titulo.textContent = 'Baixando atualização'
    texto.textContent = estado.versao
      ? `Versão ${estado.versao}. Leva alguns segundos.`
      : 'Leva alguns segundos.'
    progresso.style.width = porcento + '%'
    botao.textContent = `Baixando... ${porcento}%`
    botao.disabled = true
    return
  }

  titulo.textContent = 'Atualização pronta'
  texto.textContent =
    `Versão ${estado.versao} baixada. O app reinicia sozinho.`
  progresso.style.width = '100%'
  botao.textContent = 'Atualizar e reiniciar'
  botao.disabled = false
}

if (window.ponte && window.ponte.aoMudarAtualizacao) {
  window.ponte.aoMudarAtualizacao(mostrarAtualizacao)
}

$('#btn-atualizar').onclick = async () => {
  const botao = $('#btn-atualizar')
  botao.disabled = true
  botao.textContent = 'Atualizando...'

  const foi = await window.ponte.instalarAtualizacao()
  if (!foi) {
    // Nao conseguiu instalar: libera o app em vez de deixar o usuario preso.
    avisar('Não consegui instalar agora. Tente mais tarde.')
    $('#tela-atualizacao').classList.add('oculto')
  }
}
