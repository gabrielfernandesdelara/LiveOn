// Painel de ajustes por pessoa: a qualidade e o volume que EU recebo dela.

'use strict'

// ---- painel de ajustes por pessoa ----

function abrirAjustes (id) {
  const pessoa = participantes.get(id)
  if (!pessoa) return

  ajustesAbertos = id
  $('#ajustes-quem').textContent = pessoa.nome

  const escolha = qualidadePorId.get(id) || { altura: 0, fps: 0 }
  $('#ajustes-resolucao').value = String(escolha.altura || 0)
  $('#ajustes-fps').value = String(escolha.fps || 0)

  const nivel = volumeDe(id)
  $('#ajustes-volume').value = String(nivel)
  $('#ajustes-nivel').textContent = nivel + '%'

  $('#ajustes').classList.remove('oculto')
}

function fecharAjustes () {
  ajustesAbertos = null
  $('#ajustes').classList.add('oculto')
}

// Resolucao e fps sao independentes: da para pedir so 30 fps mantendo a
// resolucao cheia, ou o contrario.
function escolherQualidade (id) {
  const altura = Number($('#ajustes-resolucao').value) || 0
  const fps = Number($('#ajustes-fps').value) || 0

  if (altura || fps) qualidadePorId.set(id, { altura, fps })
  else qualidadePorId.delete(id)

  pedirQualidade(id)
}

// Avisa quem transmite do teto que eu quero. Reenviado quando um video novo
// chega: se a pessoa reiniciou a transmissao, os remetentes dela sao outros.
function pedirQualidade (id) {
  const escolha = qualidadePorId.get(id)
  enviar({
    tipo: 'qualidade',
    para: id,
    altura: escolha ? escolha.altura : 0,
    fps: escolha ? escolha.fps : 0
  })
}
