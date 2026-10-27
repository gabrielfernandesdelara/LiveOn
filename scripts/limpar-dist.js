// Apaga de dist/ os executaveis que nao sao da versao atual.
//
// Cada build deixa ~100 MB de instalador (ate a 1.3.0 eram ~200, com o
// portatil, que o padrao abaixo continua reconhecendo). Sem isso, dist/ vira um
// museu: chegou a 2,1 GB com nove versoes, e ainda dava para mandar o .exe
// errado para um amigo sem perceber.
//
// Roda DEPOIS do empacotamento, nao antes: build que falha no meio nao pode
// levar junto o instalador bom da versao anterior.
//
// As versoes ja publicadas continuam no GitHub Releases, nada aqui e a
// unica copia de nada.

const fs = require('node:fs')
const path = require('node:path')

const raiz = path.join(__dirname, '..')
const dist = path.join(raiz, 'dist')
const versao = require(path.join(raiz, 'package.json')).version

// LiveOn-<versao>-<instalador|portatil>.exe, com ou sem .blockmap
const PADRAO = /^LiveOn-(.+?)-(instalador|portatil)\.exe(\.blockmap)?$/

if (!fs.existsSync(dist)) {
  console.log('dist/ nao existe, nada a limpar')
  process.exit(0)
}

let apagados = 0
let bytes = 0

for (const nome of fs.readdirSync(dist)) {
  const casa = PADRAO.exec(nome)
  if (!casa || casa[1] === versao) continue

  const alvo = path.join(dist, nome)
  try {
    bytes += fs.statSync(alvo).size
    fs.unlinkSync(alvo)
    apagados++
  } catch (erro) {
    // Arquivo em uso (antivirus, Explorer aberto) nao pode derrubar o build.
    console.warn(`  nao consegui apagar ${nome}: ${erro.message}`)
  }
}

console.log(apagados === 0
  ? `dist/ ja tinha so a ${versao}`
  : `dist/: ${apagados} arquivo(s) de versoes antigas apagados, ${(bytes / 1e9).toFixed(2)} GB liberados`)
