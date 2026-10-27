// Seletor de fontes, com grade própria (useSystemPicker: false), nos modos
// iniciar e ajustar.

'use strict'

let fontesCarregadas = []

let abaAtual = 'tela'

let fonteEscolhida = null

// O que esta no ar AGORA, para o seletor abrir mostrando a verdade quando ele
// e usado para ajustar, e para o ajuste saber se a fonte mudou ou se so a
// qualidade mudou.
let fonteAtual = null

let audioAtual = null

let modoDoSeletor = 'iniciar'   // 'iniciar' | 'ajustar'

// Estado do addon nativo e dos aplicativos que estao tocando som agora.
let addonAudio = { ok: false, motivo: 'verificando...' }

let sessoesDeAudio = []

// O mesmo seletor serve para comecar e para ajustar. Sao a mesma pergunta
// (que tela, que qualidade, que audio), e ter duas telas separadas para isso
// seria duas telas para manter em pe.
async function abrirSeletor (modo = 'iniciar') {
  modoDoSeletor = modo
  const ajustando = modo === 'ajustar'

  // Ajustando, ele abre mostrando o que ESTA no ar, e nao a ultima coisa que
  // foi clicada: quem veio ajustar quer mudar uma coisa, nao recomecar.
  fonteEscolhida = ajustando ? fonteAtual : null

  $('#titulo-seletor').textContent = ajustando
    ? 'Ajustar transmissão'
    : 'O que você quer compartilhar?'
  $('#btn-confirmar-fonte').textContent = ajustando ? 'Aplicar' : 'Transmitir'
  $('#btn-confirmar-fonte').disabled = !fonteEscolhida

  if (ajustando) {
    $('#campo-resolucao').value = String(qualidadeLocal.altura)
    $('#campo-fps').value = String(qualidadeLocal.fps)
    abaAtual = String(fonteAtual || '').startsWith('window:') ? 'janela' : 'tela'
    for (const aba of document.querySelectorAll('.aba')) {
      aba.classList.toggle('ativa', aba.dataset.aba === abaAtual)
    }
  }

  $('#seletor').classList.remove('oculto')

  atualizarAvisoDeQualidade()
  addonAudio = await window.ponte.audioDisponivel()
  sessoesDeAudio = addonAudio.ok ? await window.ponte.audioSessoes() : []
  desenharAplicativosDeAudio()
  atualizarOpcoesDeAudio()

  // So agora da para escolher o modo de audio: antes disto as opcoes ainda
  // nao existiam no select.
  if (ajustando && audioAtual) {
    const campo = $('#campo-audio-modo')
    if ([...campo.options].some((o) => o.value === audioAtual.modo)) {
      campo.value = audioAtual.modo
    }
    if (audioAtual.pid) $('#campo-audio-app').value = String(audioAtual.pid)
    atualizarOpcoesDeAudio()
  }

  await carregarFontes()
}

function desenharAplicativosDeAudio () {
  const alvo = $('#campo-audio-app')
  alvo.textContent = ''

  if (sessoesDeAudio.length === 0) {
    const vazio = document.createElement('option')
    vazio.textContent = 'nenhum app tocando som'
    vazio.value = ''
    alvo.appendChild(vazio)
    return
  }

  // Quem esta tocando som agora aparece primeiro.
  const ordenadas = [...sessoesDeAudio].sort(
    (a, b) => Number(b.tocando) - Number(a.tocando)
  )

  for (const app of ordenadas) {
    const item = document.createElement('option')
    item.value = String(app.pid)
    item.textContent = app.nome + (app.tocando ? ' (tocando)' : '')
    item.title = (app.dispositivos || []).join(' | ')
    alvo.appendChild(item)
  }

  // Discord ja vem marcado: e o caso de uso que motivou tudo isso.
  const discord = ordenadas.find((a) => /discord/i.test(a.nome))
  if (discord) alvo.value = String(discord.pid)
}

