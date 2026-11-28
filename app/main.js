// Processo principal: janela, seletor de fontes por IPC e o handler de
// getDisplayMedia, que é onde o áudio do sistema entra (audio: 'loopback').

const { app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Notification, powerMonitor, screen, session, sharedTexture, shell } = require('electron')
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

  // Nada de janelas novas, em NENHUM conteudo: links externos vao para o
  // navegador do sistema. A unica excecao e a mini tela (ver "mini tela",
  // mais abaixo), e so quando quem pede e a pagina do app: em branco, com o
  // nome dela, e montada pela propria pagina. Vale aqui, e nao so na janela
  // principal, para nao depender de lembrar disto numa janela nova.
  conteudo.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName === MINI_NOME && !miniTela && ehDoApp(conteudo.getURL())) {
      return { action: 'allow', overrideBrowserWindowOptions: opcoesDaMiniTela() }
    }
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  conteudo.on('did-create-window', (filha, detalhes) => {
    if (detalhes.frameName === MINI_NOME) prepararMiniTela(filha, conteudo)
  })
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

// O registro pode ser desligado na aba Debug (2.0.0, a pedido do dono). Mora
// no config.json, e nao no localStorage, porque o registro comeca antes da
// janela existir. Ligado e o padrao: e a unica ferramenta para bug que so
// aparece com dois participantes. Desligado, nada vai para o disco; a
// abertura (placa, prioridade) continua guardada na memoria, e religar no
// meio da execucao abre um arquivo novo com ela no topo.
let registroLigado = lerConfig().registro !== false

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
// aberta dias conta a partir do fim dela. Vale também para a Monitoria.
function limparLogsAntigos () {
  const limite = Date.now() - VALIDADE_DOS_LOGS
  const limparPasta = (pasta, extensao, emUso) => {
    try {
      for (const nome of fs.readdirSync(pasta)) {
        if (!nome.endsWith(extensao)) continue
        const caminho = path.join(pasta, nome)
        try {
          if (caminho !== emUso && fs.statSync(caminho).mtimeMs < limite) fs.rmSync(caminho, { force: true })
        } catch { /* um arquivo preso não impede os outros */ }
      }
    } catch { /* limpar é bônus */ }
  }
  limparPasta(pastaDosLogs(), '.log', arquivoLog)
  limparPasta(pastaDaMonitoria(), '.csv', monitoria.arquivo)
}

// --- monitoria ----------------------------------------------------------------
//
// Medição detalhada, ligada na aba Debug (2.0.0, a pedido do dono). É o
// registro de [medicao] e de "video" em dose maior: a cada 5 s, numa
// planilha CSV própria em LiveOn\Monitorias, um arquivo por abertura do app.
// Formato "longo" (hora; quem; medida; valor), que aceita qualquer medida nova
// sem mudar o cabeçalho e abre no Excel; separado por ";" porque o Excel em
// português usa a vírgula como decimal. O processo principal mede os
// processos do app; a página mede os vídeos e manda as linhas por IPC.
const INTERVALO_MONITORIA = 5000
const monitoria = { arquivo: null, relogio: null }

// Documentos\LiveOn\Monitorias, ao lado da Logs e nao dentro dela (pedido do
// dono). Nos testes, dentro da pasta temporaria deles, para nao sujar nada.
function pastaDaMonitoria () {
  if (process.env.LIVEON_PASTA_LOGS) return path.join(process.env.LIVEON_PASTA_LOGS, 'Monitorias')
  return path.join(app.getPath('home'), 'Documents', 'LiveOn', 'Monitorias')
}

function linhaDaMonitoria (hora, quem, medida, valor) {
  // Sem ";" nem quebra de linha dentro de um campo: o nome de quem vem de
  // outra pessoa.
  const limpo = (v) => String(v === undefined || v === null ? '' : v).replace(/[;\r\n]/g, ' ').slice(0, 120)
  return `${limpo(hora)};${limpo(quem)};${limpo(medida)};${limpo(valor)}\n`
}

function escreverNaMonitoria (texto) {
  if (!monitoria.arquivo) return
  try { fs.appendFileSync(monitoria.arquivo, texto) } catch { /* disco cheio: medir é bônus */ }
}

function medirProcessos () {
  const hora = new Date().toLocaleTimeString('pt-BR')
  let texto = ''
  let memoria = 0
  const porTipo = new Map()
  for (const p of app.getAppMetrics()) {
    const atual = porTipo.get(p.type) || { cpu: 0, memoria: 0 }
    atual.cpu += p.cpu ? p.cpu.percentCPUUsage : 0
    atual.memoria += p.memory ? p.memory.workingSetSize : 0
    porTipo.set(p.type, atual)
    memoria += p.memory ? p.memory.workingSetSize : 0
  }
  for (const [tipo, uso] of porTipo) {
    texto += linhaDaMonitoria(hora, 'app', `cpu ${tipo} (%)`, uso.cpu.toFixed(1).replace('.', ','))
    texto += linhaDaMonitoria(hora, 'app', `memoria ${tipo} (MB)`, Math.round(uso.memoria / 1024))
  }
  texto += linhaDaMonitoria(hora, 'app', 'memoria total (MB)', Math.round(memoria / 1024))
  texto += linhaDaMonitoria(hora, 'app', 'prioridade na placa', prioridadePlacaLigada() ? 'ligada' : 'desligada')
  texto += linhaDaMonitoria(hora, 'pc', 'memoria livre (MB)', Math.round(os.freemem() / 1048576))
  escreverNaMonitoria(texto)
}

