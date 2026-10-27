// Ponte entre a UI e o processo principal. contextIsolation continua ligado:
// o renderer não enxerga ipcRenderer, só estas três funções.

const { contextBridge, ipcRenderer } = require('electron')

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

  ambiente: () => ipcRenderer.invoke('ambiente')
})
