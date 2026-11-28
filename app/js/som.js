// Som: aviso de entrada, volume por pessoa e a saída de áudio.

'use strict'

// --- som de aviso ------------------------------------------------------------

// A assinatura sonora do LiveOn (1.6.1, escolhida pelo dono entre varias
// ideias): o "Pop duplo Elastico". Dois pops que passam do tom e voltam,
// como uma mola, subindo quando alguem ENTRA no ar com a tela e descendo, o
// espelho, quando SAI. Vem em par de proposito: e o par que faz o grupo
// reconhecer o que aconteceu sem olhar para a tela.
//
// Gerado na hora com Web Audio: nao precisa de arquivo no pacote, e o volume
// fica sob controle, baixo, para nao assustar quem esta no meio de uma
// partida. Nao e copia do som de nenhum outro app.
let contextoAviso = null

function contextoDeAviso () {
  if (!contextoAviso) contextoAviso = new AudioContext()
  if (contextoAviso.state === 'suspended') contextoAviso.resume()
  return contextoAviso
}

// Um pop: um triangulo que sai de longe do tom, passa dele e assenta, com um
// grave curto embaixo para dar corpo. `sobe` decide de que lado ele vem.
function popElastico (c, alvo, t, sobe) {
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = 'triangle'
  o.frequency.setValueAtTime(sobe ? alvo * 0.6 : alvo * 1.5, t)
  o.frequency.exponentialRampToValueAtTime(sobe ? alvo * 1.25 : alvo * 0.8, t + 0.05)
  o.frequency.exponentialRampToValueAtTime(alvo, t + 0.12)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.04, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
  o.connect(g).connect(c.destination)
  o.start(t)
  o.stop(t + 0.2)

  const grave = c.createOscillator()
  const gg = c.createGain()
  grave.type = 'sine'
  grave.frequency.setValueAtTime(alvo * 0.28, t)
  grave.frequency.exponentialRampToValueAtTime(alvo * 0.14, t + 0.14)
  gg.gain.setValueAtTime(0.0001, t)
  gg.gain.exponentialRampToValueAtTime(0.022, t + 0.01)
  gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.14)
  grave.connect(gg).connect(c.destination)
  grave.start(t)
  grave.stop(t + 0.19)
}

// Alguem entrou no ar com a tela.
function tocarAviso () {
  try {
    const c = contextoDeAviso()
    const t = c.currentTime + 0.01
    popElastico(c, 900, t, true)
    popElastico(c, 1500, t + 0.15, true)
  } catch {
    // Som e enfeite: nunca pode derrubar a sala.
  }
}

// Alguem saiu do ar: o mesmo desenho, descendo.
function tocarSaida () {
  try {
    const c = contextoDeAviso()
    const t = c.currentTime + 0.01
    popElastico(c, 1500, t, false)
    popElastico(c, 900, t + 0.15, false)
  } catch {
    // Som e enfeite: nunca pode derrubar a sala.
  }
}
// Entrar e sair da SALA (1.6.2, escolhido pelo dono): a "Bolha", um bloop
// curto que sobe ao entrar e desce ao sair. Mais discreto que o da tela,
// porque acontece mais vezes.
function bolha (de, para) {
  try {
    const c = contextoDeAviso()
    const t = c.currentTime + 0.01
    const o = c.createOscillator()
    const g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(de, t)
    o.frequency.exponentialRampToValueAtTime(para, t + 0.112)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.045, t + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16)
    o.connect(g).connect(c.destination)
    o.start(t)
    o.stop(t + 0.21)
  } catch {
    // Som e enfeite: nunca pode derrubar a sala.
  }
}

// Pedido para entrar (2.1.0): a "campainha elastica de metal", escolhida
// pelo dono (C1) entre umas vinte. Ding-dong descendo (880 e 698 Hz), cada
// nota passando do tom e voltando como o pop do LiveOn, mas com timbre de
// sino de verdade (FM, modulador a 3,5x): o pop e a bolha sao triangulo e
// senoide, e o pedido precisava soar diferente deles. ~1,2 s, pico ~0,04.
function sinoElastico (c, f, t, dur, vol = 0.04) {
  const curva = (p, alvo) => {
    p.setValueAtTime(alvo * 0.7, t)
    p.exponentialRampToValueAtTime(alvo * 1.12, t + 0.045)
    p.exponentialRampToValueAtTime(alvo, t + 0.11)
  }
  const portadora = c.createOscillator()
  const modulador = c.createOscillator()
  const profundidade = c.createGain()
  const g = c.createGain()
  curva(portadora.frequency, f)
  curva(modulador.frequency, f * 3.5)
  profundidade.gain.setValueAtTime(f * 1.6, t)
  profundidade.gain.exponentialRampToValueAtTime(f * 0.05, t + dur)
  modulador.connect(profundidade).connect(portadora.frequency)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  portadora.connect(g).connect(c.destination)
  portadora.start(t)
  modulador.start(t)
  portadora.stop(t + dur + 0.05)
  modulador.stop(t + dur + 0.05)
}

function tocarPedidoDeEntrada () {
  tocarSom((c, t) => {
    sinoElastico(c, 880, t, 0.7)
    sinoElastico(c, 698, t + 0.26, 0.9)
  })
}