function ligarMonitoria (ligar) {
  if (!ligar) {
    clearInterval(monitoria.relogio)
    if (monitoria.arquivo) registrar('monitoria', 'desligada')
    monitoria.relogio = null
    monitoria.arquivo = null
    return null
  }
  if (monitoria.arquivo) return monitoria.arquivo
  try {
    fs.mkdirSync(pastaDaMonitoria(), { recursive: true })
    let caminho = path.join(pastaDaMonitoria(), `Monitoria ${carimbo()}.csv`)
    for (let n = 2; fs.existsSync(caminho); n++) caminho = path.join(pastaDaMonitoria(), `Monitoria ${carimbo()} (${n}).csv`)
    // A marca do UTF-8 no começo faz o Excel abrir os acentos certos.
    fs.writeFileSync(caminho, String.fromCharCode(0xFEFF) + 'hora;quem;medida;valor\n')
    monitoria.arquivo = caminho
  } catch (erro) {
    registrar('monitoria', `nao consegui criar o arquivo: ${erro.message}`)
    return null
  }
  registrar('monitoria', `ligada: ${path.basename(monitoria.arquivo)}`)
  medirProcessos()
  monitoria.relogio = setInterval(medirProcessos, INTERVALO_MONITORIA)
  return monitoria.arquivo
}

ipcMain.handle('monitoria:ligar', apenasDoApp((_evento, ligar) => ligarMonitoria(Boolean(ligar))))

// As linhas da página: os vídeos de cada amigo. Chegam prontas, mas passam
// pelo mesmo limpador: é texto que veio de outro processo.
ipcMain.on('monitoria:linhas', apenasDoApp((_evento, linhas) => {
  if (!monitoria.arquivo || !Array.isArray(linhas)) return
  const hora = new Date().toLocaleTimeString('pt-BR')
  escreverNaMonitoria(linhas.slice(0, 400).map((l) => linhaDaMonitoria(hora, l && l.quem, l && l.medida, l && l.valor)).join(''))
}))

// Abre o Explorador na pasta, com o arquivo atual selecionado quando houver.
ipcMain.handle('log:abrirPasta', apenasDoApp((_evento, qual) => {
  const monitorar = qual === 'monitoria'
  const arquivo = monitorar ? monitoria.arquivo : arquivoLog
  const pasta = monitorar ? pastaDaMonitoria() : pastaDosLogs()
  try { fs.mkdirSync(pasta, { recursive: true }) } catch { /* abre o que der */ }
  if (arquivo && fs.existsSync(arquivo)) shell.showItemInFolder(arquivo)
  else shell.openPath(pasta)
  return true
}))

function iniciarLog () {
  if (registroLigado) {
    try {
      fs.mkdirSync(pastaDosLogs(), { recursive: true })
      arquivoLog = caminhoLivre(`sem sala ${carimbo()}`)
      fs.writeFileSync(arquivoLog, '')
    } catch {
      arquivoLog = null // sem log é melhor que não abrir
    }
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
  if (!registroLigado) {
    salaDoLog = rotulo
    return
  }
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
    // Sem a página não há quem receba os quadros da captura HDR.
    pararSdr('renderer morreu')
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

// Ligar no meio da execucao: arquivo novo, com o nome da sala se estiver
// numa, e a abertura no topo. Desligar: a ultima linha diz que foi de
// proposito, e o arquivo para de crescer.
function ligarRegistro (ligar) {
  if (!ligar) {
    if (arquivoLog) registrar('log', 'registro desligado nas configuracoes')
    registroLigado = false
    arquivoLog = null
    return
  }
  registroLigado = true
  if (arquivoLog) return
  try {
    fs.mkdirSync(pastaDosLogs(), { recursive: true })
    const destino = caminhoLivre(`${naSala && salaDoLog ? nomeSeguro(salaDoLog) : 'sem sala'} ${carimbo()}`)
    fs.writeFileSync(destino, cabecalho.map((linha) => `(abertura) ${linha}\n`).join(''))
    arquivoLog = destino
    registrar('log', 'registro ligado nas configuracoes')
  } catch (erro) {
    arquivoLog = null
    registrar('log', `nao consegui criar o arquivo: ${erro.message}`)
  }
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
    prioridade: prioridadeEscolhida(),
    prioridadePlaca: prioridadePlacaLigada(),
    prioridadePlacaDisponivel: capturaProcesso.prioridadeGpu(process.pid) !== null,
    registro: registroLigado,
    placa: placa.nome,
    amd: placa.amd
  }
}))

