// Áudio por processo, pelo addon nativo: a captura vira trilha através de um
// AudioWorklet.

'use strict'

// O PCM nasce no processo principal e precisa virar uma MediaStreamTrack aqui.
// O caminho e: IPC -> AudioWorklet com fila -> MediaStreamDestination.

// Carregado como blob porque sob file:// o addModule nao consegue buscar
// arquivo local (o Chromium bloqueia por CORS). Dai o blob: no CSP.
const FONTE_WORKLET = `
class FilaDeAudio extends AudioWorkletProcessor {
  constructor () {
    super()
    this.fila = []
    this.posicao = 0
    this.pendentes = 0
    // Acima disso o audio esta atrasado demais para valer a pena guardar.
    this.limite = sampleRate * 2 * 0.4

    this.port.onmessage = (evento) => {
      this.fila.push(evento.data)
      this.pendentes += evento.data.length

      // Melhor cortar um pedaco do que acumular latencia para sempre.
      while (this.pendentes > this.limite && this.fila.length > 1) {
        const fora = this.fila.shift()
        this.pendentes -= (fora.length - this.posicao)
        this.posicao = 0
      }
    }
  }

  process (_entradas, saidas) {
    const saida = saidas[0]
    const esquerdo = saida[0]
    const direito = saida[1] || saida[0]

    for (let i = 0; i < esquerdo.length; i++) {
      if (this.fila.length === 0) {
        esquerdo[i] = 0
        direito[i] = 0
        continue
      }

      const bloco = this.fila[0]
      esquerdo[i] = bloco[this.posicao]
      direito[i] = bloco[this.posicao + 1]
      this.posicao += 2
      this.pendentes -= 2

      if (this.posicao >= bloco.length) {
        this.fila.shift()
        this.posicao = 0
      }
    }

    return true
  }
}

registerProcessor('fila-de-audio', FilaDeAudio)
`

let contextoAudio = null

let noFila = null

let noDestino = null

let cancelarEscutaAudio = null

// Abre a captura no processo alvo e devolve a trilha pronta para entrar na malha.
async function criarTrilhaDeProcesso (pid, modo) {
  const resposta = await window.ponte.audioIniciar(pid, modo)
  if (!resposta.ok) throw new Error(resposta.motivo)

  const taxa = resposta.formato.taxa || 48000

  // O contexto precisa nascer na mesma taxa da captura, senao teria que
  // reamostrar na mao.
  if (!contextoAudio || contextoAudio.sampleRate !== taxa) {
    if (contextoAudio) await contextoAudio.close()
    contextoAudio = new AudioContext({ sampleRate: taxa })

    const endereco = URL.createObjectURL(
      new Blob([FONTE_WORKLET], { type: 'text/javascript' })
    )
    try {
      await contextoAudio.audioWorklet.addModule(endereco)
    } finally {
      URL.revokeObjectURL(endereco)
    }
  }

  await contextoAudio.resume()

  noFila = new AudioWorkletNode(contextoAudio, 'fila-de-audio', {
    numberOfInputs: 0,
    outputChannelCount: [2]
  })
  noDestino = contextoAudio.createMediaStreamDestination()
  noFila.connect(noDestino)

  cancelarEscutaAudio = window.ponte.aoReceberAudio((amostras) => {
    // Transfere o buffer em vez de copiar: sao ~100 blocos por segundo.
    noFila.port.postMessage(amostras, [amostras.buffer])
  })

  return noDestino.stream.getAudioTracks()[0]
}

async function pararTrilhaDeProcesso () {
  if (cancelarEscutaAudio) {
    cancelarEscutaAudio()
    cancelarEscutaAudio = null
  }
  await window.ponte.audioParar()

  if (noFila) { noFila.disconnect(); noFila = null }
  if (noDestino) { noDestino.disconnect(); noDestino = null }
}
