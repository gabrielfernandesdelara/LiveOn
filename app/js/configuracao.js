// Configuração: servidores ICE, teto de bitrate, endereço da sinalização e o
// sorteio do código da sala.

'use strict'

// STUN publico resolve a maioria dos casos. O TURN NAO e opcional: sem ele,
// pares atras de NAT simetrico simplesmente nao conectam, e o sintoma parece
// bug de codigo. Preencher quando houver um servidor TURN.
const ICE = {
  iceServers: [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
    // { urls: 'turn:SEU-SERVIDOR:3478', username: 'usuario', credential: 'senha' }
  ],
  bundlePolicy: 'max-bundle'
}

// Teto por par. Em malha, quem transmite manda uma copia para CADA amigo:
// 4 amigos a 6 Mbps = 24 Mbps de upload. Este teto evita afogar a conexao.
// Acompanha a qualidade escolhida, nao faz sentido reservar 6 Mbps para 360p.
const BITRATE_POR_ALTURA = {
  360: 700000,
  480: 1200000,
  720: 2500000,
  1080: 5000000,
  1440: 9000000
}

// O que ESTA maquina esta capturando. E o teto de verdade: ninguem recebe
// mais do que isso, por mais que peca.
let qualidadeLocal = { altura: 720, fps: 30 }

function bitrateDe (altura, fps) {
  const degraus = [360, 480, 720, 1080, 1440]
  const degrau = degraus.find((a) => a >= altura) || 1440
  // 60 fps custa mais banda para a mesma nitidez.
  return Math.round(BITRATE_POR_ALTURA[degrau] * (fps === 60 ? 1.5 : 1))
}

// Sinalizacao hospedada. O app so fala com ela: nao existe mais servidor
// local nem endereco para o usuario digitar.
const SERVIDOR = 'wss://liveon.fiv3bullet.workers.dev'

// O codigo E a chave da sala: quem tem ele entra. Ele precisa ser sorteado,
// nao escolhido, gente escolhe "132", e "132" cai numa varredura em segundos.
//
// 12 caracteres de um alfabeto de 31 dao ~59 bits: com o limite de 20
// tentativas por minuto do servidor, varrer isso levaria mais tempo que a
// idade do universo. O alfabeto tira 0/o, 1/l e i, que sao os que as pessoas
// erram ao copiar da mensagem do Discord. Minusculo porque e o que sai do
// teclado sem apertar shift.
const ALFABETO = '23456789abcdefghjkmnpqrstuvwxyz'

const TAMANHO_DO_CODIGO = 12

// Math.random nao serve aqui: e previsivel. Chave tem que sair do gerador
// criptografico.
function gerarCodigo () {
  const bytes = new Uint32Array(TAMANHO_DO_CODIGO)
  crypto.getRandomValues(bytes)

  let codigo = ''
  for (const n of bytes) codigo += ALFABETO[n % ALFABETO.length]
  return codigo
}
