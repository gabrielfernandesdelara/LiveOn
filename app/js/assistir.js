// Telas que entram no ar: assistir na hora ou com um clique, e com o som
// ligado ou mudo. As duas escolhas são da aba Aparência (1.6.1, a pedido do
// dono).
//
// "Com um clique" não só esconde a tela: quem assiste avisa quem transmite
// (campo `assistindo` do pedido de qualidade) e o envio PARA ele é desligado
// (`active: false` no remetente daquele par, em aplicarQualidade). Em malha
// cada amigo é uma cópia a mais no upload de quem transmite, então quem não
// está olhando deixa de custar banda. Não precisou de mudança no servidor: o
// pedido de qualidade já é repassado inteiro. Quem transmite com app antigo
// ignora o campo e continua mandando; aí a tela só fica escondida e muda.
//
// A decisão vale por TRANSMISSÃO: quando a pessoa sai do ar e volta, é uma
// tela nova, e no modo "com um clique" pede clique de novo.

'use strict'

let modoAssistir = lembrar('liveon:assistir') === 'clique' ? 'clique' : 'auto'
let somDasNovas = lembrar('liveon:som-novo') === 'mudo' ? 'mudo' : 'ligado'

// Quem eu estou assistindo agora, e de quem eu ja decidi a transmissao atual
// (para uma reconexao nao decidir de novo e desfazer o clique).
const assistindo = new Set()
const telasDecididas = new Set()

function estouAssistindo (id) {
  return assistindo.has(id)
}

function definirModoAssistir (modo) {
  modoAssistir = modo === 'clique' ? 'clique' : 'auto'
  guardar('liveon:assistir', modoAssistir)
  marcarAparencia()
}

function definirSomDasNovas (modo) {
  somDasNovas = modo === 'mudo' ? 'mudo' : 'ligado'
  guardar('liveon:som-novo', somDasNovas)
  marcarAparencia()
}

// Alguem entrou no ar com a TELA, ou ja estava quando eu entrei. Na
// reconexao (a mesma transmissao de antes) so reafirma o que ja tinha sido
// decidido: a conexao do outro lado pode ser nova e nao saber.
function aoAbrirTela (id) {
  if (telasDecididas.has(id)) return pedirQualidade(id)
  telasDecididas.add(id)

  if (modoAssistir === 'auto') assistindo.add(id)
  else assistindo.delete(id)
  pedirQualidade(id)

  // O som da tela nova. Mudo guarda o volume de antes, para o clique no
  // alto-falante devolver; ligado tira o mudo que tivesse ficado da vez
  // anterior, mas respeita um volume escolhido (40% continua 40%).
  const atual = volumeDe(id)
  if (somDasNovas === 'mudo') {
    if (atual > 0) volumeAntesDeMudo.set(id, atual)
    volumePorId.set(id, 0)
  } else if (atual === 0) {
    volumePorId.set(id, volumeAntesDeMudo.get(id) || 100)
  }
  aplicarVolume(id, volumeDe(id))

  anotar(`${id.slice(0, 8)} abriu a tela: ${assistindo.has(id) ? 'assistindo' : 'esperando o clique'}, som ${volumeDe(id) ? 'ligado' : 'mudo'}`)
  atualizarConvite(id)
}

function aoFecharTela (id) {
  assistindo.delete(id)
  telasDecididas.delete(id)
}

function assistir (id) {
  assistindo.add(id)
  pedirQualidade(id)
  anotar(`comecei a assistir ${id.slice(0, 8)}`)
  atualizarConvite(id)
  aplicarVolume(id, volumeDe(id))
  aplicarVideo(id)
}

// O card de quem esta com a tela no ar e eu ainda nao cliquei: o convite por
// cima, o video escondido e mudo (aplicarVolume tambem respeita isso).
function atualizarConvite (id) {
  const card = cardDe(id)
  if (!card || card.classList.contains('eu')) return
  const pessoa = participantes.get(id)
  const aguardando = Boolean(pessoa && pessoa.transmitindo) && telasDecididas.has(id) && !assistindo.has(id)
  card.classList.toggle('aguardando', aguardando)
  const video = card.querySelector('video')
  if (video && aguardando) video.muted = true
}

function esquecerTelas () {
  assistindo.clear()
  telasDecididas.clear()
}
