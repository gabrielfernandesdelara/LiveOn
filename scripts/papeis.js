// Gera os papeis de parede prontos do LiveOn (app/papeis/*.webp), que
// aparecem no editor de tema para quem nao quiser escolher uma imagem propria.
// Sao desenhados aqui, com canvas, e nao baixados de lugar nenhum: sao do
// LiveOn, e regerar da sempre a mesma imagem (o sorteio tem semente fixa).
//
// Roda com: npx electron scripts/papeis.js
// Nao abre nada na tela: a janela e escondida e offscreen.

const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

const DESTINO = path.join(__dirname, '..', 'app', 'papeis')

// Roda DENTRO da pagina: cada funcao desenha um papel num canvas 1920x1080.
const DESENHOS = String.raw`
const L = 1920, A = 1080
function sorteio (semente) {
  let s = semente >>> 0
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function novo () { const c = document.createElement('canvas'); c.width = L; c.height = A; return c }
function ceu (ctx, paradas) {
  const g = ctx.createLinearGradient(0, 0, 0, A)
  paradas.forEach(([p, cor]) => g.addColorStop(p, cor))
  ctx.fillStyle = g; ctx.fillRect(0, 0, L, A)
}
function estrelas (ctx, r, n, alturaMax) {
  for (let i = 0; i < n; i++) {
    const x = r() * L, y = r() * alturaMax, raio = r() * 1.3 + 0.2
    ctx.fillStyle = 'rgba(255,255,255,' + (0.25 + r() * 0.6) + ')'
    ctx.beginPath(); ctx.arc(x, y, raio, 0, Math.PI * 2); ctx.fill()
  }
}
// Uma crista de montanha: ruido somado em varias escalas.
function crista (r, base, amplitude, passos) {
  const fases = [0, 1, 2, 3].map(() => r() * 1000)
  const pts = []
  for (let i = 0; i <= passos; i++) {
    const x = (i / passos) * L
    let y = 0
    y += Math.sin(x / 520 + fases[0]) * 0.5
    y += Math.sin(x / 210 + fases[1]) * 0.28
    y += Math.sin(x / 90 + fases[2]) * 0.14
    y += (r() - 0.5) * 0.12
    pts.push([x, base - y * amplitude])
  }
  return pts
}
function preencherCrista (ctx, pts, cor) {
  ctx.beginPath(); ctx.moveTo(0, A)
  pts.forEach(([x, y]) => ctx.lineTo(x, y))
  ctx.lineTo(L, A); ctx.closePath(); ctx.fillStyle = cor; ctx.fill()
}

const PAPEIS = {
  aurora () {
    const c = novo(), ctx = c.getContext('2d'), r = sorteio(11)
    ceu(ctx, [[0, '#04070f'], [0.6, '#08162a'], [1, '#0b1f2c']])
    estrelas(ctx, r, 420, A * 0.75)
    const luz = novo(), lc = luz.getContext('2d')
    lc.globalCompositeOperation = 'lighter'
    const faixas = [['#1fe0b0', 0.32, 260], ['#2bb6ff', 0.24, 330], ['#9d5bff', 0.2, 410], ['#3dffa0', 0.18, 300]]
    faixas.forEach(([cor, alfa, y0], i) => {
      lc.strokeStyle = cor; lc.globalAlpha = alfa; lc.lineWidth = 120 - i * 18; lc.lineCap = 'round'
      lc.beginPath(); lc.moveTo(-100, y0 + 120)
      lc.bezierCurveTo(L * 0.3, y0 - 160 + i * 40, L * 0.55, y0 + 220, L + 100, y0 - 60 - i * 30)
      lc.stroke()
    })
    ctx.filter = 'blur(42px)'; ctx.drawImage(luz, 0, 0); ctx.filter = 'blur(12px)'; ctx.globalAlpha = 0.5; ctx.drawImage(luz, 0, 0)
    ctx.filter = 'none'; ctx.globalAlpha = 1
    preencherCrista(ctx, crista(r, A * 0.84, 90, 160), '#06101a')
    preencherCrista(ctx, crista(r, A * 0.93, 60, 160), '#03080e')
    return c
  },
  dunas () {
    const c = novo(), ctx = c.getContext('2d'), r = sorteio(23)
    ceu(ctx, [[0, '#1d1430'], [0.38, '#5a2e4a'], [0.62, '#c0604a'], [0.78, '#f0a25e'], [1, '#f6c27a']])
    const sol = ctx.createRadialGradient(L * 0.68, A * 0.6, 0, L * 0.68, A * 0.6, 340)
    sol.addColorStop(0, 'rgba(255,226,160,0.95)'); sol.addColorStop(0.18, 'rgba(255,200,130,0.6)'); sol.addColorStop(1, 'rgba(255,170,110,0)')
    ctx.fillStyle = sol; ctx.fillRect(0, 0, L, A)
    const camadas = [[0.66, 70, '#a8503f', '#7a3434'], [0.74, 80, '#7d3a37', '#56252c'], [0.84, 90, '#4f2430', '#341624'], [0.95, 70, '#2a1220', '#1a0b16']]
    camadas.forEach(([base, amp, c1, c2], i) => {
      const fase = r() * 10
      ctx.beginPath(); ctx.moveTo(0, A)
      for (let x = 0; x <= L; x += 8) {
        const y = A * base - Math.sin(x / (380 + i * 90) + fase) * amp - Math.sin(x / 170 + fase * 2) * amp * 0.25
        ctx.lineTo(x, y)
      }
      ctx.lineTo(L, A); ctx.closePath()
      const g = ctx.createLinearGradient(0, A * base - amp, 0, A)
      g.addColorStop(0, c1); g.addColorStop(1, c2)
      ctx.fillStyle = g; ctx.fill()
    })
    return c
  },
  montanhas () {
    const c = novo(), ctx = c.getContext('2d'), r = sorteio(37)
    ceu(ctx, [[0, '#070b17'], [0.55, '#142242'], [1, '#2a3f66']])
    estrelas(ctx, r, 380, A * 0.6)
    const lua = ctx.createRadialGradient(L * 0.22, A * 0.22, 0, L * 0.22, A * 0.22, 220)
    lua.addColorStop(0, 'rgba(230,238,255,1)'); lua.addColorStop(0.2, 'rgba(230,238,255,0.95)'); lua.addColorStop(0.22, 'rgba(170,190,240,0.35)'); lua.addColorStop(1, 'rgba(120,150,220,0)')
    ctx.fillStyle = lua; ctx.fillRect(0, 0, L, A)
    const camadas = [[0.58, 170, '#22345a'], [0.68, 150, '#1a2848'], [0.78, 130, '#121d36'], [0.9, 110, '#0b1326']]
    camadas.forEach(([base, amp, cor]) => {
      preencherCrista(ctx, crista(r, A * base, amp, 220), cor)
      const nevoa = ctx.createLinearGradient(0, A * base - 40, 0, A * base + 120)
      nevoa.addColorStop(0, 'rgba(120,150,210,0)'); nevoa.addColorStop(0.5, 'rgba(120,150,210,0.10)'); nevoa.addColorStop(1, 'rgba(120,150,210,0)')
      ctx.fillStyle = nevoa; ctx.fillRect(0, A * base - 40, L, 160)
    })
    return c
  },
  ondas () {
    const c = novo(), ctx = c.getContext('2d'), r = sorteio(41)
    ceu(ctx, [[0, '#0b0816'], [1, '#150d24']])
    const brilho = ctx.createRadialGradient(L * 0.7, A * 0.4, 0, L * 0.7, A * 0.4, 900)
    brilho.addColorStop(0, 'rgba(120,60,200,0.35)'); brilho.addColorStop(1, 'rgba(120,60,200,0)')
    ctx.fillStyle = brilho; ctx.fillRect(0, 0, L, A)
    ctx.globalCompositeOperation = 'lighter'
    const fase = r() * 10
    for (let k = 0; k < 70; k++) {
      const t = k / 69
      const g = ctx.createLinearGradient(0, 0, L, 0)
      g.addColorStop(0, 'rgba(70,120,255,0)'); g.addColorStop(0.3, 'rgba(120,90,255,' + (0.08 + t * 0.1) + ')')
      g.addColorStop(0.7, 'rgba(255,90,190,' + (0.1 + t * 0.12) + ')'); g.addColorStop(1, 'rgba(255,140,120,0)')
      ctx.strokeStyle = g; ctx.lineWidth = 1.6
      ctx.beginPath()
      for (let x = -20; x <= L + 20; x += 10) {
        const y = A * 0.52 + Math.sin(x / 300 + fase + t * 2.2) * (140 - t * 60) + Math.sin(x / 120 + t * 6) * 22 + (t - 0.5) * 220
        if (x === -20) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
    return c
  },
  oceano () {
    const c = novo(), ctx = c.getContext('2d'), r = sorteio(53)
    ceu(ctx, [[0, '#0e5266'], [0.35, '#073a4c'], [0.75, '#03202e'], [1, '#020f18']])
    const raios = novo(), rc = raios.getContext('2d')
    for (let i = 0; i < 14; i++) {
      const x = L * (0.15 + r() * 0.75), largura = 40 + r() * 120, inclina = -200 + r() * 160
      const g = rc.createLinearGradient(0, 0, 0, A)
      g.addColorStop(0, 'rgba(180,240,255,' + (0.18 + r() * 0.14) + ')'); g.addColorStop(1, 'rgba(180,240,255,0)')
      rc.fillStyle = g
      rc.beginPath(); rc.moveTo(x, 0); rc.lineTo(x + largura, 0); rc.lineTo(x + largura * 2.4 + inclina, A); rc.lineTo(x + inclina, A); rc.closePath(); rc.fill()
    }
    ctx.filter = 'blur(26px)'; ctx.drawImage(raios, 0, 0); ctx.filter = 'none'
    for (let i = 0; i < 260; i++) {
      const x = r() * L, y = A * 0.2 + r() * A * 0.8, raio = r() * 2.2 + 0.4
      ctx.fillStyle = 'rgba(190,245,255,' + (0.08 + r() * 0.35) + ')'
      ctx.beginPath(); ctx.arc(x, y, raio, 0, Math.PI * 2); ctx.fill()
    }
    const fundo = ctx.createLinearGradient(0, A * 0.75, 0, A)
    fundo.addColorStop(0, 'rgba(2,12,20,0)'); fundo.addColorStop(1, 'rgba(2,10,16,0.9)')
    ctx.fillStyle = fundo; ctx.fillRect(0, A * 0.75, L, A * 0.25)
    return c
  },
  cristais () {
    const c = novo(), ctx = c.getContext('2d'), r = sorteio(67)
    const colunas = 16, linhas = 10
    const pts = []
    for (let j = 0; j <= linhas; j++) {
      const linha = []
      for (let i = 0; i <= colunas; i++) {
        const borda = i === 0 || j === 0 || i === colunas || j === linhas
        linha.push([(i / colunas) * L + (borda ? 0 : (r() - 0.5) * 90), (j / linhas) * A + (borda ? 0 : (r() - 0.5) * 80)])
      }
      pts.push(linha)
    }
    const luz = [L * 0.78, A * 0.15]
    const tri = (a, b, d) => {
      const cx = (a[0] + b[0] + d[0]) / 3, cy = (a[1] + b[1] + d[1]) / 3
      const dist = Math.hypot(cx - luz[0], cy - luz[1]) / Math.hypot(L, A)
      const v = Math.max(0, 1 - dist * 1.25) + (r() - 0.5) * 0.08
      const cor = 'rgb(' + Math.round(14 + v * 40) + ',' + Math.round(18 + v * 62) + ',' + Math.round(30 + v * 96) + ')'
      ctx.fillStyle = cor; ctx.strokeStyle = cor
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...d); ctx.closePath(); ctx.fill(); ctx.stroke()
    }
    for (let j = 0; j < linhas; j++) {
      for (let i = 0; i < colunas; i++) {
        const a = pts[j][i], b = pts[j][i + 1], d = pts[j + 1][i], e = pts[j + 1][i + 1]
        if ((i + j) % 2) { tri(a, b, e); tri(a, e, d) } else { tri(a, b, d); tri(b, e, d) }
      }
    }
    return c
  }
}
`

app.whenReady().then(async () => {
  const j = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await j.loadURL('data:text/html,<body></body>')
  await j.webContents.executeJavaScript(DESENHOS + '; window.PAPEIS = PAPEIS; 1')
  fs.mkdirSync(DESTINO, { recursive: true })
  const nomes = await j.webContents.executeJavaScript('Object.keys(PAPEIS)')
  for (const nome of nomes) {
    const dados = await j.webContents.executeJavaScript(`PAPEIS.${nome}().toDataURL('image/webp', 0.84)`)
    const buffer = Buffer.from(dados.split(',')[1], 'base64')
    fs.writeFileSync(path.join(DESTINO, nome + '.webp'), buffer)
    console.log(`${nome}.webp: ${Math.round(buffer.length / 1024)} KB`)
  }
  app.exit(0)
})
