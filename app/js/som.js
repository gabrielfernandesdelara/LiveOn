// Som: aviso de entrada, volume por pessoa e a saída de áudio.

'use strict'

// --- som de aviso ------------------------------------------------------------

// Gerado na hora com Web Audio: nao precisa de arquivo no pacote, e o volume
// fica sob controle. Dois toques curtos e baixos, presente sem assustar quem
// esta no meio de uma partida.
let contextoAviso = null

function tocarAviso () {
  try {
    if (!contextoAviso) contextoAviso = new AudioContext()
    if (contextoAviso.state === 'suspended') contextoAviso.resume()

    const agora = contextoAviso.currentTime

    for (const [atraso, frequencia] of [[0, 660], [0.13, 880]]) {
      const oscilador = contextoAviso.createOscillator()
      const ganho = contextoAviso.createGain()

      oscilador.type = 'sine'
      oscilador.frequency.value = frequencia

      // Sobe rapido e decai: sem estalo no inicio nem cauda arrastada.
      ganho.gain.setValueAtTime(0.0001, agora + atraso)
      ganho.gain.exponentialRampToValueAtTime(0.05, agora + atraso + 0.02)
      ganho.gain.exponentialRampToValueAtTime(0.0001, agora + atraso + 0.13)

      oscilador.connect(ganho).connect(contextoAviso.destination)
      oscilador.start(agora + atraso)
      oscilador.stop(agora + atraso + 0.15)
    }
  } catch {
    // Som e enfeite: nunca pode derrubar a sala.
  }
}

// Volume de uma pessoa, aplicado em todo lugar que o mostra: o video, a
// barrinha do card e o painel de ajustes, se estiver aberto naquela pessoa.
function aplicarVolume (id, nivel) {
  nivel = Math.max(0, Math.min(100, Math.round(nivel)))
  volumePorId.set(id, nivel)

  const card = cardDe(id)
  if (card) {
    const video = card.querySelector('video')
    if (video) {
      video.volume = nivel / 100
      // Se o autoplay tinha entrado mudo a forca, mexer no volume e gesto do
      // usuario, da para devolver o som.
      if (nivel > 0) delete video.dataset.mudoForcado
      video.muted = nivel === 0
    }

    const barra = card.querySelector('.volume')
    if (barra) {
      barra.value = String(nivel)
      barra.classList.toggle('mudo', nivel === 0)
    }

    const altoFalante = card.querySelector('.alto-falante')
    if (altoFalante) {
      trocarIcone(altoFalante, nivel === 0 ? 'mudo' : 'som')
      altoFalante.classList.toggle('mudo', nivel === 0)
      altoFalante.title = nivel === 0 ? 'Devolver o som' : 'Silenciar'
    }
  }

  if (ajustesAbertos === id) {
    $('#ajustes-volume').value = String(nivel)
    $('#ajustes-nivel').textContent = nivel + '%'
  }
}

function volumeDe (id) {
  return volumePorId.has(id) ? volumePorId.get(id) : 100
}

// O volume era o unico ajuste que nao deixava rastro: quando alguem dizia que
// "o 0% nao mutou", nao dava para saber se o app tinha feito a parte dele.
// Escreve no fim do gesto (change, nao input), senao um arraste so viraria
// cem linhas de log.
function registrarVolume (id) {
  const pessoa = participantes.get(id)
  const nome = pessoa ? pessoa.nome : id.slice(0, 8)
  const card = cardDe(id)
  const video = card ? card.querySelector('video') : null
  anotar(video
    ? `volume de ${nome}: ${volumeDe(id)}% (video vol=${video.volume} mudo=${video.muted})`
    : `volume de ${nome}: ${volumeDe(id)}% (sem card na tela)`)
}

// Clicar no alto-falante silencia e devolve o nivel anterior.
function alternarMudo (id) {
  const atual = volumeDe(id)
  if (atual > 0) {
    volumeAntesDeMudo.set(id, atual)
    aplicarVolume(id, 0)
  } else {
    aplicarVolume(id, volumeAntesDeMudo.get(id) || 100)
  }
  registrarVolume(id)
}

// ---- saída de áudio ----
//
// Quem tem headset e caixa de som ao mesmo tempo (ou algo como o NVIDIA
// Broadcast no meio do caminho) nem sempre quer o LiveOn tocando onde o
// Windows manda. O setSinkId vale por elemento de vídeo, então a escolha é
// aplicada em todos os cards, nos que existem e nos que nascerem depois.
let saidaEscolhida = lembrar('liveon:saida', '')

async function aplicarSaidaEm (video) {
  if (!video || typeof video.setSinkId !== 'function') return

  const alvo = saidaEscolhida || 'default'
  if ((video.sinkId || 'default') === alvo) return

  try {
    await video.setSinkId(alvo)
  } catch (erro) {
    // O aparelho sumiu de verdade (headset desconectado): aí a escolha
    // guardada não vale mais para card nenhum, e a padrão volta a valer.
    if (erro.name === 'NotFoundError') {
      anotar(`saida de audio sumiu (${erro.name}), voltando para a padrao`)
      saidaEscolhida = ''
      guardar('liveon:saida', '')
      try { await video.setSinkId('default') } catch { /* nao da para insistir */ }
      return
    }

    // Qualquer outro erro NÃO pode apagar a escolha. O caso comum é o
    // AbortError de um card que ainda não tem trilha de áudio nenhuma: medido
    // dentro do Electron, stream só de vídeo recusa e stream com áudio aceita.
    // Não há som para sair no lugar errado, e quem tenta de novo é o
    // aplicarVideo, quando o áudio daquela pessoa chegar.
    anotar(`saida de audio adiada num card: ${erro.name}`)
  }
}

function aplicarSaidaEmTodos () {
  for (const video of document.querySelectorAll('.palco video')) aplicarSaidaEm(video)
}

// Medido dentro do Electron: os nomes vem completos, sem precisar de permissao
// de microfone. Num navegador puro eles viriam vazios.
async function listarSaidas () {
  try {
    const todos = await navigator.mediaDevices.enumerateDevices()
    return todos.filter((d) => d.kind === 'audiooutput')
  } catch (erro) {
    anotar(`nao consegui listar as saidas: ${erro.message}`)
    return []
  }
}

async function abrirSaida () {
  const campo = $('#campo-saida')
  campo.textContent = ''

  const padrao = document.createElement('option')
  padrao.value = ''
  padrao.textContent = 'Padrão do Windows'
  campo.appendChild(padrao)

  for (const aparelho of await listarSaidas()) {
    // "default" e "communications" sao apelidos de aparelhos que ja estao na
    // lista com o nome de verdade; mostrar os tres so confunde.
    if (aparelho.deviceId === 'default' || aparelho.deviceId === 'communications') continue

    const item = document.createElement('option')
    item.value = aparelho.deviceId
    item.textContent = aparelho.label || 'Saída sem nome'
    campo.appendChild(item)
  }

  // A escolha guardada pode ter sumido junto com o aparelho.
  campo.value = [...campo.options].some((o) => o.value === saidaEscolhida) ? saidaEscolhida : ''

  $('#saida-quem').textContent = meuNome
  $('#saida').classList.remove('oculto')
}
