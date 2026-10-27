// Processo principal: janela, seletor de fontes por IPC e o handler de
// getDisplayMedia, que é onde o áudio do sistema entra (audio: 'loopback').

const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, session, shell } = require('electron')
const path = require('node:path')
const os = require('node:os')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

// --- quem pode falar com o processo principal ---------------------------------
//
// Só a página do próprio app. Se a janela um dia fosse levada para um site de
// fora (um link, um arrastar e soltar), o preload iria junto e o site herdaria
// a ponte inteira: miniatura de toda janela aberta, captura de tela e de áudio
// sem pedir nada. Medido no app real antes destas travas: em example.com,
// window.ponte tinha as 18 funções e o processo principal respondia.
//
// São três travas, e cada uma segura sozinha: a janela não navega
// (criarJanela), o IPC confere quem chamou (apenasDoApp) e a captura e as
// permissões conferem a origem (configurarCaptura).
const PAGINA = pathToFileURL(path.join(__dirname, 'index.html')).href

function ehDoApp (url) {
  return typeof url === 'string' && url.split(/[?#]/)[0] === PAGINA
}

// Endereço para o registro sem o resto da URL, que pode carregar token.
function origemDe (url) {
  try { return new URL(url).origin } catch { return '?' }
}

// Nenhuma janela sai da página do app: nem por link, nem por arrastar e
// soltar, nem por redirecionamento. Vale para todo conteúdo que nascer, e não
// só para a janela principal, para não depender de lembrar disto numa janela
// nova.
function ficarNoApp (evento, url) {
  const destino = evento.url || url
  if (ehDoApp(destino)) return
  evento.preventDefault()
  registrar('seguranca', `navegacao barrada para ${origemDe(destino)}`)
}

app.on('web-contents-created', (_evento, conteudo) => {
  conteudo.on('will-navigate', ficarNoApp)
  conteudo.on('will-redirect', ficarNoApp)
})

const recusados = new Set()

// Envelope de todo handler de IPC. Quem não é a página do app recebe
// undefined, sem exceção: exceção num ipcMain.on vira diálogo de erro no
// processo principal. O registro anota cada origem uma vez só, senão uma
// página hostil enchia o arquivo chamando em laço.
function apenasDoApp (tratar) {
  return (evento, ...args) => {
    const url = evento.senderFrame ? evento.senderFrame.url : ''
    if (ehDoApp(url)) return tratar(evento, ...args)

    const origem = origemDe(url)
    if (!recusados.has(origem)) {
      recusados.add(origem)
      registrar('seguranca', `IPC recusado, veio de ${origem}`)
    }
    return undefined
  }
}

// --- registro em arquivo ------------------------------------------------------
//
// Existe porque bug que só aparece com dois participantes de verdade não dá
// para depurar olhando o terminal: no app empacotado não há terminal nenhum.

let arquivoLog = null

function iniciarLog () {
  arquivoLog = path.join(app.getPath('userData'), 'liveon.log')

  // Guarda a sessão anterior antes de truncar. Bug que só aparece com dois
  // participantes costuma ser contado DEPOIS que o app já reabriu, e sem isto
  // o registro daquela sessão já teria sido perdido.
  try {
    if (fs.existsSync(arquivoLog)) {
      fs.copyFileSync(arquivoLog, path.join(app.getPath('userData'), 'liveon-anterior.log'))
    }
  } catch { /* sem histórico é melhor que não abrir */ }

  try {
    fs.writeFileSync(
      arquivoLog,
      `--- LiveOn ${app.getVersion()} | ${new Date().toISOString()} | ${os.release()} ---\n` +
      // O próprio caminho na primeira linha: já perdi tempo procurando qual
      // instalação tinha escrito qual arquivo.
      `--- registro em ${arquivoLog} | empacotado: ${app.isPackaged} ---\n`
    )
  } catch { /* sem log é melhor que não abrir */ }
}

function registrar (origem, texto) {
  const linha = `${new Date().toISOString()} [${origem}] ${texto}\n`
  try { process.stdout.write(linha) } catch { /* sem console no empacotado */ }
  try { if (arquivoLog) fs.appendFileSync(arquivoLog, linha) } catch { /* disco cheio */ }
}

function vigiarJanela (alvo) {
  const conteudo = alvo.webContents

  conteudo.on('render-process-gone', (_evento, detalhes) => {
    registrar('CRASH', `renderer morreu: ${detalhes.reason} (código ${detalhes.exitCode})`)
  })
  conteudo.on('unresponsive', () => registrar('CRASH', 'janela parou de responder'))
  conteudo.on('responsive', () => registrar('CRASH', 'janela voltou a responder'))

  // A assinatura mudou entre versões do Electron; aceita as duas.
  conteudo.on('console-message', (...args) => {
    const primeiro = args[0]
    if (primeiro && typeof primeiro === 'object' && 'message' in primeiro) {
      if (primeiro.level === 'error' || primeiro.level === 'warning') {
        registrar('renderer', `${primeiro.level}: ${primeiro.message}`)
      }
      return
    }
    const [, nivel, mensagem, linha, fonte] = args
    if (nivel >= 2) registrar('renderer', `${mensagem} (${fonte}:${linha})`)
  })
}

ipcMain.on('log:registrar', apenasDoApp((_evento, texto) => registrar('app', String(texto).slice(0, 2000))))
ipcMain.handle('log:caminho', apenasDoApp(() => arquivoLog))

ipcMain.handle('janela:telaCheia', apenasDoApp((_evento, ligar) => {
  if (!janela) return false
  janela.setFullScreen(Boolean(ligar))
  return janela.isFullScreen()
}))

// Clipboard pelo processo principal. O navigator.clipboard do renderer falha
// sob file:// quando a janela nao esta com o foco, era o "botao bugado".
ipcMain.handle('copiar', apenasDoApp((_evento, texto) => {
  clipboard.writeText(String(texto))
  return clipboard.readText() === String(texto)
}))

// A ponte expunha 'ambiente' e ninguem respondia do lado de ca: a chamada
// rejeitava, a pilula de versao ficava vazia (um quadradinho solto na barra)
// e o await derrubava calado todo o resto da abertura do app.
ipcMain.handle('ambiente', apenasDoApp(() => ({
  versao: app.getVersion(),
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  // Da 39 em diante o loopback de audio e nativo; antes disso, nao existe.
  loopbackNativo: Number(String(process.versions.electron).split('.')[0]) >= 39
})))

// Da Electron 39 em diante o loopback é nativo: NÃO é preciso nenhuma
// command-line switch nem a lib electron-audio-loopback. Se o áudio vier mudo,
// conferir a versão aqui antes de mexer em qualquer outra coisa.
const VERSAO_MINIMA = 39
const versaoElectron = Number(process.versions.electron.split('.')[0])

let janela = null

// --- prioridade e segundo plano -----------------------------------------------
//
// Jogo em tela cheia disputa CPU com o app, e quem perde a disputa é a
// transmissão: ela engasga do lado de quem assiste. Foi medido na mão, pondo
// o LiveOn em tempo real no gerenciador de tarefas, e parou de travar.
//
// São dois freios diferentes, e os dois precisam sair:
//
// 1. O Chromium REBAIXA sozinho o processo de uma janela coberta ou
//    minimizada, justamente a situação normal de quem compartilha a tela
//    enquanto joga. Os switches abaixo desligam esse rebaixamento. O
//    `backgroundThrottling: false` da janela é parente disto, mas cuida só dos
//    timers; estes cuidam da prioridade do processo.
// 2. O Windows reparte CPU por classe de prioridade, e o app nasce em normal,
//    a mesma do jogo.
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')

// ALTA, e não tempo real. Medido nesta máquina: sem ser administrador o
// Windows aceita o pedido de tempo real e devolve ALTA do mesmo jeito, então
// pedir mais seria mentira. E é bom que seja assim: tempo real passa na frente
// do driver de áudio e engasga o som e o mouse do sistema inteiro. ALTA já
// passa na frente do jogo, que roda em normal.
function priorizar (motivo) {
  const processos = app.getAppMetrics()
  let subiram = 0
  const falhas = []

  for (const { pid, type } of processos) {
    try {
      os.setPriority(pid, os.constants.priority.PRIORITY_HIGH)
      subiram++
    } catch (erro) {
      // Processo pode ter morrido entre listar e ajustar. Não é motivo para
      // derrubar nada: o app funciona igual, só disputa CPU em pé de igualdade.
      falhas.push(`${type}/${pid}: ${erro.message}`)
    }
  }

  registrar('app', `prioridade ALTA em ${subiram}/${processos.length} processos (${motivo})` +
    (falhas.length ? `, falhou em ${falhas.join('; ')}` : ''))
}

// A escolha da fonte acontece na nossa própria UI (grade de miniaturas), então
// o renderer avisa aqui o que foi escolhido e só depois chama getDisplayMedia.
// Este objeto é o bilhete que liga uma coisa à outra.
let pedidoPendente = null

function criarJanela () {
  janela = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 940,
    minHeight: 620,
    backgroundColor: '#0e1013',
    title: 'LiveOn',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // O Chromium estrangula os timers de janela escondida ou coberta: passa
      // a rodar um por minuto. A batida de coracao da sala sai de um
      // setInterval de 10s, e o servidor derruba quem fica 45s calado. Num
      // app de compartilhar tela, ficar coberto por um jogo em tela cheia e a
      // situacao NORMAL, entao o estrangulamento derrubaria justamente quem
      // esta usando o app do jeito certo.
      backgroundThrottling: false
    }
  })

  vigiarJanela(janela)
  janela.loadFile(path.join(__dirname, 'index.html'))

  // A janela pode sair da tela cheia por fora do app (F11, Esc do sistema).
  // Avisar o renderer mantem a interface em sincronia com a realidade.
  janela.on('enter-full-screen', () => janela.webContents.send('janela:telaCheia', true))
  janela.on('leave-full-screen', () => janela.webContents.send('janela:telaCheia', false))

  // Nada de janelas novas: links externos vão para o navegador do sistema.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  janela.on('closed', () => { janela = null })
}