// --- a linguagem dos sons (2.1.0, escolhida pelo dono) ------------------------
//
// Para o grupo saber o que aconteceu sem olhar, cada som segue tres regras:
// - o TIMBRE diz o assunto: pop e ir ao ar, bolha e gente na sala, sino e
//   amigos e pedidos, madeira e decisao da sala, vidro e a conexao;
// - a DIRECAO diz o que houve: subindo chegou ou ligou, descendo saiu ou
//   caiu;
// - o NUMERO de notas diz a importancia: uma informa, duas pedem atencao,
//   tres pedem uma acao sua.
// Todos com o "estica e volta" do pop, que e a marca do LiveOn. A webcam usa
// o mesmo som da tela (tocarAviso e tocarSaida), e amigo ficando online nao
// tem som: as duas coisas a pedido do dono.

function tocarSom (desenhar) {
  try {
    const c = contextoDeAviso()
    desenhar(c, c.currentTime + 0.01)
  } catch {
    // Som e enfeite: nunca pode atrapalhar o que aconteceu.
  }
}

// A curva da marca: comeca fora da nota, passa dela e se acomoda. Descendo,
// comeca acima.
function curvaElastica (p, f, t, sobe = true) {
  p.setValueAtTime(sobe ? f * 0.7 : f * 1.4, t)
  p.exponentialRampToValueAtTime(sobe ? f * 1.12 : f * 0.9, t + 0.045)
  p.exponentialRampToValueAtTime(f, t + 0.11)
}

function envelope (c, t, pico, ataque, fim) {
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(pico, t + ataque)
  g.gain.exponentialRampToValueAtTime(0.0001, t + fim)
  g.connect(c.destination)
  return g
}

// MADEIRA: nota seca, com um brilho curto em cima (marimba).
function madeira (c, f, t, vol = 0.06, sobe = true) {
  const o = c.createOscillator()
  curvaElastica(o.frequency, f, t, sobe)
  o.connect(envelope(c, t, vol, 0.003, 0.2))
  o.start(t)
  o.stop(t + 0.25)
  const brilho = c.createOscillator()
  curvaElastica(brilho.frequency, f * 3.9, t, sobe)
  brilho.connect(envelope(c, t, vol * 0.25, 0.002, 0.05))
  brilho.start(t)
  brilho.stop(t + 0.08)
}

// VIDRO: senoide com o parcial de 2,76 (copo batido).
function vidro (c, f, t, dur = 0.45, vol = 0.045, sobe = true) {
  const o = c.createOscillator()
  curvaElastica(o.frequency, f, t, sobe)
  o.connect(envelope(c, t, vol, 0.004, dur))
  o.start(t)
  o.stop(t + dur + 0.05)
  const parcial = c.createOscillator()
  curvaElastica(parcial.frequency, f * 2.76, t, sobe)
  parcial.connect(envelope(c, t, vol * 0.35, 0.003, dur * 0.4))
  parcial.start(t)
  parcial.stop(t + dur)
}

// Sino: te chamaram (3 notas subindo, pede acao), pedido aceito (1 nota alta),
// pedido de amizade (2 iguais, como bater a porta).
function tocarConvite () {
  tocarSom((c, t) => {
    sinoElastico(c, 698, t, 0.5)
    sinoElastico(c, 880, t + 0.17, 0.55)
    sinoElastico(c, 1046, t + 0.34, 0.9)
  })
}
function tocarPedidoAceito () { tocarSom((c, t) => sinoElastico(c, 1318, t, 0.8, 0.035)) }
function tocarPedidoDeAmizade () {
  tocarSom((c, t) => {
    sinoElastico(c, 988, t, 0.3, 0.03)
    sinoElastico(c, 988, t + 0.13, 0.55, 0.03)
  })
}

// Madeira: votacao (2 batidas iguais), alguem tirado (3 descendo) e tiraram
// voce (as mesmas, mais graves e lentas).
function tocarVotacao () {
  tocarSom((c, t) => {
    madeira(c, 700, t)
    madeira(c, 700, t + 0.15)
  })
}
function tocarAlguemTirado () {
  tocarSom((c, t) => {
    madeira(c, 784, t, 0.055, false)
    madeira(c, 587, t + 0.11, 0.055, false)
    madeira(c, 392, t + 0.22, 0.065, false)
  })
}
function tocarTiraramVoce () {
  tocarSom((c, t) => {
    madeira(c, 523, t, 0.06, false)
    madeira(c, 392, t + 0.17, 0.06, false)
    madeira(c, 262, t + 0.34, 0.07, false)
  })
}

// Vidro: a conexao caiu (2 descendo), voltou (2 subindo), copiado (1 toque).
function tocarConexaoCaiu () {
  tocarSom((c, t) => {
    vidro(c, 1318, t, 0.35, 0.04, false)
    vidro(c, 988, t + 0.18, 0.55, 0.04, false)
  })
}
function tocarReconectado () {
  tocarSom((c, t) => {
    vidro(c, 988, t, 0.35)
    vidro(c, 1318, t + 0.18, 0.55)
  })
}
function tocarCopiado () { tocarSom((c, t) => vidro(c, 1760, t, 0.12, 0.02)) }

function tocarEntrouNaSala () { bolha(420, 1000) }
function tocarSaiuDaSala () { bolha(1000, 420) }

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
      // Esperando o clique para assistir, fica mudo seja qual for o volume.
      video.muted = nivel === 0 || card.classList.contains('aguardando')
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
  for (const video of document.querySelectorAll('.palco > video')) aplicarSaidaEm(video)
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

// Abre as configuracoes ja na aba Audio, onde a escolha mora desde a 1.6.0.
// (A engrenagem da lista de pessoas que chamava isto saiu na 2.1.0.)
function abrirSaida () {
  abrirConfig('audio')
}

// Monta a lista de aparelhos da aba Audio. Roda ao abrir a aba e quando um
// aparelho entra ou sai (headset conectado no meio da sala).
async function preencherSaidas () {
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
}
