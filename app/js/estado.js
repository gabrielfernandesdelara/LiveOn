// Estado global do cliente, preferências guardadas e o registro em arquivo.

'use strict'

let ws = null

let meuId = null

let meuNome = ''

let streamLocal = null

// 'criar' abre uma sala nova; 'entrar' usa nome + codigo; 'buscar' lista.
// Entrar na frente de criar: na prática uma sala é criada uma vez e todo mundo
// entra nela, então o caminho comum tem que ser o que já está aberto.
let modo = 'entrar'

let rotuloDaSala = ''

// Reconexao. Guardo os dados da sessao para conseguir voltar sozinho.
let sessao = null

let saindoDeProposito = false

// Entre abrir o socket e receber o 'bemvindo'. Um erro nessa janela e fatal:
// sem ele, o socket ficava aberto para sempre sem nunca entrar na sala.
let aguardandoEntrada = false

let tentativasDeReconexao = 0

let temporizadorReconexao = null

let vigiaSilencio = null

let batidaDoCliente = null

let ultimaMensagem = 0

// Quantas vezes insistir antes de despejar a pessoa na tela inicial. A espera
// cresce (1, 2, 4, 8, depois 10 em 10), entao 13 tentativas = 105 segundos.
//
// Este numero anda junto com a CARENCIA_VAZIA do servidor, que e 120s: e o
// tempo que a sala fica de pe esperando todo mundo voltar de uma queda.
// Desistir antes disso era jogar fora sala que ainda existia, era o que
// acontecia com 8 tentativas (55s). Passar de 120s tambem nao adianta: depois
// da carencia nao ha mais sala para encontrar. Mexeu num, confira o outro.
const MAX_TENTATIVAS = 13

// O servidor manda ping a cada 15s. Passou disso sem NADA chegar, o link
// morreu, mesmo que o navegador ainda ache que o socket esta aberto.
// Foi exatamente esse buraco que deixou um amigo numa sala fantasma.
// 30s = tres batidas perdidas. Foi 50s, o que deixava a sala congelada por
// quase um minuto antes de qualquer aviso. Da para ser agressivo agora que
// reconectar e barato: com a credencial, quem volta rapido nem e visto saindo.
const SILENCIO_LIMITE = 30000

// Quanto esperar antes de apagar um video que emudeceu. O aviso de "parei de
// transmitir" chega pela sala e limpa na hora; isto aqui e so a rede de
// seguranca para quando ele nao chega, e por isso pode ser paciente.
const ESPERA_ANTES_DE_LIMPAR = 3000

// id -> { pc, polido, fazendoOferta, ignorandoOferta, remetentes }
const pares = new Map()

// id -> MediaStream de quem esta transmitindo. Existe porque o video pode
// chegar ANTES do aviso de "estou no ar": os dois caminhos sao independentes,
// e sem guardar aqui o stream se perderia quando o card ainda nao existe.
const streamsRecebidos = new Map()

// O que EU escolhi receber de cada um. So minha: nao mexe no que os outros
// recebem, nem no que a pessoa esta transmitindo. Zero em qualquer um dos dois
// significa "como vier", resolucao e fps sao escolhidos separado.
const qualidadePorId = new Map()   // id -> { altura, fps }

// Volume por pessoa. Fica aqui, e nao so no <input> do card, porque o card e
// destruido quando a pessoa para de transmitir, antes o volume voltava para
// 100 sozinho. E tambem porque o painel de ajustes mostra o mesmo valor.
const volumePorId = new Map()      // id -> 0..100

const volumeAntesDeMudo = new Map()

// De quem e o painel de ajustes aberto agora.
let ajustesAbertos = null

// id -> { id, nome, transmitindo }   (so os outros; eu tenho card a parte)
const participantes = new Map()

const $ = (sel) => document.querySelector(sel)

// localStorage pode falhar (armazenamento bloqueado, disco cheio, contexto
// sem permissao). Guardar preferencia nao pode derrubar o botao que o usuario
// acabou de clicar, dai os dois envelopes.
function guardar (chave, valor) {
  try { localStorage.setItem(chave, valor) } catch { /* preferencia e enfeite */ }
}

function lembrar (chave, padrao = '') {
  try { return localStorage.getItem(chave) || padrao } catch { return padrao }
}

// Tudo que interessa para depois vai para o arquivo de log do processo
// principal. Bug que so aparece com dois participantes nao da para caçar
// olhando o console, no app empacotado nao existe console.
function anotar (texto) {
  console.log('[liveon]', texto)
  try { window.ponte.registrarLog(texto) } catch { /* ponte ainda nao subiu */ }
}

window.addEventListener('error', (evento) => {
  anotar(`ERRO: ${evento.message} @ ${evento.filename}:${evento.lineno}`)
})

window.addEventListener('unhandledrejection', (evento) => {
  anotar(`PROMESSA REJEITADA: ${evento.reason && evento.reason.message ? evento.reason.message : evento.reason}`)
})
