# Segurança

## Como reportar uma falha

**Não abra issue pública.** Uma falha descrita em público fica visível para
todo mundo antes de existir conserto.

Use o botão **Report a vulnerability**, na aba **Security** deste repositório.
O relato é privado: só o mantenedor vê.

Ajuda muito mandar:

- o que você fez, passo a passo;
- o que esperava que acontecesse, e o que aconteceu;
- a versão do app (aparece na barra de cima, dentro da sala);
- o trecho do log, se tiver. Fica em `%APPDATA%\liveon\liveon.log`, e o código
  da sala já sai mascarado nele.

## Versões cobertas

Só a última versão publicada. O app se atualiza sozinho, então o conserto de
uma falha sai como versão nova, e não como correção de versões antigas.

## Como o app se protege

- **O código da sala é a única chave.** São 12 caracteres sorteados com
  `crypto.getRandomValues`, uns 59 bits. Nunca é escolhido à mão, e o servidor
  recusa código com menos de 10 caracteres.
- **Tentativas limitadas**: 20 por minuto por IP no servidor, contadas antes de
  qualquer sala ser tocada.
- **Não existe lista de salas.** Nem rota pública, nem mensagem no protocolo.
- **A mídia é cifrada de ponta a ponta** pelo próprio WebRTC (DTLS-SRTP). O
  servidor repassa só a negociação, nunca vê vídeo nem áudio.
- **O servidor reescreve a origem de toda mensagem repassada.** Um participante
  não consegue se passar por outro.
- **O app roda isolado**: `contextIsolation` ligado, `sandbox` ligado,
  `nodeIntegration` desligado. A CSP só deixa o app conectar ao servidor dele e
  não executa script nem estilo escrito dentro do HTML: mesmo que algo consiga
  injetar código na página, ele não roda.
- **Dado vindo de outra pessoa nunca vira HTML.** Nome, nome da sala e mensagens
  de erro são sempre tratados como texto.
- **A janela nunca sai da página do app**, e o processo principal só responde a
  ela. Mesmo que alguma página de fora fosse parar na janela, ela não teria
  acesso à captura de tela, de áudio nem às miniaturas das janelas.
- **O executável não aceita ser usado como Node** (`ELECTRON_RUN_AS_NODE`,
  `NODE_OPTIONS`, `--inspect` desligados) e confere a integridade do próprio
  pacote ao abrir.
- **Dentro da sala também há limite**: mensagem acima de 64 KB é recusada, e
  mais de 300 em 10 segundos por conexão são cortadas.

## Limites conhecidos

Estes são conhecidos e aceitos, e estão explicados no README. Não precisa
reportar como falha nova, mas ideias para resolver são bem-vindas.

- **Quem está na sala vê o IP de todos.** A mídia vai direto entre os
  computadores, sem relay. Esconder isso exigiria um servidor TURN.
- **O código não pode ser revogado**, e não existe expulsar alguém. Para tirar
  uma pessoa, cria-se uma sala nova.
- **O instalador não é assinado.** O Windows mostra o aviso do SmartScreen. Só
  baixe o LiveOn dos
  [releases deste repositório](https://github.com/gabrielfernandesdelara/LiveOn/releases):
  uma cópia vinda de outro lugar pode ter sido alterada.
