// Configurações da tela de entrada: por enquanto, se as telas são processadas
// pela placa de vídeo ou pelo processador.
//
// A escolha mora num arquivo do processo principal, e não no localStorage,
// porque precisa ser lida ANTES da janela existir: desligar a aceleração por
// hardware só vale na abertura. Por isso mudar pede reiniciar.

'use strict'

// O que esta execução está usando. Diferente do que está no campo quando a
// pessoa trocou e ainda não reiniciou.
let videoAtivo = 'gpu'

async function abrirConfig () {
  $('#config').classList.remove('oculto')
  try {
    const config = await window.ponte.lerConfig()
    videoAtivo = config.videoAtivo
    $('#campo-video').value = config.video
    $('#config-placa').textContent = config.placa
    $('#config-placa').title = 'Placa de vídeo deste computador'
  } catch (erro) {
    $('#config-placa').textContent = ''
    anotar('nao consegui ler as configuracoes: ' + erro.message)
  }
  atualizarNotaConfig()
}

function fecharConfig () {
  $('#config').classList.add('oculto')
}

function atualizarNotaConfig () {
  const escolhido = $('#campo-video').value
  const pendente = escolhido !== videoAtivo
  $('#btn-reiniciar').classList.toggle('oculto', !pendente)
  $('#config-nota').textContent = pendente
    ? 'Vale depois de reiniciar o LiveOn.'
    : 'Se o computador travar com o LiveOn aberto, teste o processador.'
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
