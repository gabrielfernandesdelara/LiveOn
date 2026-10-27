// Tema de cores: troca só os neutros (fundos, bordas, textos). O azul e o
// vermelho de "no ar" são os mesmos em todos.

'use strict'

// As paletas moram no estilo.css, uma por :root[data-tema="..."]. Ainda não
// existe um lugar na interface para escolher: foi pedido deixar os temas no
// projeto e decidir depois onde fica a opção. Quando ela vier, é só chamar
// aplicarTema() com o escolhido; a escolha já fica guardada.
const TEMAS = ['grafite', 'marinho', 'carvao', 'preto']

function aplicarTema (nome) {
  const tema = TEMAS.includes(nome) ? nome : 'grafite'
  document.documentElement.dataset.tema = tema
  guardar('liveon:tema', tema)
  return tema
}
