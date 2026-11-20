// Ponte para o addon de captura de audio por processo.
//
// Tudo aqui e tolerante a ausencia: se o binario nao foi compilado, ou se o
// Windows for antigo demais, o app continua funcionando com o loopback normal.
// Nada neste arquivo pode derrubar o processo principal.

const path = require('node:path')
const fs = require('node:fs')

let modulo = null
let motivo = null
let tentou = false

function caminhosPossiveis () {
  const aqui = __dirname
  return [
    // Desenvolvimento.
    path.join(aqui, 'build', 'Release', 'captura_audio.node'),
    // Empacotado: binario nativo nao roda de dentro do asar, entao o
    // electron-builder o deixa em app.asar.unpacked (ver asarUnpack).
    path.join(aqui.replace('app.asar', 'app.asar.unpacked'), 'build', 'Release', 'captura_audio.node')
  ]
}

function carregar () {
  if (tentou) return
  tentou = true

  if (process.platform !== 'win32') {
    motivo = 'captura por processo só existe no Windows'
    return
  }

  for (const caminho of caminhosPossiveis()) {
    if (!fs.existsSync(caminho)) continue
    try {
      modulo = require(caminho)
      return
    } catch (erro) {
      motivo = erro.message
      return
    }
  }

  motivo = 'o addon nativo ainda não foi compilado (npm run nativo:compilar)'
}

// { ok: true } ou { ok: false, motivo }
function disponivel () {
  carregar()
  if (!modulo) return { ok: false, motivo }

  try {
    if (!modulo.suportado()) {
      return { ok: false, motivo: 'este Windows não tem captura por processo (precisa da versão 2004 ou maior)' }
    }
  } catch (erro) {
    return { ok: false, motivo: erro.message }
  }

  return { ok: true }
}

// Aplicativos com sessão de áudio no dispositivo padrão.
// Devolve [] em vez de estourar, porque isto alimenta uma lista na tela.
//
// As sessões vêm agrupadas por aplicativo: um app Chromium abre várias, e
// mostrar "Discord.exe" cinco vezes na lista só confunde.
function listarSessoes () {
  carregar()
  if (!modulo) return []

  let cruas = []
  try {
    cruas = modulo.listarSessoes()
  } catch (erro) {
    console.warn('[nativo] falha ao listar sessões:', erro.message)
    return []
  }

  const porAplicativo = new Map()

  for (const sessao of cruas) {
    const chave = sessao.raiz || sessao.pid
    const existente = porAplicativo.get(chave)

    if (!existente) {
      porAplicativo.set(chave, {
        pid: chave,          // a raiz é o que a exclusão deve mirar
        nome: sessao.nome,
        tocando: sessao.tocando,
        processos: 1,
        dispositivos: [sessao.dispositivo + (sessao.papeis ? ` [${sessao.papeis}]` : '')]
      })
      continue
    }

    // Se qualquer processo do app está tocando, o app está tocando.
    existente.tocando = existente.tocando || sessao.tocando
    existente.processos++

    const rotulo = sessao.dispositivo + (sessao.papeis ? ` [${sessao.papeis}]` : '')
    if (!existente.dispositivos.includes(rotulo)) existente.dispositivos.push(rotulo)
  }

  return [...porAplicativo.values()]
}

// O id de fonte do desktopCapturer no Windows vem como "window:<HWND>:<algo>".
// Daqui sai o PID, que e o que a captura de audio precisa.
function pidDaFonte (idDaFonte) {
  carregar()
  if (!modulo) return 0

  const partes = String(idDaFonte || '').split(':')
  if (partes[0] !== 'window') return 0

  const hwnd = Number(partes[1])
  if (!Number.isFinite(hwnd) || hwnd <= 0) return 0

  try {
    return modulo.pidDaJanela(hwnd)
  } catch (erro) {
    console.warn('[nativo] não consegui achar o processo da janela:', erro.message)
    return 0
  }
}

/**
 * Abre a captura.
 *
 * @param {object} opcoes
 * @param {number} opcoes.pid       processo alvo
 * @param {'excluir'|'incluir'} opcoes.modo
 *        'excluir' = tudo do sistema MENOS esse processo (para tirar o Discord)
 *        'incluir' = somente esse processo (para pegar só o jogo)
 * @param {(amostras: Float32Array) => void} opcoes.aoReceber
 *        chamado com blocos intercalados (esquerdo, direito, esquerdo, ...)
 */
function capturar ({ pid, modo = 'excluir', aoReceber }) {
  carregar()
  if (!modulo) throw new Error(motivo)

  // Ao EXCLUIR, mira sempre a raiz do aplicativo. O Discord (e qualquer app
  // Chromium) roda em varios processos, e a sessao de audio costuma pertencer
  // a um filho, e excluir so ele deixaria os irmaos tocando.
  let alvo = pid
  if (modo === 'excluir') {
    try {
      const raiz = modulo.raizDoAplicativo(pid)
      if (raiz) alvo = raiz
    } catch { /* sem raiz, usa o pid como veio */ }
  }

  const captura = new modulo.Captura({ pid: alvo, modo, aoReceber })

  return {
    formato: () => captura.formato(),
    descartados: () => captura.descartados(),
    parar: () => captura.parar()
  }
}

module.exports = { disponivel, listarSessoes, pidDaFonte, capturar }
