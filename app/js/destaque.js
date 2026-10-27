// Foco com duplo clique, modo expandido e tela cheia.

'use strict'

// --- tela cheia --------------------------------------------------------------

let idTelaCheia = null

// Se a janela do sistema acompanha o destaque. false = expandido, a
// transmissao toma a area do app mas a janela continua janela.
let janelaAcompanha = false

// Os dois destaques compartilham o mesmo estado. O que muda e se a janela do
// sistema vai junto, entao nao existe um quinto modo de grade para manter.
async function destacar (id, comJanela) {
  const sair = idTelaCheia === id && janelaAcompanha === comJanela

  if (sair) return sairDoDestaque()

  idTelaCheia = id
  janelaAcompanha = comJanela
  await window.ponte.telaCheia(comJanela)
  organizarGrade()
}

// Pelos botoes do card, o pop-over de pessoas fecha. Pela propria lista ele
// fica aberto, para dar para ir trocando de transmissao de uma em uma.
const expandir = (id) => {
  fecharPessoas()
  return destacar(id, false)
}

const alternarTelaCheia = (id) => {
  fecharPessoas()
  return destacar(id, true)
}

async function sairDoDestaque () {
  if (!idTelaCheia) return
  idTelaCheia = null
  janelaAcompanha = false
  await window.ponte.telaCheia(false)
  organizarGrade()
}

// Nome antigo, mantido porque o Esc e a saida da janela do sistema chamam.
const sairDaTelaCheia = sairDoDestaque

// O Esc fecha em camadas, de cima para baixo: primeiro o diálogo aberto,
// depois o pop-over de pessoas, e só então sai do expandido ou da tela cheia.
// Um Esc que fizesse tudo de uma vez tiraria a pessoa da tela cheia só por ela
// querer fechar a janela de volume.
document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Escape') return
  if (fecharDialogo()) return
  if (pessoasAbertas()) return fecharPessoas()
  sairDaTelaCheia()
})

// A janela pode sair da tela cheia por fora (F11, atalho do sistema).
//
// O guarda existe porque isto roda no topo do script: se a ponte nao tiver a
// funcao, a excecao mataria TODO o resto, inclusive as ligacoes dos botoes,
// que ficariam mortos sem erro visivel.
if (window.ponte && window.ponte.aoMudarTelaCheia) {
  window.ponte.aoMudarTelaCheia((ligada) => {
    // So desfaz se o destaque dependia da janela: no expandido a janela
    // nunca esteve cheia, e um F11 do usuario nao tem nada a ver com ele.
    if (!ligada && idTelaCheia && janelaAcompanha) {
      idTelaCheia = null
      janelaAcompanha = false
      organizarGrade()
    }
  })
}

// --- foco --------------------------------------------------------------------

function alternarFoco (id) {
  if (focados.has(id)) focados.delete(id)
  else focados.add(id)
  organizarGrade()
}
