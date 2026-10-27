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
  for (const id of ['#saida', '#seletor']) {
    if (!$(id).classList.contains('oculto')) {
      $(id).classList.add('oculto')
      return true
    }
  }
  return false
}

function mostrarSala (sala) {
  $('#entrada').classList.add('oculto')
  $('#sala').classList.remove('oculto')
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
  qualidadePorId.clear()
  volumePorId.clear()
  aguardandoEntrada = false
  if (sessao) sessao.credencial = null
  volumeAntesDeMudo.clear()
  // Uma queda definitiva da sala pode chegar com um diálogo aberto, e ele
  // ficaria por cima da tela de entrada.
  while (fecharDialogo()) { /* fecha um por vez */ }
  fecharPessoas()
  clearTimeout(temporizadorReconexao)
  pararVigia()
  sessao = null
  tentativasDeReconexao = 0
  marcarConexao('ok', '')

  pararTransmissao()
  for (const par of pares.values()) par.pc.close()
  pares.clear()
  participantes.clear()
  meuId = null

  $('#principal').textContent = ''
  $('#miniaturas').textContent = ''
  $('#sala').classList.add('oculto')
  $('#entrada').classList.remove('oculto')
}
