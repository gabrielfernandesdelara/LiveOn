// Link da sala (2.1.0, pedido do dono): o codigo vira um link para colar no
// Discord. Quem clica cai na pagina do Worker (nuvem/src/pagina.js), que
// abre o LiveOn pelo liveon://sala/<codigo>, ou oferece baixar.
//
// O codigo vai depois do "#": essa parte nunca sai do navegador de quem
// clica, entao nem o Worker nem a previa do Discord ficam sabendo dele.
// Colar o link no campo da entrada tambem funciona: o codigo e achado no
// meio do texto (codigoNaMensagem).

'use strict'

const PAGINA_DO_LINK = SERVIDOR.replace(/^ws/, 'http') + '/entrar#'

function linkDaSala (codigo) {
  return PAGINA_DO_LINK + codigo
}

function copiarLinkDaSala () {
  if (sessao && sessao.codigo) copiarCodigo(linkDaSala(sessao.codigo), $('#btn-copiar-link'))
}

// Chegou um link (main.js): na entrada, entra direto; ja numa sala, pergunta
// antes de trocar. Sem nome ainda (primeira vez), o codigo fica no campo para
// depois do Continuar.
function abrirSalaDoLink (texto) {
  const codigo = String(texto || '').trim().toLowerCase()
  if (!/^[a-z0-9]{10,60}$/.test(codigo)) return
  if (meuId && sessao && sessao.codigo === codigo) return
  if (meuId) {
    return mostrarAviso({
      chave: 'link',
      amigo: { id: 'link', nome: 'LiveOn', online: true },
      titulo: 'Entrar na sala do link?',
      sub: 'Você sai desta sala.',
      validade: 30000,
      botoes: [
        { texto: 'Agora não', acao: () => {} },
        { texto: 'Entrar', principal: true, acao: () => entrarComCodigoDeAmigo(codigo) }
      ]
    })
  }
  if (!meuNomeSalvo()) {
    $('#campo-codigo').value = codigo
    return
  }
  definirModo('entrar')
  entrarComCodigoDeAmigo(codigo)
}

$('#btn-copiar-link').onclick = copiarLinkDaSala

// Guardado: a ponte pode nao ter a funcao (ver "Chamada de topo na ponte").
if (window.ponte && window.ponte.aoAbrirSala) window.ponte.aoAbrirSala(abrirSalaDoLink)