function configurarCaptura () {
  const sessao = session.defaultSession

  // O picker nativo é dispensado de propósito: a grade de miniaturas é nossa.
  sessao.setDisplayMediaRequestHandler(async (request, callback) => {
    // Sem bilhete, o pedido não veio da nossa UI. Nega. E de outra página
    // também, mesmo com bilhete.
    if (!pedidoPendente || !ehDoApp(request.frame && request.frame.url)) return callback({})

    const { id, comAudio } = pedidoPendente
    pedidoPendente = null

    try {
      const fontes = await desktopCapturer.getSources({ types: ['screen', 'window'] })
      const fonte = fontes.find((f) => f.id === id)
      if (!fonte) return callback({})

      callback({
        video: fonte,
        // 'loopback' = áudio que o sistema está tocando. Só é entregue se o
        // renderer também tiver pedido audio no getDisplayMedia.
        audio: comAudio ? 'loopback' : undefined
      })

      // Capturar e codificar é o trecho que mais sofre com o jogo disputando
      // CPU, e a captura faz o Chromium abrir processo novo, que nasce em
      // prioridade normal. Por isso de novo agora e mais uma vez daqui a
      // pouco: medido na abertura, `getAppMetrics()` via 3 processos e um
      // quarto apareceu depois, ficando de fora do primeiro ajuste.
      priorizar('captura concedida')
      setTimeout(() => priorizar('captura em andamento'), 3000)
    } catch (erro) {
      console.error('[captura] falha ao listar fontes:', erro)
      callback({})
    }
  }, { useSystemPicker: false })

  // Só o que o app precisa, e só para a página dele; o resto é negado.
  sessao.setPermissionRequestHandler((_conteudo, permissao, permitir, detalhes) => {
    const doApp = ehDoApp(detalhes && detalhes.requestingUrl)
    permitir(doApp && (permissao === 'media' || permissao === 'display-capture'))
  })
}