// Grava UMA escolha por vez. O vídeo só vale ao reiniciar; a prioridade e o
// registro valem na hora.
ipcMain.handle('config:gravar', apenasDoApp((_evento, { video, prioridade, registro, prioridadePlaca } = {}) => {
  const quantas = [video, prioridade, registro, prioridadePlaca].filter((v) => v !== undefined).length
  const soVideo = (video === 'gpu' || video === 'cpu') && quantas === 1
  const soPrioridade = (prioridade === 'normal' || prioridade === 'alta') && quantas === 1
  const soRegistro = typeof registro === 'boolean' && quantas === 1
  const soPlaca = typeof prioridadePlaca === 'boolean' && quantas === 1
  if (!soVideo && !soPrioridade && !soRegistro && !soPlaca) return false
  try {
    if (soPlaca) {
      gravarConfig({ ...lerConfig(), prioridadePlaca })
      registrar('config', `prioridade na placa de video: ${prioridadePlaca ? 'ligada' : 'desligada'}`)
      priorizarNaPlaca('configuracao')
    } else if (soRegistro) {
      gravarConfig({ ...lerConfig(), registro })
      ligarRegistro(registro)
    } else if (soVideo) {
      gravarConfig({ ...lerConfig(), video })
      registrar('config', `video: ${video === 'cpu' ? 'processador' : 'placa de video'} (vale ao reiniciar)`)
    } else {
      gravarConfig({ ...lerConfig(), prioridade })
      registrar('config', `prioridade: ${prioridade}`)
      priorizar('configuracao')
    }
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

// --- mini tela -----------------------------------------------------------------
//
// A tela de um amigo numa janelinha sempre por cima de tudo (1.6.2, a pedido
// do dono), para deixar em cima de um jogo. Ela pode ser TRAVADA: o mouse
// passa direto por ela (setIgnoreMouseEvents), como se ela nao estivesse ali.
// Destrava com a tecla escolhida nas configuracoes (atalho global, registrado
// so enquanto ela estiver travada, para nao roubar a tecla dos outros
// programas o tempo todo) ou com Alt+Tab ate ela.
//
// A janela e aberta pela pagina com window.open('about:blank', MINI_NOME):
// assim ela fica no MESMO processo e na mesma origem da pagina, que monta o
// conteudo e entrega o video (um MediaStream nao atravessa processos). Nada
// e carregado nela: o setWindowOpenHandler so deixa passar esse caso, e o
// will-navigate de sempre segura qualquer navegacao.
const MINI_NOME = 'liveon-mini-tela'
let miniTela = null
// A pagina que abriu a mini: e para ela que vao os avisos de travada e
// fechada.
let miniDono = null
let miniTravada = false
let miniPerdeuFoco = false
let miniAtalho = ''

function opcoesDaMiniTela () {
  // No canto de baixo a direita da tela onde o app esta.
  const area = screen.getDisplayMatching(janela ? janela.getBounds() : { x: 0, y: 0, width: 1, height: 1 }).workArea
  const largura = 480
  const altura = 270
  return {
    width: largura,
    height: altura,
    x: area.x + area.width - largura - 24,
    y: area.y + area.height - altura - 24,
    minWidth: 192,
    minHeight: 108,
    // Os testes nao mostram nada na tela de quem roda (pedido do dono).
    show: process.env.LIVEON_MINI_ESCONDIDA !== '1',
    frame: false,
    alwaysOnTop: true,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#000000',
    title: 'LiveOn: mini tela',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false
    }
  }
}

function avisarDonoDaMini (canal, ...args) {
  if (miniDono && !miniDono.isDestroyed()) miniDono.send(canal, ...args)
}

function prepararMiniTela (filha, dono) {
  miniTela = filha
  miniDono = dono
  // 'screen-saver' e o nivel mais alto: fica por cima de jogo em janela sem
  // borda. Jogo em tela cheia EXCLUSIVA nao deixa nada por cima, e nao ha o
  // que fazer quanto a isso.
  filha.setAlwaysOnTop(true, 'screen-saver')
  filha.setAspectRatio(16 / 9)
  filha.on('blur', () => { if (miniTravada) miniPerdeuFoco = true })
  // Alt+Tab ate ela destrava. So conta depois de ela ter perdido o foco ao
  // travar, senao o proprio foco do clique em "Travar" destravava na hora.
  filha.on('focus', () => { if (miniTravada && miniPerdeuFoco) destravarMiniTela('alt+tab') })
  filha.on('closed', () => {
    destravarMiniTela('fechada')
    avisarDonoDaMini('mini:fechada')
    miniTela = null
    miniDono = null
  })
  registrar('mini', 'mini tela aberta')
}

function destravarMiniTela (motivo) {
  if (!miniTravada) return
  miniTravada = false
  if (miniAtalho) {
    try { globalShortcut.unregister(miniAtalho) } catch { /* ja solto */ }
    miniAtalho = ''
  }
  if (miniTela && !miniTela.isDestroyed()) miniTela.setIgnoreMouseEvents(false)
  registrar('mini', `destravada (${motivo})`)
  avisarDonoDaMini('mini:travada', false)
}

// Trava (o mouse passa direto) e liga o atalho de destravar. Devolve se o
// atalho pegou: tecla invalida ou ja usada por outro programa nao pega, e a
// pagina avisa que sobra o Alt+Tab.
ipcMain.handle('mini:travar', apenasDoApp((_evento, atalho) => {
  if (!miniTela || miniTela.isDestroyed()) return { ok: false }
  if (miniTravada) return { ok: true, atalho: Boolean(miniAtalho) }
  let pegou = false
  const acelerador = typeof atalho === 'string' ? atalho.slice(0, 40) : ''
  if (acelerador) {
    try { pegou = globalShortcut.register(acelerador, () => destravarMiniTela('atalho')) } catch { pegou = false }
  }
  miniAtalho = pegou ? acelerador : ''
  miniTravada = true
  miniPerdeuFoco = !miniTela.isFocused()
  miniTela.setIgnoreMouseEvents(true)
  miniTela.blur()
  registrar('mini', `travada, atalho ${pegou ? acelerador : 'nao pegou'}`)
  avisarDonoDaMini('mini:travada', true)
  return { ok: true, atalho: pegou }
}))

ipcMain.handle('mini:destravar', apenasDoApp(() => {
  destravarMiniTela('pedido')
  return true
}))

app.on('will-quit', () => globalShortcut.unregisterAll())

// Se a janela de quem pergunta esta a vista (pausa "quando nao esta a
// vista", 2.0.0): minimizada, e quanto dela outras janelas cobrem (addon;
// null se ele faltar). A janela e a de quem perguntou, e nao a principal fixa,
// para valer tambem nos testes.
ipcMain.handle('janela:visibilidade', apenasDoApp((evento) => {
  const alvo = BrowserWindow.fromWebContents(evento.sender)
  if (!alvo || alvo.isDestroyed()) return null
  const minimizada = alvo.isMinimized() || !alvo.isVisible()
  let coberta = null
  try {
    const alca = alvo.getNativeWindowHandle()
    const hwnd = alca.length >= 8 ? Number(alca.readBigUInt64LE(0)) : alca.readUInt32LE(0)
    coberta = capturaProcesso.fracaoCoberta(hwnd)
  } catch { coberta = null }
  return { minimizada, coberta }
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

// O codigo de sala no meio de um texto colado ("entra ai: rr29-vtxa-ntxd").
// Mesmo alfabeto do gerarCodigo (configuracao.js): 12 caracteres, com ou
// sem os hifens que a tela de entrada mostra. Mudou la, muda aqui.
const LETRA_DO_CODIGO = '[2-9abcdefghjkmnpqrstuvwxyz]'
const CODIGO_NO_TEXTO = new RegExp(
  `(?:^|[^a-z0-9])(${LETRA_DO_CODIGO}{4})[- ]?(${LETRA_DO_CODIGO}{4})[- ]?(${LETRA_DO_CODIGO}{4})(?![a-z0-9])`, 'i')

function codigoNoTexto (texto) {
  const achado = CODIGO_NO_TEXTO.exec(String(texto || ''))
  return achado ? (achado[1] + achado[2] + achado[3]).toLowerCase() : ''
}

// Botao de colar da entrada: e um clique da pessoa, entao devolve o texto,
// mas so o codigo se houver um, e nunca mais que cabe no campo.
ipcMain.handle('colar', apenasDoApp(() => {
  const texto = clipboard.readText()
  return codigoNoTexto(texto) || texto.trim().slice(0, 60)
}))

// Aviso do Windows para os amigos (pedido para entrar, convite, pedido de
// amizade), so quando a janela nao esta com o foco: quem esta olhando para o
// app ja ve o aviso dentro dele. Pelo processo principal, e nao pelo
// Notification da pagina, porque o handler de permissao nega tudo que nao e
// captura. O clique traz a janela para a frente. Sem som proprio: o do
// Windows ja basta.
// LIVEON_SEM_AVISOS desliga: teste nao mostra nada na tela de quem roda.
ipcMain.handle('notificar', apenasDoApp((_evento, dados) => {
  if (process.env.LIVEON_SEM_AVISOS) return false
  if (!Notification.isSupported() || !janela || janela.isDestroyed() || janela.isFocused()) return false
  const titulo = String((dados && dados.titulo) || '').slice(0, 80)
  const texto = String((dados && dados.texto) || '').slice(0, 160)
  if (!titulo) return false
  const aviso = new Notification({ title: titulo, body: texto })
  aviso.on('click', () => {
    if (!janela || janela.isDestroyed()) return
    if (janela.isMinimized()) janela.restore()
    janela.show()
    janela.focus()
  })
  aviso.show()
  return true
}))

// A entrada pergunta sozinha, ao abrir e ao voltar o foco, se ha um codigo
// copiado. Sem clique da pessoa, entao devolve SO o codigo: o resto do que
// ela copiou nao sai daqui.
ipcMain.handle('codigo:copiado', apenasDoApp(() => codigoNoTexto(clipboard.readText())))

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
//    a mesma do jogo. Desde a 1.4.3 o app FICA em normal, e a ALTA virou
//    escolha nas configurações (ver priorizar()).
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-background-timer-throttling')

// --- placa de vídeo -------------------------------------------------------------
//
// Dois amigos com placa AMD tiveram o PC inteiro travando e voltando sozinho
// com o LiveOn aberto; ninguém com NVIDIA teve. A placa vai para o log, que é
// o que vai dizer se a causa é dela. A prioridade já não depende disto: é
// normal para todo mundo, e ALTA só para quem escolher.

const FABRICANTES = { 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x8086: 'Intel' }
// O "Microsoft Basic Render Driver" aparece em toda máquina e não é placa.
const SEM_PLACA = 0x1414

let placaPronta = Promise.resolve({ nome: 'desconhecida', amd: false, lista: [] })

// Placa de verdade: nem o Basic Render Driver, nem o 0x0 que o 'complete'
// devolve no modo processador.
function placasReais (info) {
  return ((info && info.gpuDevice) || [])
    .filter((p) => p.vendorId && p.vendorId !== SEM_PLACA)
    // A mesma placa aparece repetida, uma por preferência de desempenho.
    .filter((p, i, todas) => todas.findIndex((q) => q.deviceId === p.deviceId && q.vendorId === p.vendorId) === i)
}

async function lerPlaca () {
  // O 'complete' é o que diz qual placa está ATIVA; o 'basic' marca todas
  // como inativas (medido aqui, Electron 43). Fica de reserva.
  //
  // No modo processador (aceleração desligada) o 'complete' devolve UMA placa
  // falsa, 0x0. Até a 1.4.2 isso contava como "tem placa", o básico nunca era
  // consultado e a AMD passava despercebida: justo quem escolheu processador
  // por causa do travamento ficava em prioridade ALTA. O 'basic' continua
  // vendo a placa de verdade nesse modo (medido).
  let dispositivos = []
  try { dispositivos = placasReais(await app.getGPUInfo('complete')) } catch { /* tenta o básico */ }
  if (dispositivos.length === 0) {
    try { dispositivos = placasReais(await app.getGPUInfo('basic')) } catch { /* fica vazia */ }
  }

  const lista = dispositivos
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
    // e NVIDIA, a integrada da AMD também desenha coisa. Hoje só serve para a
    // tela de configurações reforçar o aviso da prioridade ALTA.
    amd: lista.some((p) => p.fabricante === 'AMD'),
    lista
  }
}

// ALTA, e não tempo real. Medido nesta máquina: sem ser administrador o
// Windows aceita o pedido de tempo real e devolve ALTA do mesmo jeito, então
// pedir mais seria mentira. E é bom que seja assim: tempo real passa na frente
// do driver de áudio e engasga o som e o mouse do sistema inteiro. ALTA já
// passa na frente do jogo, que roda em normal.
//
// Desde a 1.4.3 a ALTA é ESCOLHA, nas configurações, e o padrão é normal.
// Ela deixava a transmissão mais lisa com jogo aberto, mas os amigos com PC
// travando (e um que desligou sozinho, em 05/11/2026) estavam todos em ALTA,
// e na 1.4.2 a trava da AMD falhava no modo processador. Em vez de adivinhar
// quem aguenta, quem quiser liga, com o aviso na tela.
//
// Aplica a classe escolhida nos dois sentidos: voltar para normal também tem
// que rebaixar os processos que já estavam em ALTA, sem reiniciar.
function prioridadeEscolhida () {
  return lerConfig().prioridade === 'alta' ? 'alta' : 'normal'
}

async function priorizar (motivo) {
  const escolhida = prioridadeEscolhida()
  const classe = escolhida === 'alta'
    ? os.constants.priority.PRIORITY_HIGH
    : os.constants.priority.PRIORITY_NORMAL

  const processos = app.getAppMetrics()
  let subiram = 0
  const falhas = []

  for (const { pid, type } of processos) {
    try {
      os.setPriority(pid, classe)
      subiram++
    } catch (erro) {
      // Processo pode ter morrido entre listar e ajustar. Não é motivo para
      // derrubar nada: o app funciona igual, só disputa CPU em pé de igualdade.
      falhas.push(`${type}/${pid}: ${erro.message}`)
    }
  }

  registrar('app', `prioridade ${escolhida === 'alta' ? 'ALTA' : 'normal'} em ${subiram}/${processos.length} processos (${motivo})` +
    (falhas.length ? `, falhou em ${falhas.join('; ')}` : ''))
}

// O priorizar() da abertura chega CEDO DEMAIS para o processo da GPU: no
// did-finish-load ele ainda nem aparece no getAppMetrics(), e nasce uns 200ms
// depois já em "acima do normal", que é o padrão do Chromium no Windows (o do
// Discord está igual). Medido: normalizado nessa hora, ele fica em acima do
// normal para sempre; normalizado depois de nascer, fica em normal. Quem viu
// foi o dono, no gerenciador de tarefas, em 07/11/2026.
//
// Em vez de acertar o tempo, uma conferência leve a cada 5s devolve à classe
// escolhida qualquer processo fora dela. Pega também o processo da GPU que
// renasce depois de o driver cair, e que voltaria em acima do normal.
const INTERVALO_PRIORIDADE = 5000
const NOMES_PRIORIDADE = { [-14]: 'alta', [-7]: 'acima do normal', 0: 'normal', 7: 'abaixo do normal', 19: 'baixa' }

// Prioridade na PLACA DE VIDEO (2.1.3, opcao da aba Desempenho, desligada
// por padrao). Separada da de processador: com um jogo ocupando a placa
// inteira, a captura e o codificador do LiveOn ficam sem vez, e a tela
// chegava aos amigos a 6 fps com o jogo em foco e a 30 fora dele (monitoria
// de 28/11/2026, Age of Mythology sem limite de fps). O OBS faz o mesmo.
// Ligada pede TEMPO REAL, que o Windows aceitou sem administrador (medido);
// desligada volta ao normal. Vale para todo processo do app, porque a
// captura e o codificador nao moram no mesmo. NAO foi possivel provar o
// ganho aqui: uma carga artificial na placa nao reproduziu a queda, e a
// diferenca ficou no ruido. O teste e de quem tem o problema, com a
// monitoria ligada.
const CLASSE_GPU_NORMAL = 2
const CLASSE_GPU_TEMPO_REAL = 5

function prioridadePlacaLigada () {
  return lerConfig().prioridadePlaca === true
}

function priorizarNaPlaca (motivo) {
  const classe = prioridadePlacaLigada() ? CLASSE_GPU_TEMPO_REAL : CLASSE_GPU_NORMAL
  // A pagina (Tab) fica no sandbox e nao fala com a placa: o Windows recusa
  // com parametro invalido e a classe nem pode ser lida. Quem desenha e
  // codifica e o processo de GPU; ela fica de fora da conta.
  let certos = 0
  let comPlaca = 0
  for (const { pid } of app.getAppMetrics()) {
    const antes = capturaProcesso.prioridadeGpu(pid)
    if (!antes || antes.classe < 0) continue
    comPlaca++
    const r = capturaProcesso.prioridadeGpu(pid, classe)
    if (r && r.ok && r.classe === classe) certos++
  }
  registrar('app', `prioridade na placa ${classe === CLASSE_GPU_TEMPO_REAL ? 'TEMPO REAL' : 'normal'} em ${certos}/${comPlaca} processos que usam a placa (${motivo})`)
}

function vigiarPrioridade () {
  setInterval(() => {
    // O processo de GPU renasce se o driver cair, e nasce na classe normal.
    if (prioridadePlacaLigada()) {
      for (const { pid, type } of app.getAppMetrics()) {
        const r = capturaProcesso.prioridadeGpu(pid)
        if (!r || r.classe < 0 || r.classe === CLASSE_GPU_TEMPO_REAL) continue
        const certo = capturaProcesso.prioridadeGpu(pid, CLASSE_GPU_TEMPO_REAL)
        registrar('app', `prioridade na placa de ${type}/${pid}: ${r.classe} -> ${certo && certo.classe}`)
      }
    }
    const classe = prioridadeEscolhida() === 'alta'
      ? os.constants.priority.PRIORITY_HIGH
      : os.constants.priority.PRIORITY_NORMAL
    for (const { pid, type } of app.getAppMetrics()) {
      try {
        const atual = os.getPriority(pid)
        if (atual === classe) continue
        os.setPriority(pid, classe)
        registrar('app', `prioridade de ${type}/${pid} corrigida: ${NOMES_PRIORIDADE[atual] || atual} -> ${NOMES_PRIORIDADE[classe]}`)
      } catch { /* processo morreu entre listar e ajustar */ }
    }
  }, INTERVALO_PRIORIDADE)
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

  // Janelas novas: ver o setWindowOpenHandler do web-contents-created, no
  // topo, que vale para todo conteudo.

  janela.on('closed', () => {
    janela = null
    // A mini tela vive da pagina principal: sem ela, nao tem o que mostrar.
    if (miniTela && !miniTela.isDestroyed()) miniTela.close()
  })
}

function configurarCaptura () {
  const sessao = session.defaultSession

  // O picker nativo é dispensado de propósito: a grade de miniaturas é nossa.
  sessao.setDisplayMediaRequestHandler(async (request, callback) => {
    // Sem bilhete, o pedido não veio da nossa UI. Nega. E de outra página
    // também, mesmo com bilhete.
    if (!pedidoPendente || !ehDoApp(request.frame && request.frame.url)) {
      try { callback({}) } catch { /* negado */ }
      return
    }

    const { id, comAudio } = pedidoPendente
    pedidoPendente = null

    // Responde uma vez só. No Electron 43 negar com callback({}) estoura
    // quando o pedido era de vídeo, e o catch de baixo respondia de novo: era
    // o "One-time callback was called more than once" no console.
    let respondeu = false
    const responder = (resposta) => {
      if (respondeu) return
      respondeu = true
      try { callback(resposta) } catch (erro) { registrar('captura', `pedido negado: ${erro.message}`) }
    }

    try {
      // Sem miniatura: aqui so interessa achar a fonte pelo id. O padrao do
      // Electron fotografava TODAS as janelas do PC a cada transmissao, logo
      // antes de o Chromium abrir a captura de uma delas (a doc do Electron
      // manda passar 0 quando a miniatura nao serve para nada).
      const fontes = await desktopCapturer.getSources({
        types: [id.startsWith('screen:') ? 'screen' : 'window'],
        thumbnailSize: { width: 0, height: 0 }
      })
      const fonte = fontes.find((f) => f.id === id)
      if (!fonte) {
        // A janela sumiu da lista entre o seletor e o clique (fechou, ou o
        // Windows deixou de oferecê-la). Sem isto o registro não dizia nada.
        registrar('captura', `fonte ${id} nao esta mais na lista do Windows (${fontes.length} fontes)`)
        return responder({})
      }

      responder({
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
      // A captura pode abrir processo novo; o vigia pegaria em 5 s, aqui e na hora.
      if (prioridadePlacaLigada()) setTimeout(() => priorizarNaPlaca('captura em andamento'), 3000)
    } catch (erro) {
      registrar('captura', `falha ao listar fontes: ${erro.message}`)
      responder({})
    }
  }, { useSystemPicker: false })

  // Só o que o app precisa, e só para a página dele; o resto é negado.
  sessao.setPermissionRequestHandler((_conteudo, permissao, permitir, detalhes) => {
    const doApp = ehDoApp(detalhes && detalhes.requestingUrl)
    permitir(doApp && (permissao === 'media' || permissao === 'display-capture'))
  })
}

// --- IPC do seletor de fontes -------------------------------------------------

// A última miniatura de cada tela. Enquanto o "Forçar SDR" captura um monitor,
// o Windows o tira da lista do Chromium (medido: só um capturador por monitor
// no mesmo processo), e o seletor, aberto para AJUSTAR, ficaria sem a tela que
// está no ar. Ela volta com a última miniatura guardada.
const telasVistas = new Map()

ipcMain.handle('fontes:listar', apenasDoApp(async () => {
  const fontes = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
    fetchWindowIcons: true
  })

  const lista = fontes
    .filter((f) => !f.thumbnail.isEmpty() || f.id.startsWith('screen:'))
    .map((f) => ({
      id: f.id,
      nome: f.name,
      tela: f.id.startsWith('screen:'),
      miniatura: f.thumbnail.toDataURL(),
      icone: f.appIcon && !f.appIcon.isEmpty() ? f.appIcon.toDataURL() : null
    }))

  for (const fonte of lista) if (fonte.tela) telasVistas.set(fonte.id, fonte)
  if (sdr && !lista.some((f) => f.id === sdr.fonteId) && telasVistas.has(sdr.fonteId)) {
    lista.unshift(telasVistas.get(sdr.fonteId))
  }
  return lista
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
  // Cada aviso substitui o estado inteiro: sem levar a versao junto, ela
  // sumia da tela no primeiro avanco da barra.
  autoUpdater.on('download-progress', (p) => avisarSobreAtualizacao('baixando', { versao: estadoAtualizacao.versao, porcento: Math.round(p.percent) }))
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

// Só leitura: o HDR de cada monitor vai para o topo do registro (ver
// nativo/src/cor_tela.cc para o porquê).
const hdr = require('../nativo/hdr.js')

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

// --- forçar SDR ---------------------------------------------------------------
//
// Jogo em HDR chega estourado aos amigos: o Chromium pede a tela em 8 bits e
// o Windows corta todo brilho acima de um certo ponto (medido em 19/11/2026:
// tudo acima de ~66 nits virava branco). Com "Forçar SDR" marcado, a tela não
// passa pelo Chromium: o addon captura o monitor em 16 bits, converte para SDR
// na placa de vídeo, e cada quadro chega à página por `sharedTexture`, sem
// passar pixel pela CPU. O monitor continua em HDR; quem muda é só a imagem
// que vai para os amigos, como no Parsec.
//
// Monitor (duplicação de tela) ou janela (Windows Graphics Capture), e só com
// aceleração por placa de vídeo: no modo "Processador" não há textura de GPU
// para receber.

let sdr = null   // { quadro (WebFrameMain), largura, altura, entregues, falhas }

function pararSdr (motivo) {
  if (!sdr) return
  const contagem = hdr.pararCaptura()
  registrar('sdr', `${sdr.comum ? 'captura propria' : 'captura HDR'} parada (${motivo}): ${sdr.entregues} quadros entregues, ` +
    `${contagem.pulados || 0} pulados, ${contagem.recuperacoes || 0} recuperacoes, ${sdr.falhas} falhas de entrega`)
  sdr = null
}

// O retângulo do monitor em pixels físicos, que é como a duplicação do
// Windows o chama. A fonte escolhida diz o monitor pelo display_id.
async function retanguloDaFonte (fonteId) {
  const fontes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
  const fonte = fontes.find((f) => f.id === fonteId)
  if (!fonte) return null
  const tela = screen.getAllDisplays().find((d) => String(d.id) === String(fonte.display_id))
  if (!tela) return null
  const r = screen.dipToScreenRect(null, tela.bounds)
  return { x: r.x, y: r.y, largura: r.width, altura: r.height, nome: tela.label || fonte.name }
}

ipcMain.handle('sdr:disponivel', apenasDoApp(() =>
  videoAtivo === 'gpu' && hdr.capturaDisponivel() && hdr.listar().some((m) => m.ligado)))

// comum: a captura PROPRIA de janela (2.1.3). Quando o Chromium nao consegue
// abrir uma janela (NotReadableError em 8 ms, Windows 10 de um amigo), a
// pagina pede a mesma janela por aqui, pelo Windows Graphics Capture direto
// no HWND: so a janela, mesmo coberta, nada do que estiver na frente. Em
// monitor sem HDR o quadro passa sem conversao. So janela: a tela inteira o
// Chromium nunca recusou.
ipcMain.handle('sdr:iniciar', apenasDoApp(async (evento, { fonteId, largura, altura, fps, comum } = {}) => {
  pararSdr('nova captura')
  comum = comum === true
  if (videoAtivo !== 'gpu') {
    return { ok: false, motivo: comum ? 'a captura própria precisa da placa de vídeo nas configurações' : 'o Forçar SDR precisa da placa de vídeo nas configurações' }
  }

  // O id da fonte diz o que é: "screen:<n>:<n>" ou "window:<hwnd>:<n>".
  const [tipo, numero] = String(fonteId || '').split(':')
  if (comum && tipo !== 'window') return { ok: false, motivo: 'a captura própria é só de janela' }
  let alvo
  let ret = null
  if (tipo === 'screen') {
    ret = await retanguloDaFonte(fonteId)
    if (!ret) return { ok: false, motivo: 'não achei esse monitor' }
    alvo = { x: ret.x, y: ret.y, largura: ret.largura, altura: ret.altura }
  } else if (tipo === 'window' && Number(numero) > 0) {
    alvo = { hwnd: Number(numero) }
  } else {
    return { ok: false, motivo: 'fonte desconhecida' }
  }
  const nome = ret ? ret.nome : 'janela'

  const quadro = evento.senderFrame
  let info
  try {
    info = hdr.iniciarCaptura({
      ...alvo,
      comum,
      // Para os testes exercitarem o caminho sem conversao num monitor em HDR.
      direto: comum && process.env.LIVEON_CAPTURA_DIRETA === '1',
      saidaLargura: Number(largura) || 1920,
      saidaAltura: Number(altura) || 1080,
      fps: Number(fps) || 60
    }, (k, motivo) => {
      if (!sdr) return
      if (k < 0) {
        const fim = motivo || (comum ? 'a captura própria parou' : 'a captura HDR parou')
        pararSdr(fim)
        if (!evento.sender.isDestroyed()) evento.sender.send('sdr:fim', fim)
        return
      }
      entregarQuadroSdr(k)
    })
  } catch (erro) {
    registrar('sdr', `nao consegui iniciar a ${comum ? 'captura propria' : 'captura HDR'} (${nome}): ${erro.message}`)
    return { ok: false, motivo: erro.message }
  }

  // Monitor sem HDR: não há o que converter, a captura de sempre já sai certa.
  if (!info.hdr) return { ok: false, semHdr: true }

  sdr = { quadro, info, fonteId, comum, entregues: 0, falhas: 0 }
  // De uma janela, o nome do monitor é o do Windows (DISPLAY1): o título
  // dela não vai para o log, pode ter coisa que ninguém quis mostrar.
  const onde = info.modo === 'janela' ? `janela no ${info.monitor}` : nome
  if (comum) {
    registrar('sdr', `captura propria da janela no ${info.monitor} (${info.direto ? 'sem conversao' : 'convertendo o HDR'}): ` +
      `${info.entradaLargura}x${info.entradaAltura} -> ${info.largura}x${info.altura} @ ${Number(fps) || 60}fps`)
    return { ok: true, largura: info.largura, altura: info.altura, monitor: onde, direto: info.direto }
  }
  registrar('sdr', `captura HDR em ${onde}: ${info.entradaLargura}x${info.entradaAltura} -> ` +
    `${info.largura}x${info.altura} @ ${Number(fps) || 60}fps, branco do SDR ${Math.round(info.branco)} nits, ` +
    `pico ${Math.round(info.pico)} nits`)
  return { ok: true, largura: info.largura, altura: info.altura, monitor: onde }
}))

function entregarQuadroSdr (k) {
  const atual = sdr
  let importado = null
  try {
    importado = sharedTexture.importSharedTexture({
      textureInfo: {
        pixelFormat: 'rgba',
        codedSize: { width: atual.info.largura, height: atual.info.altura },
        handle: { ntHandle: atual.info.alcas[k] },
        // A hora do quadro, em microssegundos. Sem ela todo quadro saía com
        // carimbo 0, e quem recebe não sabe espaçá-los: acumula e se reajusta
        // de tempos em tempos. Eram as travadas leves a cada poucos segundos
        // do Forçar SDR (medido em 19/11/2026).
        timestamp: Math.round(performance.now() * 1000)
      },
      // A textura volta para o anel do addon só quando ninguém mais a usa,
      // inclusive o codificador do outro processo.
      allReferencesReleased: () => hdr.liberarQuadro(k)
    })
  } catch (erro) {
    atual.falhas++
    hdr.liberarQuadro(k)
    if (atual.falhas === 1) registrar('sdr', `nao consegui importar o quadro: ${erro.message}`)
    return
  }

  sharedTexture.sendSharedTexture({ frame: atual.quadro, importedSharedTexture: importado })
    .then(() => { atual.entregues++ })
    .catch((erro) => {
      atual.falhas++
      if (atual.falhas === 1) registrar('sdr', `nao consegui entregar o quadro: ${erro.message}`)
    })
    .finally(() => importado.release())
}

ipcMain.handle('sdr:parar', apenasDoApp(() => {
  pararSdr('fim da transmissao')
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
  registrarCabecalho('maquina', prioridadeEscolhida() === 'alta'
    ? 'prioridade: ALTA (escolhida nas configuracoes)'
    : 'prioridade: normal')
  registrarCabecalho('maquina', `prioridade na placa de video: ${prioridadePlacaLigada() ? 'TEMPO REAL (escolhida nas configuracoes)' : 'normal'}`)

  // HDR ligado com Windows anterior ao 24H2 e o que deixa a tela estourada
  // para quem assiste. Com o [inicio], que traz a versao do Windows, o log
  // de um amigo ja diz se foi isso.
  const monitores = hdr.listar()
  if (monitores.length) {
    registrarCabecalho('maquina', 'monitores: ' + monitores.map((m) =>
      `${m.nome} (${m.ligado ? 'HDR ligado' : m.suportado ? 'HDR desligado' : 'sem HDR'})`).join(', '))
  }

  // Diz de cara se a captura por processo esta disponivel, e a primeira coisa
  // que se quer saber quando o audio sai errado.
  const audioNativo = capturaProcesso.disponivel()
  registrarCabecalho('app', audioNativo.ok
    ? 'captura de audio por processo: disponivel'
    : `captura de audio por processo: INDISPONIVEL (${audioNativo.motivo})`)
}

// Sem isto, no Windows, o aviso dos amigos sai sem nome de app (ou nem sai,
// rodando da pasta do projeto). O instalador usa o mesmo appId.
if (process.platform === 'win32') app.setAppUserModelId('com.gabrieldelara.liveon')

// --- link da sala: liveon://sala/<codigo> (2.1.0) ---------------------------
//
// O link do Discord abre a pagina do Worker (nuvem/src/pagina.js), que chama
// liveon://sala/<codigo>. O Windows entrega isso ao LiveOn: na abertura, pelo
// argv; com o app ja aberto, ao segundo processo, que passa para este pelo
// 'second-instance' e fecha. Por isso, no app instalado, uma instancia so.
// Rodando da pasta do projeto (testes, npx electron .), nada disso: o
// registro do liveon:// apontaria para o electron.exe solto, e a trava de
// instancia unica fecharia o teste se o LiveOn instalado estivesse aberto
// (os dois usam a mesma pasta de dados).
const LINK_DA_SALA = /^liveon:\/\/sala\/([a-z0-9]{10,60})\/?$/i
let codigoDoLink = ''

function codigoNoLink (argv) {
  for (const arg of argv || []) {
    const achado = LINK_DA_SALA.exec(String(arg).trim())
    if (achado) return achado[1].toLowerCase()
  }
  return ''
}

// O codigo nunca vai inteiro para o registro (ver mascararCodigo).
function abrirLinkDaSala (codigo) {
  // A janela ainda nao existe (o app esta abrindo): o link espera por ela.
  if (!janela || janela.isDestroyed()) {
    if (codigo) codigoDoLink = codigo
    return
  }
  // LIVEON_SEM_AVISOS: teste nao traz janela para a frente.
  if (!process.env.LIVEON_SEM_AVISOS) {
    if (janela.isMinimized()) janela.restore()
    janela.show()
    janela.focus()
  }
  if (!codigo) return
  registrar('app', `link de sala aberto (${codigo.slice(0, 4)}${'*'.repeat(Math.max(0, codigo.length - 4))})`)
  if (janela.webContents.isLoading()) {
    codigoDoLink = codigo
    return
  }
  janela.webContents.send('sala:link', codigo)
}

if (app.isPackaged) {
  if (!app.requestSingleInstanceLock()) app.exit(0)
  app.setAsDefaultProtocolClient('liveon')
}
codigoDoLink = codigoNoLink(process.argv)
app.on('second-instance', (_evento, argv) => abrirLinkDaSala(codigoNoLink(argv)))

app.whenReady().then(() => {
  iniciarLog()
  placaPronta = lerPlaca().catch(() => ({ nome: 'desconhecida', amd: false, lista: [] }))
  descreverMaquina().catch((erro) => registrar('app', `nao consegui descrever a maquina: ${erro.message}`))
  vigiarTravamentos()
  vigiarPrioridade()

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
  janela.webContents.once('did-finish-load', () => {
    priorizar('abertura')
    if (prioridadePlacaLigada()) setTimeout(() => priorizarNaPlaca('abertura'), 1000)
  })
  // Abriu pelo link da sala: a pagina ja tem como receber.
  janela.webContents.on('did-finish-load', () => {
    if (!codigoDoLink) return
    const codigo = codigoDoLink
    codigoDoLink = ''
    abrirLinkDaSala(codigo)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  pararCaptura()
  pararSdr('app fechando')
})