// Descobre se o aplicativo escolhido NAO entrega audio direto na saida padrao.
//
// Caso real: com o NVIDIA Broadcast instalado, o Discord toca num dispositivo
// virtual e quem re-emite no fone e o NVIDIA Broadcast.exe. Excluir o Discord
// nao corta nada, porque na saida quem esta tocando e outro processo.
function detectarRepasse (pid) {
  const escolhido = sessoesDeAudio.find((a) => a.pid === pid)
  if (!escolhido) return null

  const dispositivos = escolhido.dispositivos || []
  const saiNoPadrao = dispositivos.some((d) => d.includes('[console'))
  if (saiNoPadrao) return null

  // Quem esta tocando no dispositivo padrao e o provavel repassador.
  const repassador = sessoesDeAudio.find((a) =>
    a.pid !== pid &&
    a.tocando &&
    (a.dispositivos || []).some((d) => d.includes('[console'))
  )

  return {
    dispositivo: (dispositivos[0] || 'outro dispositivo').replace(/ \[.*\]$/, ''),
    repassador: repassador ? repassador.nome : null
  }
}

// A lista de modos depende do que esta sendo compartilhado. "Apenas esta
// janela" nao existe para um monitor, e "tudo menos um aplicativo" nao faz
// sentido para uma janela, entao cada aba oferece so o que se aplica.
function modosDeAudioDaAba () {
  // Os dois modos uteis dependem do addon compilado. Sem ele sobraria apenas
  // "Sem audio", ou seja: nenhuma forma de mandar som. O loopback comum entra
  // como reserva SO nesse caso.
  if (!addonAudio.ok) {
    return [['tudo', 'Todo o áudio do sistema'], ['nenhum', 'Sem áudio']]
  }

  return abaAtual === 'janela'
    ? [['so-janela', 'Apenas o áudio da janela'], ['nenhum', 'Sem áudio']]
    : [['sem-app', 'Tudo, menos o app selecionado'], ['nenhum', 'Sem áudio']]
}

function atualizarOpcoesDeAudio () {
  const seletorModo = $('#campo-audio-modo')
  const modos = modosDeAudioDaAba()
  const escolhaAnterior = seletorModo.value

  // Remonta so quando a lista realmente mudou, senao o select pisca e perde a
  // escolha do usuario a cada mexida no aviso.
  const atuais = [...seletorModo.options].map((o) => o.value).join(',')
  if (atuais !== modos.map(([v]) => v).join(',')) {
    seletorModo.textContent = ''
    for (const [valor, rotulo] of modos) {
      const item = document.createElement('option')
      item.value = valor
      item.textContent = rotulo
      seletorModo.appendChild(item)
    }
    // Mantem a escolha se ela sobreviveu a troca de aba; senao, a primeira.
    seletorModo.value = modos.some(([v]) => v === escolhaAnterior)
      ? escolhaAnterior
      : modos[0][0]
  }

  const modoAudio = seletorModo.value
  $('#caixa-audio-app').classList.toggle('oculto', modoAudio !== 'sem-app')

  const avisos = {
    tudo: 'Captura tudo, inclusive a voz dos seus amigos no Discord, que volta para eles em eco.',
    'sem-app': 'Captura o sistema todo, menos o aplicativo escolhido ao lado.',
    'so-janela': 'Captura só o som do programa dono desta janela.',
    nenhum: 'Compartilha só a imagem.'
  }

  let aviso = avisos[modoAudio] || ''
  if (!addonAudio.ok) {
    aviso += ' Os modos por aplicativo precisam do addon nativo: ' + addonAudio.motivo
  }

  const caixaAviso = $('#aviso-audio')

  // So o alerta aparece na tela (o CSS esconde o resto). "Todo o audio" e
  // alerta por natureza: e o modo em que a voz dos amigos volta em eco.
  caixaAviso.classList.toggle('alerta', modoAudio === 'tudo')

  if (modoAudio === 'sem-app') {
    const repasse = detectarRepasse(Number($('#campo-audio-app').value))
    if (repasse) {
      aviso = `Atenção: esse app toca em "${repasse.dispositivo}", que não é a sua saída padrão. ` +
        (repasse.repassador
          ? `Quem entrega o som é o ${repasse.repassador}. Exclua ele, senão o áudio continua passando.`
          : 'Outro programa repassa esse som, então excluir só este app pode não adiantar.')
      caixaAviso.classList.add('alerta')
    }
  }

  caixaAviso.textContent = aviso
}

