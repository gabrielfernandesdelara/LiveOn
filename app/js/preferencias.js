// Configurações da tela de entrada: se as telas são processadas pela placa de
// vídeo ou pelo processador, e a prioridade do LiveOn no Windows.
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

async function abrirConfig () {
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
