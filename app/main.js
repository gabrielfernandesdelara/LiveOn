// Processo principal: janela, seletor de fontes por IPC e o handler de
// getDisplayMedia, que é onde o áudio do sistema entra (audio: 'loopback').

const { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, powerMonitor, session, shell } = require('electron')
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

// --- preferências que valem desde a abertura ----------------------------------
//
// Ficam num arquivo e não no localStorage porque precisam ser lidas ANTES da
// janela existir: desligar a aceleração por hardware só vale se for pedido
// antes do app ficar pronto. Por isso mudar exige reiniciar.

const ARQUIVO_CONFIG = path.join(app.getPath('userData'), 'config.json')

function lerConfig () {
  try { return JSON.parse(fs.readFileSync(ARQUIVO_CONFIG, 'utf8')) || {} } catch { return {} }
}

function gravarConfig (config) {
  fs.mkdirSync(path.dirname(ARQUIVO_CONFIG), { recursive: true })
  fs.writeFileSync(ARQUIVO_CONFIG, JSON.stringify(config, null, 2))
}

// O que ESTA execução está usando. A escolha gravada pode ser outra, se a
// pessoa mudou e ainda não reiniciou.
const videoAtivo = lerConfig().video === 'cpu' ? 'cpu' : 'gpu'

// "Processador" desliga a aceleração do app inteiro, e não só a do vídeo. Os
// dois switches de vídeo sozinhos quase não mudavam nada: o app negocia VP8,
// que no Windows já é codificado e decodificado pela CPU. O que a placa faz de
// verdade no LiveOn é desenhar a janela e os vídeos. Medido nesta máquina: sem
// aceleração, a captura de tela com áudio continua entregando ~30 fps.
if (videoAtivo === 'cpu') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-accelerated-video-decode')
  app.commandLine.appendSwitch('disable-accelerated-video-encode')
}

// --- registro em arquivo ------------------------------------------------------
//
// Existe porque bug que só aparece com dois participantes de verdade não dá
// para depurar olhando o terminal: no app empacotado não há terminal nenhum.
//
// Mora em C:\Users\<nome>\Documents\LiveOn\Logs, onde qualquer um acha para mandar, e cada
// sala ganha o próprio arquivo, com o nome dela, data e hora. Até entrar numa
// sala o arquivo se chama "sem sala"; ao entrar, ele é RENOMEADO para o nome
// da sala, e assim o que aconteceu na abertura (placa de vídeo, prioridade)
// vai junto. Uma segunda sala na mesma execução ganha arquivo novo, com o
// cabeçalho da abertura repetido no topo.

// Por quanto tempo um log fica. Uma execução sem sala também gera um, então
// sem prazo a pasta crescia para sempre. Duas semanas, a pedido do dono:
// costuma sobrar tempo para o problema ser contado e o arquivo mandado.
const VALIDADE_DOS_LOGS = 14 * 24 * 60 * 60 * 1000

let arquivoLog = null
let salaDoLog = null
const cabecalho = []

// Sempre C:\Users\<nome>\Documents, e NÃO o app.getPath('documents'): com o
// backup do OneDrive ligado, o Windows aponta os Documentos para
// OneDrive\Documentos, e o log iria parar na nuvem. Pedido do dono.
//
// Os testes apontam para uma pasta temporária, para não sujar os Documentos
// de quem roda.
function pastaDosLogs () {
  return process.env.LIVEON_PASTA_LOGS || path.join(app.getPath('home'), 'Documents', 'LiveOn', 'Logs')
}