// --- IPC do seletor de fontes -------------------------------------------------

ipcMain.handle('fontes:listar', apenasDoApp(async () => {
  const fontes = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  })

  return fontes
    .filter((f) => !f.thumbnail.isEmpty() || f.id.startsWith('screen:'))
    .map((f) => ({
      id: f.id,
      nome: f.name,
      tela: f.id.startsWith('screen:'),
      miniatura: f.thumbnail.toDataURL(),
      icone: f.appIcon && !f.appIcon.isEmpty() ? f.appIcon.toDataURL() : null
    }))
}))

ipcMain.handle('fontes:escolher', apenasDoApp((_evento, { id, comAudio }) => {
  pedidoPendente = { id: String(id), comAudio: Boolean(comAudio) }
  return true
}))

// --- atualização automática ---------------------------------------------------
//
// Busca a versão nova no GitHub Releases, baixa em segundo plano e instala
// quando o usuário mandar. Só funciona na versão INSTALADA: o executável
// portátil não tem como se substituir enquanto roda.

const { autoUpdater } = require('electron-updater')

let estadoAtualizacao = { situacao: 'parado' }

function avisarSobreAtualizacao (situacao, extra = {}) {
  estadoAtualizacao = { situacao, ...extra }
  registrar('update', situacao + (extra.versao ? ' ' + extra.versao : '') +
    (extra.porcento !== undefined ? ' ' + extra.porcento + '%' : ''))
  if (janela && !janela.webContents.isDestroyed()) {
    janela.webContents.send('atualizar:estado', estadoAtualizacao)
  }
}

