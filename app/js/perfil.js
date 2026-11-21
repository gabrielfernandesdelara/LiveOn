// Foto de perfil: escolher, enquadrar, comprimir, guardar, mandar para a sala
// e receber a dos outros.
//
// Sem banco de dados. A foto mora no PC de quem escolheu (localStorage) e vai
// para cada pessoa da sala como mensagem direcionada, do mesmo jeito que uma
// oferta de vídeo: quando eu entro, para quem já está lá; quando alguém
// entra, para quem chegou; quando eu troco ou removo, para todo mundo. O
// servidor só repassa. Ela também não cabe no servidor, de qualquer jeito: o
// anexo de cada socket no Durable Object tem 2 KB.
//
// Qualquer imagem serve, até foto de celular de vários MB. Ela é reduzida na
// hora em que é escolhida (ORIGINAL_MAXIMO, guardada para dar para
// reenquadrar depois sem escolher de novo), e a foto que vai para a sala sai
// do enquadramento em 128x128, WebP, com a qualidade baixando até caber em
// FOTO_MAXIMA. Uma foto comum fica entre 5 e 12 KB.
//
// A foto dos OUTROS é dado remoto: só entra se for data: de imagem, dentro do
// tamanho, e se abrir como imagem de verdade. Vai num <img>, nunca em HTML. A
// CSP já permite data: em img-src.

'use strict'

const FOTO_LADO = 128
const FOTO_MAXIMA = 16 * 1024          // bytes da foto que vai para a sala
const ARQUIVO_MAXIMO = 20 * 1024 * 1024 // o que a pessoa pode escolher
const ORIGINAL_MAXIMO = 640             // maior lado do original guardado
const ZOOM_MAXIMO = 4

// O que chega pela sala: base64 de 16 KB fica em ~22 mil caracteres.
const FOTO_RECEBIDA_MAXIMA = 24000
const FORMATO_DE_FOTO = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/

// Para o avatar saber que e o meu fora da sala (sem meuId ainda).
const EU = 'eu'

// id -> data: da foto de cada um. Sobrevive ao 'saiu', como o volume: quem
// cai volta com o mesmo id. Some quando eu saio da sala.
const fotosPorId = new Map()

function minhaFoto () {
  const foto = lembrar('liveon:foto')
  return FORMATO_DE_FOTO.test(foto) ? foto : ''
}

function fotoDe (id) {
  if (id === EU || (id && id === meuId)) return minhaFoto()
  return fotosPorId.get(id) || ''
}

// --- sala --------------------------------------------------------------------

function enviarFotoPara (id) {
  const foto = minhaFoto()
  // Sem foto nao manda nada: quem nao recebe nada mostra a inicial.
  if (foto) enviar({ tipo: 'foto', para: id, imagem: foto })
}

// Trocou ou removeu: todo mundo fica sabendo. '' e "voltou para a inicial".
function enviarFotoParaTodos () {
  for (const id of participantes.keys()) enviar({ tipo: 'foto', para: id, imagem: minhaFoto() })
}

function receberFoto (msg) {
  const id = msg.de
  if (!participantes.has(id)) return
  const imagem = typeof msg.imagem === 'string' ? msg.imagem : ''

  if (!imagem) {
    fotosPorId.delete(id)
    return redesenharAvatares(id)
  }
  if (imagem.length > FOTO_RECEBIDA_MAXIMA || !FORMATO_DE_FOTO.test(imagem)) {
    return anotar(`foto de ${id.slice(0, 8)} recusada: fora do formato ou grande demais`)
  }

  // So entra se abrir como imagem de verdade, e de tamanho de avatar.
  const teste = new Image()
  teste.onload = () => {
    if (!teste.naturalWidth || teste.naturalWidth > 512 || teste.naturalHeight > 512) {
      return anotar(`foto de ${id.slice(0, 8)} recusada: ${teste.naturalWidth}x${teste.naturalHeight}`)
    }
    fotosPorId.set(id, imagem)
    redesenharAvatares(id)
  }
  teste.onerror = () => anotar(`foto de ${id.slice(0, 8)} recusada: nao abriu como imagem`)
  teste.src = imagem
}

