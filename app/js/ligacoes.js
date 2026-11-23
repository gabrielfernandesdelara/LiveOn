// Ligações dos botões e campos da interface.

'use strict'

// A tela de entrada (Entrar, Criar, o codigo) mora em entrada.js.

// "Copiado" no próprio botão por 1,6s. Continua pelo processo principal
// (window.ponte.copiar) e não pelo navigator.clipboard: o do renderer falha
// calado sob file:// quando a janela perde o foco.
const temposDeCopia = new WeakMap()

async function copiarCodigo (codigo, botao) {
  if (!codigo) return
  const certo = await window.ponte.copiar(codigo)
  if (!certo) return avisar('Não consegui copiar.')
  tocarCopiado()

  const rotulo = botao.querySelector('.rotulo-copiar') || botao
  // O texto e o icone de antes ("Copiar", ou "Link" no botao do link).
  if (!rotulo.dataset.original) rotulo.dataset.original = rotulo.textContent
  const iconeDeAntes = botao.dataset.iconeCopia || 'copiar'
  rotulo.textContent = 'Copiado'
  // Com icone, ele vira um certo verde com um pulinho (animacoes.js).
  const comIcone = Boolean(botao.querySelector('svg'))
  if (comIcone) {
    trocarIcone(botao, 'certo', 13, 2)
    botao.classList.add('copiado')
    pularIcone(botao)
  }
  clearTimeout(temposDeCopia.get(botao))
  temposDeCopia.set(botao, setTimeout(() => {
    rotulo.textContent = rotulo.dataset.original
    if (comIcone) {
      trocarIcone(botao, iconeDeAntes, 13, 2)
      botao.classList.remove('copiado')
    }
  }, 1600))
}

$('#btn-copiar-sala').onclick = () => copiarCodigo(sessao && sessao.codigo, $('#btn-copiar-sala'))

$('#btn-transmitir').onclick = () => abrirSeletor('iniciar')

// A grade vazia tem o mesmo botão, para quem chega e quer começar.
$('#btn-transmitir-vazio').onclick = () => abrirSeletor('iniciar')

$('#btn-ajustar').onclick = () => abrirSeletor('ajustar')

$('#btn-parar').onclick = pararTransmissao

// Ligar passa pela previa: a pessoa se ve antes de ir ao ar. Desligar e na
// hora, sem perguntar nada.
$('#btn-camera').onclick = () => (streamCamera ? desligarCamera() : abrirCamera())
$('#btn-ligar-camera').onclick = ligarCamera
$('#btn-cancelar-camera').onclick = fecharCamera
$('#campo-camera').onchange = trocarCamera
$('#camera').onclick = (evento) => {
  if (evento.target === $('#camera')) fecharCamera()
}

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

// Headset conectado ou desconectado no meio da sala: a lista aberta atualiza,
// e o som vai para onde ainda existe.
navigator.mediaDevices.addEventListener('devicechange', () => {
  const abaAberta = !$('#config').classList.contains('oculto') &&
    !document.querySelector('[data-secao=audio]').classList.contains('oculto')
  if (abaAberta) preencherSaidas()
  aplicarSaidaEmTodos()
})

// Clicar no escuro em volta fecha, como no seletor de fontes.
$('#ajustes').onclick = (evento) => {
  if (evento.target === $('#ajustes')) fecharAjustes()
}

