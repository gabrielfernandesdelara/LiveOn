// Partida: o que roda uma vez, quando o app abre.

'use strict'

;(async () => {
  // Primeiro de tudo, para a tela nao nascer num tema e trocar para outro.
  aplicarTema(lembrar('liveon:tema'))

  // Nome e qualidade voltam entre sessoes. O codigo da sala nao: e o segredo
  // dela, e sala nova ganha codigo novo.
  $('#campo-nome').value = lembrar('liveon:nome') || ''
  $('#campo-resolucao').value = lembrar('liveon:resolucao') || '720'
  $('#campo-fps').value = lembrar('liveon:fps') || '30'

  definirModo('entrar')
  $('#campo-nome').focus()

  if (!window.ponte) return anotar('sem ponte: rodando fora do Electron')

  // Estado atual da atualizacao (pode ja ter sido baixada antes da tela abrir).
  mostrarAtualizacao(await window.ponte.estadoAtualizacao())

  // Envelopado porque um await que rejeita aqui mata TODO o resto da abertura
  // sem erro visivel, foi o que aconteceu quando o handler 'ambiente' nao
  // existia do lado do processo principal.
  try {
    const amb = await window.ponte.ambiente()
    // A versao na cara: sem isso nao da para saber qual build esta rodando.
    $('#rotulo-versao').textContent = 'LiveOn ' + amb.versao
    $('#rotulo-versao').title = `Electron ${amb.electron} / Chrome ${amb.chrome}`
    anotar(`iniciando LiveOn ${amb.versao}`)
    if (!amb.loopbackNativo) {
      avisar('Electron ' + amb.electron + ': o áudio do sistema exige a versão 39 ou maior.')
    }
  } catch (erro) {
    anotar('nao consegui ler o ambiente: ' + erro.message)
  }
})()
