// Ponte entre a UI e o processo principal. contextIsolation continua ligado:
// o renderer não enxerga ipcRenderer, só estas três funções.

const { contextBridge, ipcRenderer, sharedTexture } = require('electron')

// Quadros do "Forçar SDR". O processo principal manda cada quadro como textura
// de placa de vídeo, e aqui ele vira um VideoFrame para a página. O receptor
// fica registrado desde o começo: o envio desiste em 1 s se não houver quem
// receba. Sem ninguém pedindo, o quadro é fechado na hora.
//
// A página COPIA o quadro na hora (ver capturarSdr, em transmissao.js) e o
// fecha antes de voltar daqui, e só então a textura é liberada. Nada mais na
// página toca a textura importada. Medido em 19/11/2026: deixar o VideoFrame
// da textura ir direto para o <video> da prévia derrubava a página (liberando
// cedo) ou travava a placa de vídeo ao parar (liberando tarde), porque o
// <video> segura o último quadro por um tempo que daqui não dá para saber.
let receberQuadroSdr = null

if (sharedTexture && sharedTexture.setSharedTextureReceiver) {
  sharedTexture.setSharedTextureReceiver(async ({ importedSharedTexture }) => {
    try {
      const quadro = importedSharedTexture.getVideoFrame()
      if (receberQuadroSdr) {
        try { receberQuadroSdr(quadro) } finally { quadro.close() }
      } else {
        quadro.close()
      }
    } catch { /* quadro perdido: vem outro */ } finally {
      importedSharedTexture.release()
    }
  })
}

let ouvinteFimSdr = null

contextBridge.exposeInMainWorld('ponte', {
  // Miniaturas de monitores e janelas para a grade do seletor.
  listarFontes: () => ipcRenderer.invoke('fontes:listar'),

  // Registra a escolha no processo principal. Precisa vir ANTES do
  // getDisplayMedia: é ela que o handler lá do main.js vai consumir.
  escolherFonte: (id, comAudio) => ipcRenderer.invoke('fontes:escolher', { id, comAudio }),

  // --- captura de audio por processo (addon nativo) ---

  audioDisponivel: () => ipcRenderer.invoke('audio:disponivel'),
  audioSessoes: () => ipcRenderer.invoke('audio:sessoes'),
  audioPidDaFonte: (idDaFonte) => ipcRenderer.invoke('audio:pidDaFonte', idDaFonte),
  audioIniciar: (pid, modo) => ipcRenderer.invoke('audio:iniciar', { pid, modo }),
  audioParar: () => ipcRenderer.invoke('audio:parar'),

  // Devolve uma funcao que cancela a inscricao. Sem isso, trocar de captura
  // deixaria ouvintes acumulados recebendo o mesmo audio varias vezes.
  aoReceberAudio: (aoChegar) => {
    const ouvinte = (_evento, amostras) => aoChegar(amostras)
    ipcRenderer.on('audio:bloco', ouvinte)
    return () => ipcRenderer.removeListener('audio:bloco', ouvinte)
  },

  // --- registro em arquivo ---

  copiar: (texto) => ipcRenderer.invoke('copiar', texto),

  // Tela cheia da janela do app.
  telaCheia: (ligar) => ipcRenderer.invoke('janela:telaCheia', ligar),
  aoMudarTelaCheia: (aoMudar) => {
    const ouvinte = (_evento, ligada) => aoMudar(ligada)
    ipcRenderer.on('janela:telaCheia', ouvinte)
    return () => ipcRenderer.removeListener('janela:telaCheia', ouvinte)
  },

  // --- atualizacao automatica ---

  estadoAtualizacao: () => ipcRenderer.invoke('atualizar:estado'),
  verificarAtualizacao: () => ipcRenderer.invoke('atualizar:verificar'),
  instalarAtualizacao: () => ipcRenderer.invoke('atualizar:instalar'),
  aoMudarAtualizacao: (aoMudar) => {
    const ouvinte = (_evento, estado) => aoMudar(estado)
    ipcRenderer.on('atualizar:estado', ouvinte)
    return () => ipcRenderer.removeListener('atualizar:estado', ouvinte)
  },

  registrarLog: (texto) => ipcRenderer.send('log:registrar', texto),
  caminhoDoLog: () => ipcRenderer.invoke('log:caminho'),
  // Entrar numa sala dá a ela o próprio arquivo de registro; sair encerra as
  // medições.
  logSala: (rotulo) => ipcRenderer.invoke('log:sala', rotulo),
  logSaiu: () => ipcRenderer.invoke('log:saiu'),

  // --- configurações da tela de entrada ---
  lerConfig: () => ipcRenderer.invoke('config:ler'),
  gravarConfig: (config) => ipcRenderer.invoke('config:gravar', config),
  reiniciar: () => ipcRenderer.invoke('app:reiniciar'),

  ambiente: () => ipcRenderer.invoke('ambiente'),

  // --- forçar SDR (captura HDR convertida, addon nativo) ---
  sdrDisponivel: () => ipcRenderer.invoke('sdr:disponivel'),
  sdrIniciar: (opcoes) => ipcRenderer.invoke('sdr:iniciar', opcoes),
  sdrParar: () => ipcRenderer.invoke('sdr:parar'),
  // null desliga: os quadros que ainda chegarem são fechados aqui.
  // O callback recebe o quadro emprestado: tem que usar na hora, sem guardar.
  aoQuadroSdr: (callback) => { receberQuadroSdr = typeof callback === 'function' ? callback : null },
  // A captura parou sozinha (o Windows interrompeu, a resolução mudou).
  aoFimSdr: (callback) => {
    if (ouvinteFimSdr) ipcRenderer.removeListener('sdr:fim', ouvinteFimSdr)
    ouvinteFimSdr = (_evento, motivo) => callback(motivo)
    ipcRenderer.on('sdr:fim', ouvinteFimSdr)
  }
})