// 2026-11-04 21h35: sem dois-pontos, que o Windows não aceita em nome de
// arquivo.
function carimbo (data = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${data.getFullYear()}-${p(data.getMonth() + 1)}-${p(data.getDate())} ` +
    `${p(data.getHours())}h${p(data.getMinutes())}`
}

// O nome da sala vem de quem a criou, então é tratado como qualquer dado de
// fora: sai o que o Windows recusa em nome de arquivo, e os nomes reservados
// (CON, NUL, COM1...) ganham um prefixo.
function nomeSeguro (rotulo) {
  let nome = String(rotulo || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .replace(/[. ]+$/, '')
  if (!nome) nome = 'sala'
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(nome)) nome = 'sala ' + nome
  return nome
}

function caminhoLivre (base) {
  const pasta = pastaDosLogs()
  let caminho = path.join(pasta, base + '.log')
  for (let n = 2; fs.existsSync(caminho); n++) caminho = path.join(pasta, `${base} (${n}).log`)
  return caminho
}

// Pela data da última escrita, e não da criação: um log de sala que ficou
// aberta dias conta a partir do fim dela.
function limparLogsAntigos () {
  const limite = Date.now() - VALIDADE_DOS_LOGS
  try {
    const pasta = pastaDosLogs()
    for (const nome of fs.readdirSync(pasta)) {
      if (!nome.endsWith('.log')) continue
      const caminho = path.join(pasta, nome)
      try {
        if (caminho !== arquivoLog && fs.statSync(caminho).mtimeMs < limite) fs.rmSync(caminho, { force: true })
      } catch { /* um arquivo preso não impede os outros */ }
    }
  } catch { /* limpar é bônus */ }
}

function iniciarLog () {
  try {
    fs.mkdirSync(pastaDosLogs(), { recursive: true })
    arquivoLog = caminhoLivre(`sem sala ${carimbo()}`)
    fs.writeFileSync(arquivoLog, '')
  } catch {
    arquivoLog = null // sem log é melhor que não abrir
  }
  limparLogsAntigos()

  registrarCabecalho('inicio', `LiveOn ${app.getVersion()} | ${new Date().toISOString()} | ` +
    `Windows ${os.release()} | empacotado: ${app.isPackaged}`)
}

function registrar (origem, texto) {
  const linha = `${new Date().toISOString()} [${origem}] ${texto}\n`
  try { process.stdout.write(linha) } catch { /* sem console no empacotado */ }
  try { if (arquivoLog) fs.appendFileSync(arquivoLog, linha) } catch { /* disco cheio */ }
}

// Linha que também vai para o topo de cada arquivo novo de sala: é o retrato
// da máquina, e sem ele o arquivo de uma segunda sala não diria nada da placa.
function registrarCabecalho (origem, texto) {
  cabecalho.push(`[${origem}] ${texto}`)
  registrar(origem, texto)
}

function abrirLogDaSala (rotulo) {
  const destino = caminhoLivre(`${nomeSeguro(rotulo)} ${carimbo()}`)
  try {
    if (arquivoLog && !salaDoLog) {
      // Primeira sala desta execução: leva junto o que já foi escrito.
      fs.renameSync(arquivoLog, destino)
    } else {
      fs.writeFileSync(destino, cabecalho.map((linha) => `(abertura) ${linha}\n`).join(''))
    }
    arquivoLog = destino
  } catch (erro) {
    registrar('log', `nao consegui abrir o arquivo da sala: ${erro.message}`)
  }
  salaDoLog = rotulo
  limparLogsAntigos()
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

// Entrei numa sala: arquivo com o nome dela, e as medições começam.
ipcMain.handle('log:sala', apenasDoApp((_evento, rotulo) => {
  abrirLogDaSala(String(rotulo || '').slice(0, 60))
  naSala = true
  return arquivoLog
}))

ipcMain.handle('log:saiu', apenasDoApp(() => {
  naSala = false
  return true
}))

// --- configurações da tela de entrada -----------------------------------------

ipcMain.handle('config:ler', apenasDoApp(async () => {
  const placa = await placaPronta
  return {
    video: lerConfig().video === 'cpu' ? 'cpu' : 'gpu',
    videoAtivo,
    placa: placa.nome,
    amd: placa.amd
  }
}))

ipcMain.handle('config:gravar', apenasDoApp((_evento, { video } = {}) => {
  if (video !== 'gpu' && video !== 'cpu') return false
  try {
    gravarConfig({ ...lerConfig(), video })
    registrar('config', `video: ${video === 'cpu' ? 'processador' : 'placa de video'} (vale ao reiniciar)`)
    return true
  } catch (erro) {
    registrar('config', `nao consegui gravar: ${erro.message}`)
    return false
  }
}))

ipcMain.handle('app:reiniciar', apenasDoApp(() => {
  registrar('config', 'reiniciando a pedido')
  app.relaunch()
  app.quit()
  return true
}))

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

// --- placa de vídeo -------------------------------------------------------------
//
// Dois amigos com placa AMD tiveram o PC inteiro travando e voltando sozinho
// com o LiveOn aberto; ninguém com NVIDIA teve. Até a causa ser confirmada
// pelo log, quem tem AMD fica sem a prioridade ALTA, que é a suspeita mais
// barata de tirar.

const FABRICANTES = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel' }
// O "Microsoft Basic Render Driver" aparece em toda máquina e não é placa.
const SEM_PLACA = 0x1414

let placaPronta = Promise.resolve({ nome: 'desconhecida', amd: false, lista: [] })

async function lerPlaca () {
  // O 'complete' é o que diz qual placa está ATIVA; o 'basic' marca todas
  // como inativas (medido aqui, Electron 43). Fica de reserva.
  let info
  try { info = await app.getGPUInfo('complete') } catch { /* tenta o básico */ }
  if (!info || !info.gpuDevice) {
    try { info = await app.getGPUInfo('basic') } catch { info = {} }
  }

  const lista = (info.gpuDevice || [])
    .filter((p) => p.vendorId !== SEM_PLACA)
    // A mesma placa aparece repetida, uma por preferência de desempenho.
    .filter((p, i, todas) => todas.findIndex((q) => q.deviceId === p.deviceId && q.vendorId === p.vendorId) === i)
    .map((p) => ({
      nome: p.deviceString || `0x${Number(p.deviceId).toString(16)}`,
      fabricante: FABRICANTES[p.vendorId] || `0x${Number(p.vendorId).toString(16)}`,
      driver: p.driverVersion || '?',
      ativa: Boolean(p.active)
    }))

  const principal = lista.find((p) => p.ativa) || lista[0]
  return {
    nome: principal ? principal.nome : 'desconhecida',
    // QUALQUER AMD na máquina conta, e não só a ativa: num notebook com Ryzen
    // e NVIDIA, a integrada da AMD também desenha coisa. Tirar a prioridade
    // a mais só devolve o comportamento de antes da 1.2.0.
    amd: lista.some((p) => p.fabricante === 'AMD'),
    lista
  }
}

// ALTA, e não tempo real. Medido nesta máquina: sem ser administrador o
// Windows aceita o pedido de tempo real e devolve ALTA do mesmo jeito, então
// pedir mais seria mentira. E é bom que seja assim: tempo real passa na frente
// do driver de áudio e engasga o som e o mouse do sistema inteiro. ALTA já
// passa na frente do jogo, que roda em normal.
async function priorizar (motivo) {
  const placa = await placaPronta
  if (placa.amd) {
    registrar('app', `prioridade normal, sem subir: placa AMD (${motivo})`)
    return
  }

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

// --- medições para o registro -------------------------------------------------
//
// O travamento das placas AMD é o PC inteiro parando e voltando. Para o log
// mostrar isso, um relógio de 1s confere se ele mesmo atrasou: se o processo
// principal ficou parado vários segundos, o sistema todo provavelmente ficou.
// E enquanto há sala, a cada 30s, quanto de CPU e memória cada processo do app
// está usando, para ver se o travamento vem com o app pesado ou do nada.

const ATRASO_SUSPEITO = 2000
const INTERVALO_MEDICAO = 30000

let naSala = false

function vigiarTravamentos () {
  let ultima = Date.now()
  setInterval(() => {
    const agora = Date.now()
    const atraso = agora - ultima - 1000
    ultima = agora
    if (atraso > ATRASO_SUSPEITO) {
      registrar('TRAVOU', `o app ficou ${(atraso / 1000).toFixed(1)} s sem rodar ` +
        '(o PC travou, ou dormiu)')
    }
  }, 1000)

  // Dormir também aparece como atraso; estes dois separam uma coisa da outra.
  powerMonitor.on('suspend', () => registrar('energia', 'o PC vai dormir'))
  powerMonitor.on('resume', () => registrar('energia', 'o PC acordou'))

  setInterval(() => {
    if (!naSala) return
    const porTipo = new Map()
    let memoria = 0
    for (const p of app.getAppMetrics()) {
      porTipo.set(p.type, (porTipo.get(p.type) || 0) + (p.cpu ? p.cpu.percentCPUUsage : 0))
      memoria += p.memory ? p.memory.workingSetSize : 0
    }
    const cpu = [...porTipo].map(([tipo, uso]) => `${tipo} ${Math.round(uso)}%`).join(', ')
    registrar('medicao', `CPU: ${cpu} | memoria do app: ${Math.round(memoria / 1024)} MB | ` +
      `livre no PC: ${Math.round(os.freemem() / 1048576)} MB`)
  }, INTERVALO_MEDICAO)
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

// O retrato da máquina no topo do registro. Com ele, um log mandado por um
// amigo já diz que placa, que driver e que modo estavam em uso.
async function descreverMaquina () {
  registrarCabecalho('app', `Electron ${process.versions.electron}, Chrome ${process.versions.chrome}`)

  const cpus = os.cpus()
  registrarCabecalho('maquina', `CPU: ${cpus[0] ? cpus[0].model.trim() : '?'} (${cpus.length} threads) | ` +
    `RAM: ${(os.totalmem() / 1073741824).toFixed(1)} GB`)

  const placa = await placaPronta
  for (const p of placa.lista) {
    registrarCabecalho('maquina', `placa de video: ${p.nome} (${p.fabricante}, driver ${p.driver})` +
      (p.ativa ? ' [ativa]' : ''))
  }
  if (placa.lista.length === 0) registrarCabecalho('maquina', 'placa de video: nao identificada')

  const estado = app.getGPUFeatureStatus()
  registrarCabecalho('maquina', `video: ${videoAtivo === 'cpu' ? 'PROCESSADOR (aceleracao desligada)' : 'placa de video'} | ` +
    `composicao=${estado.gpu_compositing} decodificar=${estado.video_decode} codificar=${estado.video_encode}`)
  registrarCabecalho('maquina', placa.amd
    ? 'prioridade: normal (placa AMD)'
    : 'prioridade: ALTA')

  // Diz de cara se a captura por processo esta disponivel, e a primeira coisa
  // que se quer saber quando o audio sai errado.
  const audioNativo = capturaProcesso.disponivel()
  registrarCabecalho('app', audioNativo.ok
    ? 'captura de audio por processo: disponivel'
    : `captura de audio por processo: INDISPONIVEL (${audioNativo.motivo})`)
}

app.whenReady().then(() => {
  iniciarLog()
  placaPronta = lerPlaca().catch(() => ({ nome: 'desconhecida', amd: false, lista: [] }))
  descreverMaquina().catch((erro) => registrar('app', `nao consegui descrever a maquina: ${erro.message}`))
  vigiarTravamentos()

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