// Resolucao e taxa de quadros escolhidas para a transmissao.
function configuracaoDeVideo () {
  const altura = Number($('#campo-resolucao').value) || 720
  const fps = Number($('#campo-fps').value) || 30

  return { altura, largura: Math.round(altura * PROPORCAO), fps, bitrate: bitrateDe(altura, fps) }
}

// Em malha quem transmite manda uma copia para cada amigo, entao o upload
// multiplica. Sem ninguem para assistir, nao ha o que avisar.
function atualizarAvisoDeQualidade () {
  const { bitrate } = configuracaoDeVideo()
  const amigos = participantes.size
  if (amigos === 0) {
    $('#aviso-qualidade').textContent = ''
    return
  }

  const total = (bitrate * amigos / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
  $('#aviso-qualidade').textContent =
    `Para ${amigos} ${amigos === 1 ? 'amigo' : 'amigos'}: ~${total} Mbps de upload. Cada um recebe a própria cópia.`
}

// Monta o que a transmissao precisa saber sobre audio.
async function configuracaoDeAudio () {
  const modoAudio = $('#campo-audio-modo').value

  if (modoAudio === 'so-janela') {
    const pid = await window.ponte.audioPidDaFonte(fonteEscolhida)
    if (!pid) throw new Error('nao consegui descobrir o processo dono desta janela')
    return { modo: 'so-janela', pid }
  }

  if (modoAudio === 'sem-app') {
    const pid = Number($('#campo-audio-app').value)
    if (!pid) throw new Error('escolha qual aplicativo excluir')
    return { modo: 'sem-app', pid }
  }

  return { modo: modoAudio }
}

async function carregarFontes () {
  $('#fontes').textContent = 'Procurando telas e janelas...'
  try {
    fontesCarregadas = await window.ponte.listarFontes()
  } catch (erro) {
    avisar('Falha ao listar as fontes: ' + erro.message)
    fontesCarregadas = []
  }
  desenharFontes()
}

function desenharFontes () {
  const alvo = $('#fontes')
  const lista = fontesCarregadas.filter((f) => (abaAtual === 'tela' ? f.tela : !f.tela))
  alvo.textContent = ''

  if (lista.length === 0) {
    alvo.textContent = 'Nada encontrado aqui.'
    return
  }

  for (const fonte of lista) {
    const item = document.createElement('div')
    item.className = 'fonte' + (fonte.id === fonteEscolhida ? ' escolhida' : '')

    const previa = document.createElement('img')
    previa.className = 'previa'
    previa.src = fonte.miniatura

    const rotulo = document.createElement('div')
    rotulo.className = 'rotulo'
    if (fonte.icone) {
      const ico = document.createElement('img')
      ico.src = fonte.icone
      rotulo.appendChild(ico)
    } else {
      rotulo.appendChild(icone('janela', 14))
    }
    const texto = document.createElement('span')
    texto.textContent = fonte.nome
    texto.title = fonte.nome
    rotulo.appendChild(texto)

    item.append(previa, rotulo)
    // O clique so troca a marca de lugar, sem redesenhar a grade: redesenhar
    // trocava o elemento debaixo do mouse entre os dois cliques, e o duplo
    // clique nao chegava a acontecer.
    item.onclick = () => {
      fonteEscolhida = fonte.id
      $('#btn-confirmar-fonte').disabled = false
      for (const outro of alvo.querySelectorAll('.fonte')) outro.classList.toggle('escolhida', outro === item)
      // "Apenas o audio desta janela" so vale quando ha uma janela escolhida.
      atualizarOpcoesDeAudio()
    }
    // Duplo clique e escolher e confirmar de uma vez, pelo mesmo caminho do
    // botao.
    item.ondblclick = () => {
      fonteEscolhida = fonte.id
      $('#btn-confirmar-fonte').click()
    }
    alvo.appendChild(item)
  }
}