// Configurações da tela de entrada.
$('#btn-config').onclick = abrirConfig
$('#btn-config-sala').onclick = abrirConfig
for (const aba of document.querySelectorAll('.aba-config')) aba.onclick = () => mostrarAbaConfig(aba.dataset.aba)
for (const tema of document.querySelectorAll('.tema')) tema.onclick = () => escolherTema(tema.dataset.tema)
for (const botao of document.querySelectorAll('#opcao-camera button')) botao.onclick = () => escolherFormatoDaCamera(botao.dataset.valor)
for (const botao of document.querySelectorAll('#opcao-selo button')) botao.onclick = () => definirNomeNoCard(botao.dataset.valor)
for (const botao of document.querySelectorAll('#opcao-assistir button')) botao.onclick = () => definirModoAssistir(botao.dataset.valor)
for (const botao of document.querySelectorAll('#opcao-tamanho-cam button')) botao.onclick = () => definirTamanhoDaCamera(botao.dataset.valor)
for (const botao of document.querySelectorAll('#opcao-minha-tela button')) botao.onclick = () => definirMinhaTela(botao.dataset.valor)
$('#btn-atalho-mini').onclick = capturarAtalhoDaMini
$('#campo-codificador').onchange = () => definirCodificador($('#campo-codificador').value)
$('#campo-qualidade-altura').onchange = definirQualidadePadrao
$('#campo-qualidade-fps').onchange = definirQualidadePadrao
$('#campo-banda').onchange = () => definirBanda($('#campo-banda').value)
for (const botao of document.querySelectorAll('#opcao-pausa button')) botao.onclick = () => definirModoPausa(botao.dataset.valor)
$('#btn-abrir-log').onclick = () => window.ponte.abrirPastaDoLog('registro')
$('#btn-abrir-monitoria').onclick = () => window.ponte.abrirPastaDoLog('monitoria')
for (const botao of document.querySelectorAll('#opcao-monitoria button')) botao.onclick = () => definirMonitoria(botao.dataset.valor === 'ligada')
for (const botao of document.querySelectorAll('#opcao-registro button')) botao.onclick = () => definirRegistro(botao.dataset.valor === 'ligado')
$('#btn-atalho-padrao').onclick = voltarAtalhoPadrao
for (const botao of document.querySelectorAll('#opcao-som-novo button')) botao.onclick = () => definirSomDasNovas(botao.dataset.valor)
for (const campo of document.querySelectorAll('.editor-tema-cor')) campo.oninput = () => mudarCorDoEditor(campo)
// Os dois fundos do editor de tema (papel de parede e fundo da sala) saem do
// mesmo molde: as mesmas ligacoes, cada uma com o alvo do seu bloco.
for (const bloco of document.querySelectorAll('.editor-fundo')) {
  const alvo = bloco.dataset.alvo
  const parte = (nome) => bloco.querySelector(`[data-parte="${nome}"]`)
  parte('escolher').onclick = () => parte('arquivo').click()
  parte('arquivo').onchange = () => {
    const arquivo = parte('arquivo').files[0]
    parte('arquivo').value = ''
    escolherPapel(arquivo, alvo)
  }
  parte('remover').onclick = () => removerPapel(alvo)
  parte('escurecer').oninput = () => mudarEscurecer(alvo)
  parte('zoom').oninput = () => mudarZoomDoPapel(Number(parte('zoom').value), alvo)
  parte('sem-efeitos').onclick = () => tirarEfeitos(alvo)
  for (const barra of bloco.querySelectorAll('.barra-efeito')) barra.oninput = () => mudarEfeito(barra.dataset.efeito, Number(barra.value), alvo)
  ligarPreviaDoPapel(alvo)
}
ligarPreviaDaEntrada()
$('#btn-cores-do-papel').onclick = tirarCoresDoPapel
for (const botao of document.querySelectorAll('#opcao-animacoes button')) botao.onclick = () => definirAnimacoes(botao.dataset.valor)
for (const botao of document.querySelectorAll('#opcao-fundo-sala button')) botao.onclick = () => definirModoDoFundoDaSala(botao.dataset.valor)
$('#cor-sala').oninput = () => mudarCorDoFundoDaSala($('#cor-sala').value)
for (const botao of document.querySelectorAll('#opcao-entrada button')) botao.onclick = () => definirPosicaoDaEntrada(botao.dataset.valor)
for (const botao of document.querySelectorAll('#opcao-amigos button')) botao.onclick = () => definirLadoDosAmigos(botao.dataset.valor)
$('#campo-base-tema').onchange = mudarBaseDoTema
$('#btn-salvar-tema').onclick = salvarTema
$('#btn-cancelar-tema').onclick = () => mostrarAbaConfig('aparencia')
$('#btn-escolher-foto').onclick = () => $('#arquivo-foto').click()
$('#arquivo-foto').onchange = () => {
  const arquivo = $('#arquivo-foto').files[0]
  // Limpa, senao escolher o MESMO arquivo de novo nao dispara o change.
  $('#arquivo-foto').value = ''
  escolherFoto(arquivo)
}
$('#btn-ajustar-foto').onclick = ajustarFotoAtual
$('#btn-remover-foto').onclick = removerFoto
$('#btn-salvar-foto').onclick = salvarFoto
$('#btn-cancelar-foto').onclick = fecharRecorte
$('#zoom-foto').oninput = () => zoomRecorte(Number($('#zoom-foto').value))
ligarRecorte()
$('#campo-nome-tema').onkeydown = (evento) => { if (evento.key === 'Enter') salvarTema() }
$('#btn-fechar-config').onclick = fecharConfig
$('#campo-video').onchange = trocarVideo
$('#campo-prioridade').onchange = trocarPrioridade
$('#btn-reiniciar').onclick = () => window.ponte.reiniciar()
$('#config').onclick = (evento) => {
  if (evento.target === $('#config')) fecharConfig()
}

$('#btn-sair').onclick = () => {
  // Marca antes de fechar, senao o onclose acha que caiu e tenta reconectar.
  saindoDeProposito = true
  avisarSaida()

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

$('#campo-sdr').onchange = () => guardar('liveon:forcar-sdr', $('#campo-sdr').checked ? '1' : '0')

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
    mostrarOpcaoSdr()
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
