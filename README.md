# LiveOn

Compartilhamento de tela com áudio do sistema para um grupo pequeno de amigos.
App desktop em Electron, mídia P2P (malha).

Antes de usar, leia [o que cada um vê](#privacidade-o-que-cada-um-vê): numa
sala, quem está dentro aprende o seu IP.

## Como usar

O app fala com uma sinalização hospedada na Cloudflare. Ninguém hospeda nada,
ninguém precisa deixar o computador ligado, e firewall de entrada não importa:
todo mundo conecta **para fora**.

A tela de entrada tem duas abas:

| Aba | O que pede |
|---|---|
| **Criar** | seu nome e o nome da sala, o código é sorteado |
| **Entrar** | seu nome e o código |

O **código é a chave da sala**: quem tem ele entra, quem não tem não chega nem
a saber que ela existe. Por isso ele é **sorteado, não escolhido**, algo como
`j8tnaq9b5z5z`. Copie e mande para os seus amigos por onde vocês já
conversam. O **nome da sala** é só rótulo de exibição.

Não existe lista de salas abertas. Existiu, e foi removida: ela publicava o
nome e a lotação de todas as salas para qualquer um.

Nomes de participante não se repetem dentro da mesma sala.

Em desenvolvimento:

```bash
npm start
```

### Sinalização na Cloudflare (grátis, sempre no ar)

`nuvem/` traz a mesma sinalização rodando em Workers + Durable Objects. Com ela
ninguém precisa hospedar nada: a sala existe sozinha, todo mundo conecta **para
fora**, e firewall de entrada deixa de importar.

Cada sala é um Durable Object, nomeado pelo código dela, então o isolamento
entre salas sai de graça.

Publicar:

```bash
npx wrangler login
```

```bash
npm run nuvem:publicar
```

Sai um endereço `https://liveon.<seu-subdominio>.workers.dev`. O app não tem
campo para ele: o endereço é fixo, em dois lugares que precisam andar juntos.

- a constante `SERVIDOR`, em `app/js/configuracao.js`, que é para onde o app
  conecta;
- o `connect-src` da CSP, no topo do `app/index.html`, que é para onde ele
  **pode** conectar.

Trocar só o primeiro faz o app parar de conectar em sala nenhuma, sem mensagem
de erro: a CSP barra a conexão antes dela sair. Vale para quem fizer um fork e
publicar o próprio worker.

Para rodar localmente antes de publicar:

```bash
npm run nuvem
```

O código da sala vai no caminho do endereço (`/sala/<codigo>`): é por ele que o
Worker acha o Durable Object daquela sala.

**A batida de coração parte do cliente**, não do servidor. Na Cloudflare o
objeto hiberna entre mensagens: um ping vindo de lá o acordaria a cada ciclo,
enquanto um ping vindo do cliente é respondido pelo próprio runtime sem acordar
nada. É o que torna o plano gratuito viável.

## A grade de telas

O tamanho das telas é sempre calculado, nunca fixo, ninguém empurra ninguém
para fora da janela. Todas ficam em **16:9**: uma fonte 4:3 ou ultrawide entra
com barra preta, o que mantém a grade alinhada.

Nome e controles ficam **sobre o vídeo**, não numa barra separada, e nenhum
pixel de altura é gasto com interface. Do nome aparece só a inicial com o ponto
vermelho de "no ar"; o nome por extenso abre ao passar o mouse no card, junto
com os controles: **ajustes** daquela tela, **som** (a barra de volume abre na
vertical; clicar silencia), **expandir**, que preenche a janela, e **tela
cheia**.

Para destacar uma tela, **duplo clique** nela:

| Em foco | Layout |
|---|---|
| nenhuma | todas do mesmo tamanho, preenchendo a área |
| uma | ela grande, as outras numa coluna à direita |
| duas ou mais | elas lado a lado, as outras numa faixa embaixo |

Só quem está transmitindo ocupa espaço na grade. Para ver **todo mundo que está
na sala**, inclusive quem só assiste, existe o botão com os avatares na barra do
topo: ele abre uma lista por cima da grade, sem tirar espaço de ninguém. O ponto
vermelho é o mesmo dos cards, quem está no ar. Com uma tela expandida, clicar em
outra pessoa da lista troca a transmissão sem sair do destaque.

O **Esc** fecha em camadas: primeiro o diálogo aberto, depois a lista, e só
então sai do expandido ou da tela cheia.

Cada tela tem **volume próprio**, com o alto-falante silenciando e devolvendo o
nível anterior. O seu próprio card é sempre mudo, para não realimentar o áudio.

A faixa de miniaturas **encolhe para caber**: ela nunca esconde ninguém atrás de
uma rolagem. Quando as miniaturas ficam pequenas demais para comportar a barra
de volume, o som passa a sair só pela engrenagem, que também tem volume.

## Qualidade da transmissão

No seletor de fontes dá para escolher de **360p a 1440p**, em **30 ou 60 fps**.
O teto de bitrate acompanha a escolha, de ~0,7 Mbps em 360p30 até ~13,5 Mbps em
1440p60.

Vale lembrar da conta da malha: quem transmite manda **uma cópia para cada
amigo**. Em 1080p60 com quatro pessoas assistindo, são ~30 Mbps de upload. O
aviso embaixo do seletor mostra esse total.

### Cada um escolhe a qualidade que recebe

Na lista de pessoas, e no card, quem está transmitindo tem um botão de
**ajustes**. Ele abre um painel com **Resolução**, **Fps** e **Volume** daquela
pessoa, a qualidade com
que *você* recebe. Não muda o que ela transmite, nem o que os outros recebem.
Se alguém compartilha em 1440p60 e sua internet não dá conta, coloque 720p30 só
para você.

Resolução e fps são independentes: dá para pedir 30 fps mantendo a resolução
cheia, ou baixar a resolução mantendo 60 fps.

O rodapé do card ficou só com o volume, os dois controles moraram lá e não
cabiam junto com o resto. O volume aparece nos dois lugares e fica em sincronia.

Funciona porque a malha dá a cada amigo a sua própria conexão, e o codificador
fica do lado de quem transmite: o pedido viaja pela sinalização e vira
`scaleResolutionDownBy` naquele remetente específico. Medido com duas conexões
reais saindo de uma captura 1280x720: uma entregou 1280x720 e a outra 640x360 ao
mesmo tempo.

É um **teto, nunca um aumento**. Pedir 1440p de quem transmite em 720p continua
entregando 720p, não dá para inventar pixel que a captura não gerou.

### Quando a conexão cai

O cliente manda uma batida a cada 10s. Passando 30s sem receber nada, ele mesmo
derruba o socket em vez de esperar o navegador perceber, e tenta voltar 13
vezes, com espera dobrando de 1s até 10s, o que dá 105 segundos.

No `bemvindo` o servidor entrega uma **credencial**. É ela que faz quem volta
ser a mesma pessoa: o `id` é o mesmo, o próprio nome não barra a volta, e o
volume e a qualidade que os outros escolheram para você continuam valendo.

Se o registro antigo ainda estava de pé quando você voltou, ninguém na sala vê
nada, nem saída, nem entrada, e as conexões de vídeo **não são derrubadas**,
porque a mídia é P2P e não depende desse socket. Só quando a saída já tinha sido
anunciada é que a malha é remontada.

Do lado do servidor, um alarme confere a cada 20s e tira quem passou 45s sem dar
sinal. É a segunda linha contra "sala fantasma": sem ele, um socket que morre
sem avisar deixaria um membro eterno numa sala que nunca esvazia.

Quando todo mundo cai junto, a sala **não** morre com o último socket. A
conexão com a Cloudflare cai sozinha de tempos em tempos, e cai para todos ao
mesmo tempo; se a sala fosse apagada ali, quem voltasse um segundo depois ouviria
"código não corresponde a nenhuma sala aberta". Ela fica **dois minutos** de pé
vazia, mais do que os 105 segundos que o app passa tentando voltar. Passado isso
sem ninguém, o código é liberado: sem isso um código usado num teste antigo
ficaria preso para sempre.

### Segurança

O que protege a sala é o código, então ele carrega o peso todo:

- **Sorteado com `crypto.getRandomValues`**, nunca escolhido à mão: 12
  caracteres de um alfabeto de 31, ou ~59 bits. O alfabeto é minúsculo e sem
  `0`, `o`, `1`, `l` e `i`, são os que se erram ao copiar de uma mensagem. O
  servidor recusa qualquer código com menos de 10 caracteres, para o caso de
  alguém falar direto com ele.
- **Tentativas limitadas por origem**: 20 por minuto por IP, no Worker. Tem que
  ser por IP e não por sala, cada código errado cai num Durable Object
  diferente, então contar dentro da sala não veria varredura nenhuma. Antes
  disso, 60 códigos eram testados em 1,6 s sem nenhum freio.
- **Sem listagem de salas.** Nem rota pública, nem mensagem no protocolo.

A mídia é criptografada de ponta a ponta pelo próprio WebRTC (DTLS-SRTP, que
não é opcional) e vai direto de um par para o outro, o servidor nunca vê vídeo
nem áudio.

O que **não** está resolvido está na seção seguinte. Falhas se reportam em
particular, como diz o [SECURITY.md](SECURITY.md).

## Privacidade: o que cada um vê

**Quem está na sala vê o seu IP.** A imagem e o som vão direto de um
computador para o outro, sem passar por servidor, e para isso cada um precisa
saber o endereço dos outros: o IP público e o da sua rede local. Não é falha,
é o preço da mídia direta. Na prática:

- só entre em sala de quem você conhece;
- não passe o código adiante; quem tem o código entra, e ao entrar vê o IP de
  todo mundo.

Esconder o IP exigiria passar toda a mídia por um servidor de relay (TURN), o
que tem custo por gigabyte. Não está feito.

**O código é a única chave, e ela não se troca.** Não existe expulsar alguém,
banir, nem trocar o código de uma sala. Para tirar alguém, criem uma sala nova
e não mandem o código para essa pessoa.

**O que o servidor vê.** A sinalização roda na Cloudflare e vê o seu IP, o
nome que você escolheu, o código (ele é o endereço da sala) e quando você
entra e sai. **Não** vê vídeo nem áudio: a mídia é cifrada de ponta a ponta
pelo próprio WebRTC. Nada disso é guardado depois que a sala fecha.

**O que fica no seu computador.** Seu nome, a qualidade e a saída de áudio
escolhidas, e um log em `%APPDATA%\liveon\liveon.log` (mais a sessão anterior em
`liveon-anterior.log`). O log serve para depurar e tem nomes de quem esteve na
sala, mas o código sai mascarado, só os 4 primeiros caracteres: mandar o log
para alguém não entrega a entrada da sala.

## Áudio

Os modos oferecidos dependem do que você está compartilhando, "apenas esta
janela" não existe para um monitor, e "tudo menos um app" não faz sentido para
uma janela:

| Aba | Modos |
|---|---|
| **Telas** | *Tudo, menos o Discord* (dá para trocar qual app sai, no seletor ao lado) · *Sem áudio* |
| **Janelas** | *Apenas o áudio da janela* · *Sem áudio* |

Os dois primeiros dependem do addon nativo. **Sem ele compilado**, a lista
troca para *Todo o áudio do sistema* + *Sem áudio*, senão sobraria só "sem
áudio", ou seja, nenhuma forma de mandar som.

O modo padrão do Chromium (`audio: 'loopback'`) captura a mistura final da placa
de som, sem distinção de quem produziu. Isso cria um problema concreto: se você
conversa no Discord enquanto compartilha, **a voz dos seus amigos é capturada e
volta para eles em eco**. Foi por isso que os modos por aplicativo existem:
"Tudo, menos um aplicativo" com o Discord marcado resolve exatamente esse caso.

Os dois modos finos dependem do addon nativo (ver abaixo). Sem ele compilado, as
opções aparecem desabilitadas e o app continua funcionando com o loopback comum.

## O addon nativo

`nativo/` traz um módulo em C++ que usa a captura por processo do Windows
(`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`), disponível a partir do Windows
10 versão 2004. É o mesmo mecanismo que o Discord usa.

Compilar exige o **Visual Studio Build Tools** com a carga de trabalho C++:

```bash
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Depois:

```bash
npm run nativo:compilar
```

O script compila para a ABI do Electron, não para a do Node, são incompatíveis.
Ao atualizar o Electron, ajuste o `--target` no script e recompile.

O binário sai em `nativo/build/Release/` e é marcado como `asarUnpack`, porque
módulo nativo não carrega de dentro do `.asar`.

## Gerando os executáveis

```bash
npm run empacotar
```

Sai tudo em `dist/`:

- `LiveOn-<versão>-instalador.exe`, instalador de um clique: abre, instala na
  pasta do usuário (sem pedir administrador), cria os atalhos e já abre o app.
  Quem atualiza continua na pasta onde instalou da primeira vez.
- `win-unpacked/`, a pasta crua do app, útil para depurar o empacotamento.

Cada build deixa ~200 MB, então `empacotar` e `publicar` apagam os executáveis
de versões anteriores no fim, sem isso `dist/` vira um museu (chegou a 2,1 GB
com nove versões) e fica fácil mandar o `.exe` errado para um amigo. A limpeza
roda **depois** do build: build que falha no meio não leva junto o instalador
bom da versão anterior. As versões já publicadas continuam no GitHub Releases.

Para limpar na mão, sem empacotar:

```bash
npm run limpar
```

Para iterar rápido sem gerar instalador (bem mais veloz):

```bash
npm run empacotar:rapido
```

## Publicando uma versão (atualização automática)

Os instaladores vão para **`gabrielfernandesdelara/LiveOn`**, o mesmo
repositório público do código. Ele precisa ser público: em repositório privado
o `electron-updater` exigiria um token embutido no app, e esse token iria junto
para a máquina de cada amigo.

```bash
$env:GH_TOKEN="<token com Contents: Read and write no repositório>"
npm run publicar
```

Até a 1.3.1 os instaladores ficavam em `gabrielfernandesdelara/LiveOn-releases`.
A 1.3.1 é a versão de transição: sobe para os dois repositórios, e o primeiro
item de `build.publish` é o que vai gravado no app como lugar de procurar
atualização. Quem estava numa versão antiga acha a 1.3.1 no repositório
antigo e, a partir dela, passa a procurar no novo. Depois da 1.3.1 o
`LiveOn-releases` sai do `build.publish` e o repositório fica arquivado, não
apagado: quem passar meses sem abrir o app ainda precisa achar a transição lá.

Duas armadilhas que já custaram tempo:

- **`releaseType: "release"` no `package.json` é obrigatório.** Sem ele o
  electron-builder cria o release como *rascunho*, e rascunho é invisível para
  o atualizador, ninguém recebe a atualização e nada indica o porquê. O
  ajuste só vale na criação: um rascunho que já existe tem que ser publicado
  na mão.
- **O repositório de releases não pode estar vazio.** GitHub recusa publicar
  release em repositório sem nenhum commit ("You can't publish releases for an
  empty repository"). Vale para quem fizer um fork e apontar para um repositório
  novo.

Para conferir se um release está visível para os apps:

```bash
curl -sL https://github.com/gabrielfernandesdelara/LiveOn/releases/latest/download/latest.yml
```

Se isso devolver `Not Found`, o atualizador também não enxerga.

O app instalado procura versões novas no GitHub Releases, baixa em segundo plano
e oferece um botão para reiniciar já atualizado. Para publicar:

```bash
npx electron-builder --win --publish always
```

Precisa da variável de ambiente `GH_TOKEN` com um token que possa escrever nos
releases. Sobem o instalador, o `latest.yml` (o manifesto que os apps consultam)
e o `.blockmap`, que permite download diferencial, versões seguidas baixam só
alguns MB em vez dos 100 MB inteiros.

Onde publicar fica em `build.publish`, no `package.json`. **O repositório
apontado precisa ser público**, pelo mesmo motivo do token.

Não existe mais versão portátil: ela não conseguia se atualizar sozinha, e
numa sala onde todo mundo precisa falar o mesmo protocolo, quem ficasse para
trás sem perceber virava problema dos outros.

## Distribuindo para os amigos

Mande o `LiveOn-<versão>-instalador.exe` mais recente de `dist/`.

**Aviso importante:** o executável não é assinado digitalmente, então o Windows
vai mostrar a tela azul do SmartScreen dizendo "O Windows protegeu o seu PC".
Não é vírus nem erro, é só a ausência de certificado. Para prosseguir: clicar em
**Mais informações** e depois em **Executar assim mesmo**. Vale avisar isso no
grupo antes, senão alguém vai achar que o arquivo está infectado.

Assinar custaria uns US$200/ano em certificado. Para cinco amigos, não compensa.

## Estrutura

```
app/
  main.js          Processo principal: janela, IPC das fontes, handler do loopback.
  preload.js       Ponte com contextIsolation ligado.
  index.html       Só a estrutura da tela e a CSP.
  estilo.css       Toda a aparência.
  fontes/          Sora, só para o logotipo (licença OFL ao lado).
  js/              O cliente, um arquivo por assunto, carregados nesta ordem:
    configuracao.js  ICE, bitrate, endereço do servidor, sorteio do código.
    estado.js        Estado global, preferências guardadas, registro em arquivo.
    icones.js        Ícones de traço e a marca, num lugar só.
    tema.js          Tema de cores (as paletas estão no estilo.css).
    sinalizacao.js   Conversa com o servidor da sala e reconexão.
    malha.js         Uma conexão WebRTC por par e o teto de qualidade.
    audio-nativo.js  Áudio por processo, do addon até virar trilha.
    transmissao.js   Captura de tela: começar, ajustar no ar, parar.
    seletor.js       Escolha de tela ou janela, qualidade e áudio.
    grade.js         Os cards e o cálculo do tamanho deles.
    destaque.js      Foco com duplo clique, expandido e tela cheia.
    som.js           Aviso de entrada, volume por pessoa, saída de áudio.
    ajustes.js       O que eu recebo de cada pessoa.
    pessoas.js       O botão com avatares e a lista de quem está na sala.
    navegacao.js     Entrada, sala e avisos na tela.
    ligacoes.js      Botões e campos ligados às funções.
    partida.js       O que roda uma vez, quando o app abre.
nuvem/
  src/worker.js    Sinalização: Worker + Durable Object, uma sala por código.
nativo/
  src/…            Addon C++: captura de áudio por processo.
  indice.js        Ponte tolerante, se não estiver compilado, o app segue sem.
scripts/
  limpar-dist.js   Apaga de dist/ os executáveis de versões antigas.
build/
  icon.png         Ícone do app (512x512). Ativo estático.
dist/              Saída do empacotamento. Ignorado pelo Git.
```

`build/` é a pasta que o electron-builder trata como dele (`buildResources`): só
entra ali recurso de empacotamento. Para trocar o ícone, basta substituir o
`icon.png` por outro de 512x512, a conversão para `.ico` é automática.
