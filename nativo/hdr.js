// Ponte para os dois addons de HDR:
//
// - cor_tela.node: lê o HDR de cada monitor (vai para o topo do registro e
//   decide se o "Forçar SDR" aparece).
// - captura_hdr.node: o "Forçar SDR", captura o monitor em 16 bits e converte
//   para SDR na placa de vídeo (ver nativo/src/captura_hdr.cc).
//
// Tolerante a ausência como o indice.js do áudio: sem os binários, ou fora do
// Windows, a lista vem vazia, a opção não aparece e o app segue igual. Nada
// aqui pode derrubar o processo principal.

const path = require('node:path')
const fs = require('node:fs')

const carregados = new Map()

function carregar (nome) {
  if (carregados.has(nome)) return carregados.get(nome)
  let modulo = null
  if (process.platform === 'win32') {
    const aqui = __dirname
    const caminhos = [
      path.join(aqui, 'build', 'Release', nome + '.node'),
      // Empacotado: binário nativo não roda de dentro do asar.
      path.join(aqui.replace('app.asar', 'app.asar.unpacked'), 'build', 'Release', nome + '.node')
    ]
    for (const caminho of caminhos) {
      if (!fs.existsSync(caminho)) continue
      try {
        modulo = require(caminho)
      } catch (erro) {
        console.warn(`[hdr] ${nome} não carregou:`, erro.message)
      }
      break
    }
  }
  carregados.set(nome, modulo)
  return modulo
}

function disponivel () {
  return Boolean(carregar('cor_tela'))
}

// [{ caminho, nome, suportado, ligado }]. [] se não deu para ler.
function listar () {
  const modulo = carregar('cor_tela')
  if (!modulo) return []
  try {
    return modulo.listar()
  } catch (erro) {
    console.warn('[hdr] não consegui listar os monitores:', erro.message)
    return []
  }
}

function capturaDisponivel () {
  return Boolean(carregar('captura_hdr'))
}

// Estoura com a mensagem do addon; quem chama decide o que fazer.
function iniciarCaptura (opcoes, aviso) {
  const modulo = carregar('captura_hdr')
  if (!modulo) throw new Error('o addon de captura HDR não está compilado')
  return modulo.iniciar(opcoes, aviso)
}

function liberarQuadro (k) {
  const modulo = carregar('captura_hdr')
  if (modulo) modulo.liberar(k)
}

function pararCaptura () {
  const modulo = carregar('captura_hdr')
  if (!modulo) return {}
  try {
    return modulo.parar()
  } catch (erro) {
    console.warn('[hdr] não consegui parar a captura:', erro.message)
    return {}
  }
}

module.exports = { disponivel, listar, capturaDisponivel, iniciarCaptura, liberarQuadro, pararCaptura }
