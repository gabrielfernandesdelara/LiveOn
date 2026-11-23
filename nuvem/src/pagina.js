// A página do link da sala (2.1.0, pedido do dono): o código colado no
// Discord vira um link que abre a sala no LiveOn.
//
// O Discord só deixa clicar em https, e não em liveon://, então o link é
// https://<worker>/entrar#<codigo> e esta página passa a bola para o app.
//
// O código vai depois do "#": o navegador NUNCA manda essa parte para
// servidor nenhum. A Cloudflare não vê, o log não guarda, e o robô do Discord
// que monta a prévia do link também não: a prévia é igual para toda sala.
//
// A página não tem nada de fora: estilo e script na própria página, e a CSP
// dela não deixa carregar mais nada.

const BAIXAR = 'https://github.com/gabrielfernandesdelara/LiveOn/releases/latest'

const HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LiveOn: entrar na sala</title>
<meta property="og:title" content="Entrar numa sala do LiveOn">
<meta property="og:description" content="Clique para abrir a sala no LiveOn.">
<meta name="theme-color" content="#4f8cff">
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: #0e1013; color: #e7eaf0;
    font: 15px/1.5 "Segoe UI", system-ui, sans-serif;
  }
  main { width: min(380px, 100%); display: flex; flex-direction: column; align-items: center; text-align: center; }
  .marca { width: 64px; height: 64px; border-radius: 16px; background: #4f8cff; display: grid; place-items: center; }
  h1 { margin: 20px 0 4px; font-size: 22px; font-weight: 600; }
  p { margin: 0; color: #8b93a4; }
  .botoes { width: 100%; display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
  a.botao {
    display: flex; align-items: center; justify-content: center; height: 44px; border-radius: 10px;
    text-decoration: none; font-weight: 600; color: #fff; background: #4f8cff;
  }
  a.botao:hover { background: #3d7bf0; }
  a.botao.secundario { background: #1d2128; color: #e7eaf0; border: 1px solid #262b35; font-weight: 500; }
  a.botao.secundario:hover { background: #242932; }
  .erro { color: #ffcf8b; }
  .oculto { display: none; }
</style>
</head>
<body>
<main>
  <div class="marca" aria-hidden="true">
    <svg width="36" height="36" viewBox="0 0 48 48">
      <rect x="5" y="9" width="34" height="26" rx="6" fill="none" stroke="#fff" stroke-width="4"/>
      <path d="M15 41h14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
      <circle cx="39" cy="11" r="7.5" fill="#4f8cff"/>
      <circle cx="39" cy="11" r="4.5" fill="#ff4d4f"/>
    </svg>
  </div>
  <h1 id="titulo">Abrindo a sala no LiveOn</h1>
  <p id="texto">Se o LiveOn não abrir sozinho, clique no botão.</p>
  <div class="botoes">
    <a id="abrir" class="botao" href="#">Abrir no LiveOn</a>
    <a class="botao secundario" href="${BAIXAR}" rel="noopener">Ainda não tem o LiveOn? Baixar</a>
  </div>
</main>
<script>
  // Mesmo alfabeto do codigo sorteado pelo app; qualquer outra coisa e link
  // quebrado, e nada vai para o liveon://.
  var codigo = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase()
  if (/^[a-z0-9]{10,60}$/.test(codigo)) {
    var destino = 'liveon://sala/' + codigo
    document.getElementById('abrir').href = destino
    location.href = destino
  } else {
    document.getElementById('titulo').textContent = 'Link incompleto'
    var texto = document.getElementById('texto')
    texto.textContent = 'Peça o link da sala de novo.'
    texto.className = 'erro'
    document.getElementById('abrir').className = 'oculto'
  }
</script>
</body>
</html>`

export function paginaDeEntrar () {
  return new Response(HTML, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'cache-control': 'public, max-age=3600'
    }
  })
}
