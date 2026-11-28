// Troca entre a tela de entrada e a sala, e os avisos na tela.

'use strict'

let tempoRecado = null

function avisar (texto) {
  const recado = $('#recado')
  recado.textContent = texto
  recado.classList.remove('oculto')
  clearTimeout(tempoRecado)
  tempoRecado = setTimeout(() => recado.classList.add('oculto'), 6000)
}

// Fecha o diálogo que estiver aberto e diz se havia algum. É o primeiro
// degrau do Esc.
function fecharDialogo () {
  if (!$('#ajustes').classList.contains('oculto')) {
    fecharAjustes()
    return true
  }
  // Fechar a camera tambem apaga a previa: so esconder deixaria a luz dela
  // acesa.
  if (cameraAberta()) {
    fecharCamera()
    return true
  }
  // As configuracoes fecham pelo fecharConfig(): ele desfaz a previa de um
  // tema que estava sendo editado.
  if (!$('#config').classList.contains('oculto')) {
    fecharConfig()
    return true
  }
  if (remocaoEstaAberta()) {
    fecharRemocao()
    return true
  }
  for (const id of ['#seletor']) {
    if (!$(id).classList.contains('oculto')) {
      $(id).classList.add('oculto')
      return true
    }
  }
  return false
}

function mostrarSala (sala) {
  // A entrada cresce um pouco e some, a sala chega de leve (animacoes.js), e
  // o fundo passa a ser o da sala, se o tema tiver um.
  document.documentElement.classList.add('na-sala')
  // O "entrando" (o anel vermelho) sai no fim da troca, com a entrada ja
  // escondida (terminarTroca).
  trocarDeTela($('#entrada'), $('#sala'), true)
  const papelAntes = getComputedStyle(document.documentElement).getPropertyValue('--papel')
  aplicarFundoDaVez()
  animarFundoNaTroca(getComputedStyle(document.documentElement).getPropertyValue('--papel') !== papelAntes)
  // O nome cortado com reticências na barra continua inteiro no title.
  $('#rotulo-sala').textContent = sala
  $('#rotulo-sala').title = sala
  $('#rotulo-codigo').textContent = sessao ? sessao.codigo : ''
  sincronizarGrade()
}

function voltarParaEntrada () {
  if (idTelaCheia) {
    idTelaCheia = null
    janelaAcompanha = false
    window.ponte.telaCheia(false)
  }
  focados.clear()
  streamsRecebidos.clear()
  camerasRecebidas.clear()
  qualidadePorId.clear()
  volumePorId.clear()
  fotosPorId.clear()
  esquecerTelas()
  fecharMiniTela()
  aguardandoEntrada = false
  if (sessao) sessao.credencial = null
  volumeAntesDeMudo.clear()
  // Uma queda definitiva da sala pode chegar com um diálogo aberto, e ele
  // ficaria por cima da tela de entrada.
  while (fecharDialogo()) { /* fecha um por vez */ }
  fecharPessoas()
  fecharAmigosDaSala()
  clearTimeout(temporizadorReconexao)
  pararVigia()
  sessao = null
  tentativasDeReconexao = 0
  marcarConexao('ok', '')

  pararDiagnostico()
  pararSinal()
  pararPausa()
  if (meuId) {
    anotar('sai da sala')
    try { window.ponte.logSaiu() } catch { /* sem ponte */ }
  }

  pararTransmissao()
  // Sair da sala apaga a webcam junto: ninguem espera continuar sendo filmado
  // na tela de entrada.
  desligarCamera()
  for (const par of pares.values()) par.pc.close()
  pares.clear()
  participantes.clear()
  meuId = null
  esquecerDonoDaSala()
  // Os amigos deixam de me ver na sala (amigos.js).
  atualizarPresencaNaSala()

  $('#principal').textContent = ''
  $('#miniaturas').textContent = ''
  document.documentElement.classList.remove('na-sala')
  esquecerPontosDaSala()
  trocarDeTela($('#sala'), $('#entrada'), false)
  const papelAntes = getComputedStyle(document.documentElement).getPropertyValue('--papel')
  aplicarFundoDaVez()
  animarFundoNaTroca(getComputedStyle(document.documentElement).getPropertyValue('--papel') !== papelAntes)
  reabrirEntrada()
}
