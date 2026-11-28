// Configuração: servidores ICE, teto de bitrate, endereço da sinalização e o
// sorteio do código da sala.

'use strict'

// STUN publico resolve a maioria dos casos. O TURN NAO e opcional: sem ele,
// pares atras de NAT simetrico simplesmente nao conectam, e o sintoma parece
// bug de codigo. Preencher quando houver um servidor TURN.
//
// O STUN da Cloudflare fica junto do Google de proposito: o do Google atende
// numa porta incomum (19302), que roteador com "protecao contra conexao
// desconhecida" pode barrar, e sem STUN o PC nao descobre o proprio endereco
// publico e quase nenhum par consegue se achar. A 3478 e a porta padrao do
// STUN. E gratis e sem limite. Entrou na 1.5.8 por dois primos que so viam a
// tela de quem tinha roteador aberto, e que conseguiam assistir se entrassem
// por outro wifi e voltassem para o deles depois (20/11/2026).
//
// Desde a 2.1.1 (pedido do dono) a pessoa escolhe, na aba Desempenho: um
// servidor so, ou o automatico. Todos foram testados respondendo (candidato
// srflx) em 28/11/2026; o da Mozilla e o da Ekiga nao responderam e ficaram
// de fora. O da Nextcloud e o unico na porta 443, a mesma do HTTPS: passa
// por roteador que barra porta incomum.
const SERVIDORES_STUN = {
  cloudflare: { nome: 'Cloudflare', urls: ['stun:stun.cloudflare.com:3478'] },
  google: { nome: 'Google', urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  twilio: { nome: 'Twilio', urls: ['stun:global.stun.twilio.com:3478'] },
  nextcloud: { nome: 'Nextcloud (porta 443)', urls: ['stun:stun.nextcloud.com:443'] },
  sipgate: { nome: 'Sipgate', urls: ['stun:stun.sipgate.net:3478'] },
  blackberry: { nome: 'BlackBerry', urls: ['stun:stun.voip.blackberry.com:3478'] }
}

// O automatico usa quatro juntos, de donos e portas diferentes, e o WebRTC
// fica com o que responder. Quatro e nao todos: com cinco ou mais o Chromium
// avisa que a busca de caminho fica lenta.
const STUN_AUTOMATICO = [
  'stun:stun.cloudflare.com:3478',
  'stun:stun1.l.google.com:19302',
  'stun:global.stun.twilio.com:3478',
  'stun:stun.nextcloud.com:443'
]

function stunEscolhido () {
  const valor = typeof lembrar === 'function' ? lembrar('liveon:stun') : ''
  return SERVIDORES_STUN[valor] ? valor : 'auto'
}

// A configuracao de cada conexao nova (malha.js). O TURN, se um dia houver,
// entra aqui: { urls: 'turn:SEU-SERVIDOR:3478', username, credential }.
function iceDaVez () {
  const escolha = stunEscolhido()
  const urls = escolha === 'auto' ? STUN_AUTOMATICO : SERVIDORES_STUN[escolha].urls
  return { iceServers: [{ urls }], bundlePolicy: 'max-bundle' }
}

// Teto por par, a 30 fps. Em malha, quem transmite manda uma copia para CADA
// amigo, entao o teto de cada um e dividido pelo tamanho da plateia
// (FATOR_POR_PLATEIA).
//
// Subiu na 2.0.0: com 1080p em 5 Mbps, jogo com muito movimento a 55-60 fps
// nao cabia, o codificador descia para 720p e o WebRTC chamava isso de
// "falta de banda", com o upload medido do dono em 15,7 Mbps (registro de
// 23/11/2026). Quem segurava era este teto, nao a internet.
const BITRATE_POR_ALTURA = {
  360: 800000,
  480: 1400000,
  720: 3500000,
  1080: 8000000,
  1440: 14000000
}

// Quanto do teto cada amigo leva, pelo numero de amigos recebendo a tela
// (indice = plateia). Em 1080p60 o total fica em 12, 21,6, 25,2 e 26,4 Mbps
// para 1, 2, 3 e 4 amigos: abaixo dos ~30 que saturaram o upload de um amigo
// em 05/11/2026. O WebRTC ainda baixa sozinho cada par se a conexao nao
// aguentar; isto e so o maximo que ele pode pedir.
const FATOR_POR_PLATEIA = [1, 1, 0.9, 0.7, 0.55]

// O que ESTA maquina esta capturando. E o teto de verdade: ninguem recebe
// mais do que isso, por mais que peca.
let qualidadeLocal = { altura: 720, fps: 30 }

// Banda de envio escolhida na aba Desempenho (2.0.0, pedido do dono):
// automatica (a tabela acima) ou um LIMITE, em Mbps, que e o maximo TOTAL que
// a minha tela pode usar do upload, dividido entre quem assiste. E so teto:
// o que vale continua sendo o necessario pela tabela, e o limite so corta
// quando o necessario passaria dele ("mesmo escolhendo 50, so usa o que for
// necessario", dono). 0 = automatica, sem limite a mais.
const BANDAS_FIXAS = [10, 20, 30, 40, 50]

function bandaFixa () {
  const valor = typeof lembrar === 'function' ? Number(lembrar('liveon:banda')) : 0
  return BANDAS_FIXAS.includes(valor) ? valor : 0
}

// plateia: quantos amigos estao recebendo a minha tela agora.
function bitrateDe (altura, fps, plateia = 1) {

  const degraus = [360, 480, 720, 1080, 1440]
  const degrau = degraus.find((a) => a >= altura) || 1440
  // Mais quadros custam mais banda para a mesma nitidez: de 30 a 60 fps o
  // teto sobe ate 50%, de forma continua (antes era so com 60 EXATOS, e 55
  // ficava no teto de 30).
  const porFps = 1 + Math.max(0, Math.min(Number(fps) || 30, 60) - 30) / 60
  const porPlateia = FATOR_POR_PLATEIA[Math.min(Math.max(plateia, 1), FATOR_POR_PLATEIA.length - 1)]
  const necessario = Math.round(BITRATE_POR_ALTURA[degrau] * porFps * porPlateia)
  // Com limite escolhido, cada amigo leva o necessario, mas nunca mais que a
  // parte dele do limite.
  const limite = bandaFixa()
  if (!limite) return necessario
  return Math.min(necessario, Math.round((limite * 1000000) / Math.max(plateia, 1)))
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
