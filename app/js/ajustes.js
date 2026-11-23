// Painel de ajustes por pessoa: a qualidade e o volume que EU recebo dela.

'use strict'

// ---- qualidade padrao ----
//
// O teto que eu peco a TODA tela que abrir (aba Telas, pedido do dono). A
// escolha de cada pessoa, na engrenagem dela, manda por cima: e por isso que
// qualidadePorId so guarda quem ficou DIFERENTE do padrao. 0 = automatico
// (o que quem transmite mandar).
const ALTURAS_DA_QUALIDADE = [0, 1440, 1080, 720, 480, 360]
const FPS_DA_QUALIDADE = [0, 60, 30]

function qualidadePadrao () {
  let q = null
  try { q = JSON.parse(lembrar('liveon:qualidade-padrao') || 'null') } catch { q = null }
  return {
    altura: ALTURAS_DA_QUALIDADE.includes(q && q.altura) ? q.altura : 0,
    fps: FPS_DA_QUALIDADE.includes(q && q.fps) ? q.fps : 0
  }
}

function temQualidadePadrao () {
  const q = qualidadePadrao()
  return Boolean(q.altura || q.fps)
}

// O que vale para essa pessoa: a escolha dela, ou o padrao.
function qualidadeDe (id) {
  return qualidadePorId.get(id) || qualidadePadrao()
}

function mostrarQualidadePadrao () {
  const q = qualidadePadrao()
  $('#campo-qualidade-altura').value = String(q.altura)
  $('#campo-qualidade-fps').value = String(q.fps)
}

// Vale na hora para as telas que ja estao abertas sem escolha propria.
function definirQualidadePadrao () {
  const altura = Number($('#campo-qualidade-altura').value) || 0
  const fps = Number($('#campo-qualidade-fps').value) || 0
  guardar('liveon:qualidade-padrao', JSON.stringify({ altura, fps }))
  for (const [id, pessoa] of participantes) {
    if (!qualidadePorId.has(id) && (pessoa.transmitindo || streamsRecebidos.has(id))) pedirQualidade(id)
  }
}

// ---- painel de ajustes por pessoa ----

function abrirAjustes (id) {
  const pessoa = participantes.get(id)
  if (!pessoa) return

  ajustesAbertos = id
  $('#ajustes-quem').textContent = pessoa.nome

  const escolha = qualidadeDe(id)
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

  // Igual ao padrao, segue o padrao (e acompanha se ele mudar depois).
  const padrao = qualidadePadrao()
  if (altura === padrao.altura && fps === padrao.fps) qualidadePorId.delete(id)
  else qualidadePorId.set(id, { altura, fps })

  pedirQualidade(id)
}

// Avisa quem transmite do teto que eu quero. Reenviado quando um video novo
// chega: se a pessoa reiniciou a transmissao, os remetentes dela sao outros.
function pedirQualidade (id) {
  const escolha = qualidadeDe(id)
  enviar({
    tipo: 'qualidade',
    para: id,
    altura: escolha.altura,
    fps: escolha.fps,
    // false = "ainda nao cliquei para assistir": quem transmite desliga o
    // envio para mim (assistir.js).
    assistindo: estouAssistindo(id),
    // true = o LiveOn nao esta a vista: so a imagem para, o som continua
    // (pausa.js).
    pausado: imagemPausadaDe(id)
  })
}