function configurarAtualizacao () {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => avisarSobreAtualizacao('procurando'))
  autoUpdater.on('update-available', (info) => avisarSobreAtualizacao('baixando', { versao: info.version, porcento: 0 }))
  autoUpdater.on('update-not-available', () => avisarSobreAtualizacao('atual'))
  autoUpdater.on('download-progress', (p) => avisarSobreAtualizacao('baixando', { porcento: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => avisarSobreAtualizacao('pronta', { versao: info.version }))
  autoUpdater.on('error', (erro) => avisarSobreAtualizacao('falhou', { motivo: erro.message }))

  // Em desenvolvimento não há versão publicada para comparar, e o updater
  // reclama de arquivo de configuração ausente. Silêncio é o certo aqui.
  if (!app.isPackaged) {
    registrar('update', 'ignorado: rodando fora do pacote')
    return
  }

  autoUpdater.checkForUpdates().catch((erro) => {
    avisarSobreAtualizacao('falhou', { motivo: erro.message })
  })
}

ipcMain.handle('atualizar:estado', apenasDoApp(() => estadoAtualizacao))

ipcMain.handle('atualizar:verificar', apenasDoApp(async () => {
  if (!app.isPackaged) return { situacao: 'parado', motivo: 'só na versão instalada' }
  try {
    await autoUpdater.checkForUpdates()
  } catch (erro) {
    avisarSobreAtualizacao('falhou', { motivo: erro.message })
  }
  return estadoAtualizacao
}))

// Fecha o app, aplica a atualizacao e abre de novo, sem assistente.
//
// Os dois argumentos sao o que evita a janela do instalador:
//   isSilent = true         instala sem interface
//   isForceRunAfter = true  reabre o app quando terminar
//
// So funciona porque a instalacao e por usuario (perMachine: false): uma
// instalacao para toda a maquina pediria elevacao, e elevacao nao e silenciosa.
ipcMain.handle('atualizar:instalar', apenasDoApp(() => {
  if (estadoAtualizacao.situacao !== 'pronta') return false
  pararCaptura()
  registrar('update', 'instalando em silencio e reabrindo')
  autoUpdater.quitAndInstall(true, true)
  return true
}))

// --- captura de áudio por processo --------------------------------------------

// Addon nativo. Se não estiver compilado, tudo aqui devolve indisponível e o
// app segue com o loopback normal, nada disso pode quebrar o resto.
const capturaProcesso = require('../nativo/indice.js')

let capturaAtiva = null

function pararCaptura () {
  if (!capturaAtiva) return
  try { capturaAtiva.parar() } catch { /* já morreu */ }
  capturaAtiva = null
}

ipcMain.handle('audio:disponivel', apenasDoApp(() => capturaProcesso.disponivel()))

ipcMain.handle('audio:sessoes', apenasDoApp(() => capturaProcesso.listarSessoes()))

// Descobre o processo dono da janela escolhida, para capturar só o áudio dela.
ipcMain.handle('audio:pidDaFonte', apenasDoApp((_evento, idDaFonte) =>
  capturaProcesso.pidDaFonte(idDaFonte)))

ipcMain.handle('audio:iniciar', apenasDoApp((evento, { pid, modo }) => {
  pararCaptura()

  const remetente = evento.sender

  try {
    capturaAtiva = capturaProcesso.capturar({
      pid,
      modo,
      aoReceber: (amostras) => {
        // Chega ~100 vezes por segundo. isDestroyed evita estourar quando a
        // janela fecha antes da captura parar.
        if (!remetente.isDestroyed()) remetente.send('audio:bloco', amostras)
      }
    })

    const formato = capturaAtiva.formato()
    registrar('audio', `captura por processo: pid ${pid}, modo ${modo}, ` +
      `${formato.taxa}Hz ${formato.canais}ch ${formato.bits}bits`)
    return { ok: true, formato }
  } catch (erro) {
    capturaAtiva = null
    registrar('audio', `FALHOU: pid ${pid}, modo ${modo}, ${erro.message}`)
    return { ok: false, motivo: erro.message }
  }
}))

ipcMain.handle('audio:parar', apenasDoApp(() => {
  pararCaptura()
  return true
}))

// --- ciclo de vida ------------------------------------------------------------

app.on('child-process-gone', (_evento, detalhes) => {
  registrar('CRASH', `processo ${detalhes.type} morreu: ${detalhes.reason}`)
})

app.whenReady().then(() => {
  iniciarLog()
  registrar('app', `Electron ${process.versions.electron}, Chrome ${process.versions.chrome}`)

  // Diz de cara se a captura por processo esta disponivel, e a primeira coisa
  // que se quer saber quando o audio sai errado.
  const audioNativo = capturaProcesso.disponivel()
  registrar('app', audioNativo.ok
    ? 'captura de audio por processo: disponivel'
    : `captura de audio por processo: INDISPONIVEL (${audioNativo.motivo})`)

  if (versaoElectron < VERSAO_MINIMA) {
    console.warn(
      `[aviso] Electron ${process.versions.electron}: o áudio do sistema exige ` +
      `a versão ${VERSAO_MINIMA} ou maior. O vídeo funciona, o áudio vem mudo.`
    )
  }

  configurarCaptura()
  criarJanela()
  configurarAtualizacao()

  // Depois da janela existir: antes dela, o processo do renderer e o da GPU
  // ainda não nasceram e ficariam de fora.
  janela.webContents.once('did-finish-load', () => priorizar('abertura'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  pararCaptura()
})