// O avatar do card e criado uma vez so, com o card; a lista e a pilha sao
// redesenhadas inteiras.
function redesenharAvatares (id) {
  const card = cardDe(id)
  const antigo = card && card.querySelector('.selo .avatar')
  if (antigo) {
    const pessoa = quemEstaNaSala().find((p) => p.id === id)
    if (pessoa) antigo.replaceWith(criarAvatar(pessoa.nome, true, id))
  }
  desenharPessoas()
  desenharPerfil()
}

// --- aba Perfil ---------------------------------------------------------------

// A foto grande do topo da aba, com o nome de quem esta usando.
function desenharPerfil () {
  const lugar = $('#foto-atual')
  if (!lugar) return
  const nome = meuNome || $('#campo-nome').value || '?'
  lugar.textContent = ''
  lugar.appendChild(criarAvatar(nome, false, EU))
  const tem = Boolean(minhaFoto())
  $('#btn-remover-foto').classList.toggle('oculto', !tem)
  $('#btn-ajustar-foto').classList.toggle('oculto', !tem || !lembrar('liveon:foto-original'))
  $('#btn-escolher-foto').textContent = tem ? 'Trocar imagem' : 'Escolher imagem'
}

function avisarFoto (texto) {
  $('#aviso-foto').textContent = texto
}

// --- escolher e enquadrar -----------------------------------------------------

// O que esta sendo enquadrado: a imagem e o enquadramento (zoom e o centro,
// de 0 a 1 em cada eixo da imagem).
let recorte = null

async function escolherFoto (arquivo) {
  avisarFoto('')
  if (!arquivo) return
  if (!arquivo.type.startsWith('image/')) return avisarFoto('Esse arquivo não é uma imagem.')
  if (arquivo.size > ARQUIVO_MAXIMO) return avisarFoto('Imagem grande demais. O limite é 20 MB.')

  let bitmap
  try {
    bitmap = await createImageBitmap(arquivo)
  } catch {
    return avisarFoto('Não consegui abrir essa imagem.')
  }

  // Reduz ja na entrada: e isso que fica guardado para reenquadrar depois, e
  // e com ele que o enquadramento trabalha.
  const escala = Math.min(1, ORIGINAL_MAXIMO / Math.max(bitmap.width, bitmap.height))
  const tela = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * escala)), Math.max(1, Math.round(bitmap.height * escala)))
  tela.getContext('2d').drawImage(bitmap, 0, 0, tela.width, tela.height)
  bitmap.close()

  const original = await paraDataUrl(await tela.convertToBlob({ type: 'image/webp', quality: 0.85 }))
  abrirRecorte(original, { zoom: 1, x: 0.5, y: 0.5 })
}

function ajustarFotoAtual () {
  const original = lembrar('liveon:foto-original')
  if (!original) return
  let enquadre = { zoom: 1, x: 0.5, y: 0.5 }
  try { enquadre = { ...enquadre, ...JSON.parse(lembrar('liveon:foto-enquadre') || '{}') } } catch { /* padrao */ }
  abrirRecorte(original, enquadre)
}

function abrirRecorte (original, enquadre) {
  const imagem = new Image()
  imagem.onload = () => {
    recorte = { original, imagem, ...enquadre }
    $('#zoom-foto').value = String(recorte.zoom)
    $('#recorte-foto').classList.remove('oculto')
    desenharRecorte()
  }
  imagem.onerror = () => avisarFoto('Não consegui abrir essa imagem.')
  imagem.src = original
}

function fecharRecorte () {
  recorte = null
  $('#recorte-foto').classList.add('oculto')
}

// O pedaco da imagem que aparece na moldura: um quadrado, que nunca sai da
// imagem (sem faixa vazia na foto).
function areaDoRecorte () {
  const { imagem, zoom } = recorte
  const w = imagem.naturalWidth
  const h = imagem.naturalHeight
  const lado = Math.min(w, h) / zoom
  const cx = Math.min(Math.max(recorte.x * w, lado / 2), w - lado / 2)
  const cy = Math.min(Math.max(recorte.y * h, lado / 2), h - lado / 2)
  // Guarda o centro ja corrigido, senao arrastar alem da borda acumulava
  // distancia "invisivel" que precisaria ser desfeita.
  recorte.x = cx / w
  recorte.y = cy / h
  return { sx: cx - lado / 2, sy: cy - lado / 2, lado }
}

