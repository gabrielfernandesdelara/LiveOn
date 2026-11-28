// Expulsar e banir (2.1.0, pedido do dono): o DONO da sala (quem criou) tira
// na hora; sem o dono na sala, os outros abrem uma votação, que passa com a
// maioria de quem está dentro (menos quem está sendo votado) em 60 s.
//
// - Expulsar: sai agora; com o código, pode voltar.
// - Banir: sai e a sala não aceita mais aquela identidade.
//
// A identidade na sala é um resumo do segredo de amigo com o código
// (identidadeNaSala): uma por sala, para uma sala não conseguir reconhecer a
// mesma pessoa em outra. É também o que faz o dono continuar dono ao voltar.
// Quem apaga os dados do app vira outra identidade e consegue entrar de novo:
// o dono aceitou isso (trocar o código junto foi oferecido e recusado).
//
// O servidor confere tudo (worker.js e signaling/server.js); a tela só
// esconde o que a pessoa não pode fazer.

'use strict'

async function identidadeNaSala (codigo) {
  const segredo = typeof segredoDosAmigos === 'function' ? segredoDosAmigos() : ''
  if (!segredo || !codigo) return ''
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`liveon-sala:${segredo}:${codigo}`))
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Dono na sala: so ele tira. Sem dono (saiu, ou sala de app antigo, que nao
// tem dono): qualquer um abre votacao.
function podeTirar () {
  return souDonoDaSala || !donoDaSala
}

function nomeNaSala (id) {
  if (id === meuId) return meuNome
  const pessoa = participantes.get(id)
  return pessoa ? pessoa.nome : 'alguém'
}

// --- o botao na lista de pessoas ----------------------------------------------

function criarBotaoTirar (pessoa) {
  const botao = document.createElement('button')
  botao.className = 'engrenagem tirar'
  botao.title = souDonoDaSala ? `Tirar ${pessoa.nome} da sala` : `Votar para tirar ${pessoa.nome} da sala`
  botao.appendChild(icone('opcoes'))
  botao.onclick = (evento) => {
    evento.stopPropagation()
    fecharPessoas()
    abrirRemocao(pessoa.id)
  }
  return botao
}

// A coroa ao lado do nome de quem e o dono.
function marcarDono (lugar, id) {
  if (!id || id !== donoDaSala) return
  const coroa = icone('coroa', 12)
  coroa.classList.add('coroa-dono')
  lugar.appendChild(coroa)
  lugar.title = (lugar.title || lugar.textContent) + ' (dono da sala)'
}

// --- a confirmacao ---------------------------------------------------------------

let remocaoAberta = null   // { id, acao }

function abrirRemocao (id) {
  if (!participantes.has(id)) return
  remocaoAberta = { id, acao: 'expulsar' }
  const nome = nomeNaSala(id)
  $('#titulo-remocao').textContent = souDonoDaSala ? `Tirar ${nome} da sala` : `Votação para tirar ${nome}`
  mostrarAcaoDaRemocao()
  $('#remocao').classList.remove('oculto')
}

function mostrarAcaoDaRemocao () {
  const { acao } = remocaoAberta
  for (const botao of document.querySelectorAll('#opcao-remocao button')) {
    botao.classList.toggle('ativo', botao.dataset.valor === acao)
  }
  const efeito = acao === 'banir'
    ? 'Sai agora e não consegue mais voltar nesta sala.'
    : 'Sai agora. Com o código, pode voltar.'
  $('#nota-remocao').textContent = souDonoDaSala
    ? efeito
    : `${efeito} Passa se a maioria da sala votar a favor em 60 s.`
  $('#btn-confirmar-remocao').textContent = souDonoDaSala
    ? (acao === 'banir' ? 'Banir' : 'Expulsar')
    : 'Começar votação'
}

function escolherAcaoDaRemocao (acao) {
  if (!remocaoAberta) return
  remocaoAberta.acao = acao === 'banir' ? 'banir' : 'expulsar'
  mostrarAcaoDaRemocao()
}

function fecharRemocao () {
  remocaoAberta = null
  $('#remocao').classList.add('oculto')
}

function remocaoEstaAberta () {
  return !$('#remocao').classList.contains('oculto')
}

function confirmarRemocao () {
  if (!remocaoAberta) return
  const { id, acao } = remocaoAberta
  fecharRemocao()
  if (!participantes.has(id)) return
  const banir = acao === 'banir'
  anotar(`${souDonoDaSala ? 'tirando' : 'votacao para tirar'} ${id.slice(0, 8)}${banir ? ' (banir)' : ''}`)
  enviar(souDonoDaSala
    ? { tipo: 'expulsar', alvo: id, banir }
    : { tipo: 'votar-expulsao', alvo: id, banir })
}

// --- votacao -------------------------------------------------------------------

// A votacao que esta na tela, para o som tocar so quando ela COMECA, e nao a
// cada voto contado.
let votacaoNaTela = ''

function mostrarVotacao (msg) {
  if (votacaoNaTela !== msg.alvo && msg.por !== meuId) tocarVotacao()
  votacaoNaTela = msg.alvo
  const alvo = nomeNaSala(msg.alvo)
  const acao = msg.banir ? 'banir' : 'expulsar'
  const titulo = msg.por === meuId ? `Votação para ${acao} ${alvo}` : `${nomeNaSala(msg.por)} quer ${acao} ${alvo}`
  const botoes = msg.meuVoto ? [] : [
    { texto: 'Não', acao: () => enviar({ tipo: 'voto', alvo: msg.alvo, sim: false }) },
    { texto: 'Sim', principal: true, acao: () => enviar({ tipo: 'voto', alvo: msg.alvo, sim: true }) }
  ]
  mostrarAviso({
    chave: 'votacao',
    amigo: { id: msg.alvo, nome: alvo, online: true },
    titulo,
    sub: `${msg.sim} de ${msg.precisa} votos`,
    validade: msg.restam,
    botoes
  })
}

function fimDaVotacao (msg) {
  votacaoNaTela = ''
  tirarAviso('votacao')
  const alvo = nomeNaSala(msg.alvo)
  const textos = {
    recusada: `A votação para tirar ${alvo} não passou.`,
    expirou: `A votação para tirar ${alvo} acabou sem maioria.`,
    dono: 'O dono da sala voltou, e a votação acabou.'
  }
  if (textos[msg.resultado]) avisoRapido({ id: 'votacao-' + msg.alvo, nome: alvo, online: true }, textos[msg.resultado])
}

// Alguem foi tirado (o 'saiu' traz removido): um aviso curto para os outros.
function avisarRemocao (id, nome, banido) {
  avisoRapido({ id: 'removido-' + id, nome, online: true }, `${nome} saiu da sala por ${banido ? 'banimento' : 'expulsão'}.`)
}

// Eu fui tirado: volta para a entrada com o aviso em ambar. O onclose do
// socket e desligado antes, senao ele chamaria voltarParaEntrada de novo e
// apagaria o aviso.
function fuiRemovido (banido) {
  anotar(banido ? 'fui banido da sala' : 'fui expulso da sala')
  tocarTiraramVoce()
  saindoDeProposito = true
  if (ws) {
    ws.onclose = null
    try { ws.close() } catch { /* ja fechando */ }
  }
  voltarParaEntrada()
  $('#entrada').classList.add('caiu')
  mostrarEstadoEntrada(banido ? 'Você não pode mais entrar nessa sala.' : 'Tiraram você da sala.')
}

function esquecerDonoDaSala () {
  donoDaSala = ''
  souDonoDaSala = false
  votacaoNaTela = ''
  fecharRemocao()
  tirarAviso('votacao')
}

// --- ligacoes ----------------------------------------------------------------------

for (const botao of document.querySelectorAll('#opcao-remocao button')) botao.onclick = () => escolherAcaoDaRemocao(botao.dataset.valor)
$('#btn-cancelar-remocao').onclick = fecharRemocao
$('#btn-confirmar-remocao').onclick = confirmarRemocao
$('#remocao').onclick = (evento) => { if (evento.target === $('#remocao')) fecharRemocao() }