function desenharRecorte () {
  if (!recorte) return
  const { sx, sy, lado } = areaDoRecorte()
  const moldura = $('#canvas-recorte')
  const ctx = moldura.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(recorte.imagem, sx, sy, lado, lado, 0, 0, moldura.width, moldura.height)

  // As previas copiam a moldura: e exatamente o que vai sair.
  for (const previa of document.querySelectorAll('.previa-foto canvas')) {
    const p = previa.getContext('2d')
    p.imageSmoothingQuality = 'high'
    p.drawImage(moldura, 0, 0, previa.width, previa.height)
  }
}

function moverRecorte (dx, dy) {
  if (!recorte) return
  // Pixels da moldura para fracao da imagem.
  const { lado } = areaDoRecorte()
  const porPixel = lado / $('#canvas-recorte').clientWidth
  recorte.x -= (dx * porPixel) / recorte.imagem.naturalWidth
  recorte.y -= (dy * porPixel) / recorte.imagem.naturalHeight
  desenharRecorte()
}

function zoomRecorte (valor) {
  if (!recorte) return
  recorte.zoom = Math.min(ZOOM_MAXIMO, Math.max(1, valor))
  $('#zoom-foto').value = String(recorte.zoom)
  desenharRecorte()
}

async function salvarFoto () {
  if (!recorte) return
  const { sx, sy, lado } = areaDoRecorte()
  const tela = new OffscreenCanvas(FOTO_LADO, FOTO_LADO)
  const ctx = tela.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(recorte.imagem, sx, sy, lado, lado, 0, 0, FOTO_LADO, FOTO_LADO)

  // Baixa a qualidade ate caber. 0.85 quase sempre ja cabe.
  let blob = null
  for (const qualidade of [0.85, 0.75, 0.65, 0.5, 0.35, 0.2]) {
    blob = await tela.convertToBlob({ type: 'image/webp', quality: qualidade })
    if (blob.size <= FOTO_MAXIMA) break
  }
  if (!blob || blob.size > FOTO_MAXIMA) return avisarFoto('Não consegui deixar a imagem leve o bastante.')

  const foto = await paraDataUrl(blob)
  guardar('liveon:foto', foto)
  guardar('liveon:foto-original', recorte.original)
  guardar('liveon:foto-enquadre', JSON.stringify({ zoom: recorte.zoom, x: recorte.x, y: recorte.y }))
  anotar(`foto de perfil trocada: ${Math.round(blob.size / 1024)} KB`)
  fecharRecorte()
  enviarFotoParaTodos()
  redesenharAvatares(meuId)
}

function removerFoto () {
  guardar('liveon:foto', '')
  guardar('liveon:foto-original', '')
  guardar('liveon:foto-enquadre', '')
  fecharRecorte()
  avisarFoto('')
  enviarFotoParaTodos()
  redesenharAvatares(meuId)
}

function paraDataUrl (blob) {
  return new Promise((resolver, rejeitar) => {
    const leitor = new FileReader()
    leitor.onload = () => resolver(leitor.result)
    leitor.onerror = () => rejeitar(leitor.error)
    leitor.readAsDataURL(blob)
  })
}

// Arrastar a imagem na moldura, com mouse ou toque, e a roda do mouse para o
// zoom. O ponteiro fica preso a moldura enquanto arrasta, senao soltar fora
// dela deixava o arraste ligado.
function ligarRecorte () {
  const moldura = $('#canvas-recorte')
  let ultimo = null
  moldura.addEventListener('pointerdown', (evento) => {
    moldura.setPointerCapture(evento.pointerId)
    ultimo = { x: evento.clientX, y: evento.clientY }
  })
  moldura.addEventListener('pointermove', (evento) => {
    if (!ultimo) return
    moverRecorte(evento.clientX - ultimo.x, evento.clientY - ultimo.y)
    ultimo = { x: evento.clientX, y: evento.clientY }
  })
  const soltar = () => { ultimo = null }
  moldura.addEventListener('pointerup', soltar)
  moldura.addEventListener('pointercancel', soltar)
  moldura.addEventListener('wheel', (evento) => {
    evento.preventDefault()
    if (recorte) zoomRecorte(recorte.zoom * (evento.deltaY < 0 ? 1.08 : 1 / 1.08))
  }, { passive: false })
}
