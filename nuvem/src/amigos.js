// Amigos do LiveOn: código de amigo, presença e pedido para entrar na sala.
//
// Dois tipos de objeto, nenhum banco de dados à parte: cada objeto tem o
// próprio armazenamento.
//
// - Pessoa: um por pessoa, nomeado pelo HASH do segredo dela. O segredo é
//   sorteado no PC da pessoa e só ela tem: quem conecta em /amigos/<segredo>
//   É aquela pessoa. O hash (o "id") é o que os amigos guardam; com ele não se
//   conecta em nada, porque a rota pública pede o segredo.
// - Etiqueta: um por código de amigo ("Five#4821"), só aponta para o id do
//   dono. É a porta para alguém te ADICIONAR, e nada mais.
//
// A amizade é presa ao id, não ao código. Trocar de nome sorteia um código
// novo (pedido do dono), o antigo para de funcionar, e os amigos continuam
// amigos: o objeto da pessoa avisa cada um do nome novo.
//
// O código da SALA nunca é guardado aqui. Ele só passa: de quem aceita um
// pedido para quem pediu, ou de quem convida para o convidado. A presença
// mostra aos amigos o rótulo e a lotação da sala, nunca o código.

import { DurableObject } from 'cloudflare:workers'

// Quem cai fica online por este tempo antes de os amigos verem offline: a
// conexão com a Cloudflare cai sozinha de vez em quando (1006), e sem isto a
// pessoa piscaria offline e online na lista dos outros.
const CARENCIA_OFFLINE = 20000

// Recolhimento de quem sumiu calado, como na sala, mas mais espaçado: aqui
// errar por um minuto só atrasa a bolinha de online de alguém.
const JANELA_SILENCIO = 90000
const INTERVALO_VIGIA = 60000

// Um pedido para entrar vale por isto. O app mostra a contagem.
const VALIDADE_PEDIDO = 60000

const MAXIMO_AMIGOS = 100
const MAXIMO_RECEBIDOS = 30
// Pedidos de amizade esperando resposta, mandados por mim. Sem teto a lista
// crescia para sempre (devagar, pelo limite de 10 por minuto).
const MAXIMO_ENVIADOS = 100
const TAMANHO_MAXIMO = 64 * 1024
const RITMO_MAXIMO = 120
const JANELA_RITMO = 10000

const FOTO_MAXIMA = 24000
const FORMATO_DE_FOTO = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/
const FORMATO_DE_CODIGO_DA_SALA = /^[\w-]{10,60}$/
const FORMATO_DE_ID = /^[0-9a-f]{32}$/

function limpar (texto, tamanho) {
  return String(texto || '').trim().slice(0, tamanho)
}

// O nome que vai no código: sem '#', que é o separador, e sem espaço repetido.
function nomeDoCodigo (nome) {
  return limpar(nome, 32).replace(/#/g, '').replace(/\s+/g, ' ').trim()
}

// A chave de busca: sem diferença de maiúscula, acento e espaço repetido.
// "joao#4821" acha "João#4821": quem digita na mão não precisa acertar o til.
export function chaveDoCodigo (texto) {
  const achado = /^(.+)#(\d{4})$/.exec(String(texto || '').trim())
  if (!achado) return ''
  const nome = achado[1].normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
  return nome && nome.length <= 32 ? `${nome}#${achado[2]}` : ''
}

export async function idDoSegredo (segredo) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(segredo))
  return [...new Uint8Array(bytes)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function numeroSorteado () {
  const n = new Uint32Array(1)
  crypto.getRandomValues(n)
  return String(1000 + (n[0] % 9000))
}

function fotoValida (foto) {
  return typeof foto === 'string' && foto.length <= FOTO_MAXIMA && FORMATO_DE_FOTO.test(foto) ? foto : ''
}

// O que os amigos veem da sala em que a pessoa está. O id é um resumo do
// código feito no app (serve para agrupar quem está na mesma sala), e com ele
// não se chega ao código.
function salaValida (sala) {
  if (!sala || typeof sala !== 'object') return null
  const id = typeof sala.id === 'string' && /^[0-9a-f]{16}$/.test(sala.id) ? sala.id : ''
  const rotulo = limpar(sala.rotulo, 40)
  const quantos = Math.max(1, Math.min(50, Math.floor(Number(sala.quantos) || 1)))
  return id && rotulo ? { id, rotulo, quantos } : null
}

// ===========================================================================
// Etiqueta: o código de amigo, apontando para o dono
// ===========================================================================

export class Etiqueta extends DurableObject {
  // Fica com o código se estiver livre (ou já for dele). Sem await entre o
  // get e o put, então dois pedidos ao mesmo tempo não pegam o mesmo código.
  async reivindicar (id) {
    const dono = await this.ctx.storage.get('dono')
    if (dono && dono !== id) return false
    await this.ctx.storage.put('dono', id)
    return true
  }

  async liberar (id) {
    if ((await this.ctx.storage.get('dono')) === id) await this.ctx.storage.deleteAll()
  }

  async dono () {
    return (await this.ctx.storage.get('dono')) || ''
  }
}

// ===========================================================================
// Pessoa
// ===========================================================================

export class Pessoa extends DurableObject {
  constructor (ctx, env) {
    super(ctx, env)
    this.ritmo = new WeakMap()
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(JSON.stringify({ tipo: 'ping' }), JSON.stringify({ tipo: 'pong' }))
    )
  }

  async fetch (requisicao) {
    const segredo = new URL(requisicao.url).pathname.split('/').filter(Boolean)[1] || ''
    const id = await idDoSegredo(segredo)
    if (!(await this.ctx.storage.get('id'))) await this.ctx.storage.put('id', id)

    const par = new WebSocketPair()
    const [doCliente, doServidor] = Object.values(par)
    this.ctx.acceptWebSocket(doServidor)
    doServidor.serializeAttachment({
      ip: requisicao.headers.get('CF-Connecting-IP') || 'local',
      desde: Date.now(),
      apresentado: false
    })
    return new Response(null, { status: 101, webSocket: doCliente })
  }

  // --- armazenamento -----------------------------------------------------------

  async ler (chave, padrao) {
    const valor = await this.ctx.storage.get(chave)
    return valor === undefined ? padrao : valor
  }

  async meuId () { return this.ler('id', '') }
  async perfil () { return this.ler('perfil', { nome: '', tag: '', chave: '', foto: '' }) }
  async amigos () { return this.ler('amigos', {}) }
  async recebidos () { return this.ler('recebidos', {}) }
  async enviados () { return this.ler('enviados', {}) }

  stub (id) {
    return this.env.PESSOA.get(this.env.PESSOA.idFromName(id))
  }

  etiqueta (chave) {
    return this.env.ETIQUETA.get(this.env.ETIQUETA.idFromName(chave))
  }

  // --- sockets -------------------------------------------------------------------

  dados (ws) {
    try { return ws.deserializeAttachment() } catch { return null }
  }

  // Sockets de quem esta aqui de verdade: apresentado e sem ter dado tchau.
  ativos () {
    return this.ctx.getWebSockets().filter((ws) => {
      const d = this.dados(ws)
      return d && d.apresentado && !d.saindo
    })
  }

  enviar (ws, msg) {
    try { ws.send(JSON.stringify(msg)) } catch { /* morreu; o close limpa */ }
  }

  paraMim (msg) {
    for (const ws of this.ativos()) this.enviar(ws, msg)
  }

  // --- presenca --------------------------------------------------------------------

  // O que um amigo ve de mim. Invisivel aparece offline e sem sala.
  async presencaPublica (comFoto) {
    const perfil = await this.perfil()
    const invisivel = await this.ler('invisivel', false)
    const online = (await this.ler('online', false)) && !invisivel
    const dados = {
      id: await this.meuId(),
      nome: perfil.nome,
      tag: perfil.tag,
      online,
      sala: online ? await this.ler('sala', null) : null
    }
    if (comFoto) dados.foto = perfil.foto || ''
    return dados
  }

  async avisarAmigos (comFoto = false) {
    const dados = await this.presencaPublica(comFoto)
    const ids = Object.keys(await this.amigos())
    const respostas = await Promise.allSettled(ids.map((id) => this.stub(id).avisoDeAmigo(dados.id, dados)))
    // false explicito = ele desfez a amizade e eu nao fiquei sabendo. A lista
    // e RELIDA aqui: enquanto os outros respondiam, outras chamadas podiam
    // ter mexido nela (um amigo novo aceito no meio), e gravar a copia de
    // antes apagaria a mudanca.
    const desfeitos = ids.filter((_, i) => respostas[i].status === 'fulfilled' && respostas[i].value === false)
    if (desfeitos.length) {
      const amigos = await this.amigos()
      for (const id of desfeitos) delete amigos[id]
      await this.ctx.storage.put('amigos', amigos)
    }
  }

  async marcarOnline (online) {
    const antes = await this.ler('online', false)
    if (antes === online) return
    await this.ctx.storage.put('online', online)
    if (!online) await this.ctx.storage.delete('sala')
    await this.avisarAmigos()
  }

  // A lista inteira, perguntando a cada amigo como ele esta agora.
  async listaDeAmigos () {
    const meuId = await this.meuId()
    const ids = Object.keys(await this.amigos())
    const respostas = await Promise.allSettled(ids.map((id) => this.stub(id).presencaPara(meuId)))
    // Relida DEPOIS das respostas (ver avisarAmigos): quem foi aceito ou
    // desfeito enquanto isso nao pode se perder na gravacao.
    const amigos = await this.amigos()
    const lista = []
    respostas.forEach((r, i) => {
      const id = ids[i]
      if (!amigos[id]) return
      if (r.status === 'fulfilled' && r.value === null) {
        delete amigos[id]
        return
      }
      if (r.status === 'fulfilled') {
        amigos[id] = { nome: r.value.nome, tag: r.value.tag }
        lista.push(r.value)
      } else {
        lista.push({ id, nome: amigos[id].nome, tag: amigos[id].tag, online: false, sala: null })
      }
    })
    await this.ctx.storage.put('amigos', amigos)
    return lista
  }

  async listaDePedidos () {
    const recebidos = await this.recebidos()
    const enviados = await this.enviados()
    return {
      recebidos: Object.entries(recebidos).map(([id, p]) => ({ id, nome: p.nome, tag: p.tag })),
      enviados: Object.entries(enviados).map(([id, p]) => ({ id, nome: p.nome, tag: p.tag }))
    }
  }

  async mandarPedidos () {
    this.paraMim({ tipo: 'pedidos', ...(await this.listaDePedidos()) })
  }

  // --- codigo de amigo ---------------------------------------------------------------

  // Sorteia um codigo novo com este nome e solta o antigo.
  async trocarCodigo (nome) {
    const meuId = await this.meuId()
    const perfil = await this.perfil()
    const base = nomeDoCodigo(nome)
    if (!base) return false

    for (let tentativa = 0; tentativa < 30; tentativa++) {
      const tag = `${base}#${numeroSorteado()}`
      const chave = chaveDoCodigo(tag)
      if (!chave || chave === perfil.chave) continue
      if (await this.etiqueta(chave).reivindicar(meuId)) {
        if (perfil.chave) await this.etiqueta(perfil.chave).liberar(meuId)
        // Relido depois de esperar os codigos: uma foto trocada enquanto isso
        // nao pode ser apagada pela copia de antes.
        const atual = await this.perfil()
        atual.nome = limpar(nome, 32)
        atual.tag = tag
        atual.chave = chave
        await this.ctx.storage.put('perfil', atual)
        return true
      }
    }
    return false
  }

  // --- protocolo -----------------------------------------------------------------------

  async webSocketMessage (ws, dados) {
    const tamanho = typeof dados === 'string' ? dados.length : dados.byteLength
    if (tamanho > TAMANHO_MAXIMO) return this.enviar(ws, { tipo: 'erro', motivo: 'mensagem grande demais' })

    if (!this.ritmo.has(ws)) this.ritmo.set(ws, { desde: Date.now(), quantas: 0 })
    const conta = this.ritmo.get(ws)
    if (Date.now() - conta.desde > JANELA_RITMO) { conta.desde = Date.now(); conta.quantas = 0 }
    if (++conta.quantas > RITMO_MAXIMO) return

    let msg
    try { msg = JSON.parse(dados) } catch { return this.enviar(ws, { tipo: 'erro', motivo: 'json inválido' }) }
    // JSON valido nao e o mesmo que objeto: "null", "1" ou "[]" estouravam
    // no msg.tipo, e o bloco de erro, lendo msg.tipo de novo, estourava
    // outra vez, sem tratamento (achado atacando o Worker com lixo).
    if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.tipo !== 'string') {
      return this.enviar(ws, { tipo: 'erro', motivo: 'mensagem inválida' })
    }

    try {
      return await this.despachar(ws, msg)
    } catch (erro) {
      console.error(`amigos: falha tratando ${msg.tipo}: ${erro.message}`)
      return this.enviar(ws, { tipo: 'erro', motivo: 'o servidor falhou ao tratar essa mensagem' })
    }
  }

  async despachar (ws, msg) {
    const meu = this.dados(ws)
    if (!meu) return
    if (msg.tipo === 'ping') return this.enviar(ws, { tipo: 'pong' })
    if (msg.tipo === 'ola') return this.ola(ws, meu, msg)
    // Tudo o mais so depois de se apresentar.
    if (!meu.apresentado) return this.enviar(ws, { tipo: 'erro', motivo: 'apresente-se primeiro' })

    switch (msg.tipo) {
      case 'perfil': return this.mudarPerfil(ws, msg)
      case 'presenca': return this.mudarPresenca(msg)
      case 'invisivel': return this.mudarInvisivel(msg)
      case 'adicionar': return this.adicionar(ws, meu, msg)
      case 'responder-amizade': return this.responderAmizade(msg)
      case 'cancelar-amizade': return this.cancelarAmizade(msg)
      case 'remover': return this.remover(msg)
      case 'pedir-entrada': return this.pedirEntrada(ws, meu, msg)
      case 'cancelar-entrada': return this.cancelarEntrada()
      case 'responder-entrada': return this.responderEntrada(ws, msg)
      case 'convidar': return this.convidar(ws, meu, msg)
      case 'tchau': return this.tchau(ws, meu)
      case 'pong': return
      default: return this.enviar(ws, { tipo: 'erro', motivo: `tipo desconhecido: ${msg.tipo}` })
    }
  }

  // Primeira mensagem de cada conexao: quem eu sou agora (nome, foto,
  // invisivel). Devolve o meu codigo, os amigos e os pedidos.
  async ola (ws, meu, msg) {
    const nome = limpar(msg.nome, 32)
    if (!nomeDoCodigo(nome)) return this.enviar(ws, { tipo: 'erro', motivo: 'seu nome é obrigatório' })

    const perfil = await this.perfil()
    perfil.foto = fotoValida(msg.foto)
    await this.ctx.storage.put('perfil', perfil)
    if (!perfil.tag || perfil.nome !== nome) {
      if (!(await this.trocarCodigo(nome))) return this.enviar(ws, { tipo: 'erro', motivo: 'não consegui criar seu código de amigo' })
    }
    await this.ctx.storage.put('invisivel', Boolean(msg.invisivel))

    meu.apresentado = true
    ws.serializeAttachment(meu)
    await this.ctx.storage.delete('quedaDesde')

    const atual = await this.perfil()
    this.enviar(ws, {
      tipo: 'voce',
      id: await this.meuId(),
      tag: atual.tag,
      invisivel: Boolean(msg.invisivel),
      amigos: await this.listaDeAmigos(),
      ...(await this.listaDePedidos())
    })

    const estava = await this.ler('online', false)
    if (estava) await this.avisarAmigos(true)
    else {
      await this.ctx.storage.put('online', true)
      await this.avisarAmigos(true)
    }
    await this.agendarVigia()
  }

  async mudarPerfil (ws, msg) {
    const perfil = await this.perfil()
    let trocou = false
    if (typeof msg.nome === 'string') {
      const nome = limpar(msg.nome, 32)
      if (nomeDoCodigo(nome) && nome !== perfil.nome) {
        if (!(await this.trocarCodigo(nome))) return this.enviar(ws, { tipo: 'erro', motivo: 'não consegui criar seu código de amigo' })
        trocou = true
      }
    }
    if (typeof msg.foto === 'string') {
      const atual = await this.perfil()
      atual.foto = fotoValida(msg.foto)
      await this.ctx.storage.put('perfil', atual)
    }
    if (trocou) this.paraMim({ tipo: 'codigo', tag: (await this.perfil()).tag })
    await this.avisarAmigos(typeof msg.foto === 'string')
  }

  async mudarPresenca (msg) {
    const sala = salaValida(msg.sala)
    const antes = await this.ler('sala', null)
    if (JSON.stringify(antes) === JSON.stringify(sala)) return
    if (sala) await this.ctx.storage.put('sala', sala)
    else await this.ctx.storage.delete('sala')
    await this.avisarAmigos()
  }

  async mudarInvisivel (msg) {
    await this.ctx.storage.put('invisivel', Boolean(msg.valor))
    this.paraMim({ tipo: 'invisivel', valor: Boolean(msg.valor) })
    await this.avisarAmigos(true)
  }

  // Pedido de amizade: so pelo codigo, e o outro precisa aceitar.
  async adicionar (ws, meu, msg) {
    const responder = (ok, motivo = '') => this.enviar(ws, { tipo: 'adicionado', ok, motivo })
    const chave = chaveDoCodigo(msg.tag)
    if (!chave) return responder(false, 'Esse código não está no formato Nome#1234.')

    // Freio por IP, e nao por pessoa: criar pessoa nova e de graca.
    const { success } = await this.env.LIMITE_AMIGOS.limit({ key: `adicionar:${meu.ip}` })
    if (!success) return responder(false, 'Muitas tentativas. Espere um minuto.')

    const meuId = await this.meuId()
    const alvo = await this.etiqueta(chave).dono()
    if (!alvo) return responder(false, 'Código de amigo não encontrado.')
    if (alvo === meuId) return responder(false, 'Esse é o seu código.')

    const amigos = await this.amigos()
    if (amigos[alvo]) return responder(false, 'Vocês já são amigos.')
    if (Object.keys(amigos).length >= MAXIMO_AMIGOS) return responder(false, 'Sua lista de amigos está cheia.')

    // Ele ja tinha me pedido: e um aceite.
    if ((await this.recebidos())[alvo]) {
      await this.responderAmizade({ id: alvo, aceitar: true })
      return responder(true)
    }

    if (Object.keys(await this.enviados()).length >= MAXIMO_ENVIADOS) {
      return responder(false, 'Você tem pedidos demais esperando. Cancele alguns.')
    }

    const eu = await this.perfil()
    const resposta = await this.stub(alvo).receberPedido({ id: meuId, nome: eu.nome, tag: eu.tag })
    if (resposta === 'cheio') return responder(false, 'Essa pessoa tem pedidos demais esperando.')
    if (resposta === 'amigos') {
      // Ele ainda me tinha como amigo (eu tinha perdido a lista): volta.
      const atuais = await this.amigos()
      atuais[alvo] = { nome: '', tag: '' }
      await this.ctx.storage.put('amigos', atuais)
      this.paraMim({ tipo: 'amigos', amigos: await this.listaDeAmigos() })
      return responder(true)
    }

    // Lida DEPOIS de esperar o outro, pelo mesmo motivo de avisarAmigos.
    const dele = await this.stub(alvo).presencaPara(null)
    const enviados = await this.enviados()
    enviados[alvo] = { nome: dele ? dele.nome : '', tag: dele ? dele.tag : '', em: Date.now() }
    await this.ctx.storage.put('enviados', enviados)
    responder(true)
    await this.mandarPedidos()
  }

  async responderAmizade (msg) {
    const id = typeof msg.id === 'string' ? msg.id : ''
    const recebidos = await this.recebidos()
    if (!recebidos[id]) return
    delete recebidos[id]
    await this.ctx.storage.put('recebidos', recebidos)

    const meuId = await this.meuId()
    if (msg.aceitar) {
      const eu = await this.presencaPublica(true)
      const dele = await this.stub(id).amizadeAceita(meuId, eu)
      if (dele) {
        const amigos = await this.amigos()
        amigos[id] = { nome: dele.nome, tag: dele.tag }
        await this.ctx.storage.put('amigos', amigos)
        this.paraMim({ tipo: 'amigo', amigo: dele, novo: true })
      }
    } else {
      await this.stub(id).pedidoRecusado(meuId)
    }
    await this.mandarPedidos()
  }

  async cancelarAmizade (msg) {
    const id = typeof msg.id === 'string' ? msg.id : ''
    const enviados = await this.enviados()
    if (!enviados[id]) return
    delete enviados[id]
    await this.ctx.storage.put('enviados', enviados)
    await this.stub(id).pedidoCancelado(await this.meuId())
    await this.mandarPedidos()
  }

  async remover (msg) {
    const id = typeof msg.id === 'string' ? msg.id : ''
    const amigos = await this.amigos()
    if (!amigos[id]) return
    delete amigos[id]
    await this.ctx.storage.put('amigos', amigos)
    this.paraMim({ tipo: 'amigo-removido', id })
    await this.stub(id).amizadeDesfeita(await this.meuId())
  }

  // Pedir para entrar na sala de um ou mais amigos (os que estao na mesma
  // sala). O primeiro que aceitar manda o codigo; os outros pedidos somem.
  async pedirEntrada (ws, meu, msg) {
    const amigos = await this.amigos()
    const para = (Array.isArray(msg.para) ? msg.para : []).filter((id) => typeof id === 'string' && amigos[id]).slice(0, 10)
    if (!para.length) return this.enviar(ws, { tipo: 'pedido-entrada-enviado', entregues: 0 })

    const { success } = await this.env.LIMITE_AMIGOS.limit({ key: `entrada:${meu.ip}` })
    if (!success) return this.enviar(ws, { tipo: 'erro', motivo: 'Muitos pedidos. Espere um minuto.' })

    await this.cancelarEntrada()
    const pedido = { id: crypto.randomUUID(), para, em: Date.now() }
    const eu = await this.perfil()
    const meuId = await this.meuId()
    const de = { id: meuId, nome: eu.nome, tag: eu.tag }
    const respostas = await Promise.allSettled(para.map((id) => this.stub(id).pedidoDeEntrada(pedido.id, de)))
    pedido.para = para.filter((_, i) => respostas[i].status === 'fulfilled' && respostas[i].value === true)
    if (pedido.para.length) await this.ctx.storage.put('pedido', pedido)
    this.paraMim({ tipo: 'pedido-entrada-enviado', pedido: pedido.id, entregues: pedido.para.length, validade: VALIDADE_PEDIDO })
  }

  async cancelarEntrada () {
    const pedido = await this.ler('pedido', null)
    if (!pedido) return
    await this.ctx.storage.delete('pedido')
    await Promise.allSettled(pedido.para.map((id) => this.stub(id).entradaEncerrada(pedido.id)))
  }

  async responderEntrada (ws, msg) {
    const de = typeof msg.de === 'string' && FORMATO_DE_ID.test(msg.de) ? msg.de : ''
    if (!de || !(await this.amigos())[de]) return
    const aceitar = Boolean(msg.aceitar)
    const codigo = aceitar ? limpar(msg.codigo, 60) : ''
    if (aceitar && !FORMATO_DE_CODIGO_DA_SALA.test(codigo)) return this.enviar(ws, { tipo: 'erro', motivo: 'código da sala inválido' })
    const eu = await this.perfil()
    const resultado = await this.stub(de).respostaDeEntrada(String(msg.pedido || ''), {
      id: await this.meuId(), nome: eu.nome
    }, aceitar, codigo, limpar(msg.rotulo, 40))
    // Para todos os meus aparelhos: o aviso some de todos.
    this.paraMim({ tipo: 'entrada-respondida', pedido: String(msg.pedido || ''), resultado })
  }

  async convidar (ws, meu, msg) {
    const para = typeof msg.para === 'string' ? msg.para : ''
    const codigo = limpar(msg.codigo, 60)
    if (!(await this.amigos())[para] || !FORMATO_DE_CODIGO_DA_SALA.test(codigo)) return
    const { success } = await this.env.LIMITE_AMIGOS.limit({ key: `convite:${meu.ip}` })
    if (!success) return this.enviar(ws, { tipo: 'erro', motivo: 'Muitos convites. Espere um minuto.' })
    const eu = await this.perfil()
    const entregue = await this.stub(para).conviteDeAmigo(
      { id: await this.meuId(), nome: eu.nome, tag: eu.tag }, codigo, limpar(msg.rotulo, 40))
    this.enviar(ws, { tipo: 'convite-enviado', para, entregue: Boolean(entregue) })
  }

  // Saida de proposito (fechou o app): offline na hora, sem carencia.
  async tchau (ws, meu) {
    meu.saindo = true
    ws.serializeAttachment(meu)
    if (!this.ativos().length) {
      await this.cancelarEntrada()
      await this.marcarOnline(false)
    }
  }

  // --- RPC: chamado pelo objeto de outra pessoa ------------------------------------

  async avisoDeAmigo (de, dados) {
    const amigos = await this.amigos()
    if (!amigos[de]) return false
    if (amigos[de].nome !== dados.nome || amigos[de].tag !== dados.tag) {
      amigos[de] = { nome: dados.nome, tag: dados.tag }
      await this.ctx.storage.put('amigos', amigos)
    }
    this.paraMim({ tipo: 'amigo', amigo: dados })
    return true
  }

  // null = nao somos amigos. Com quem === null, so o nome e o codigo (para
  // quem acabou de mandar um pedido mostrar a quem mandou).
  async presencaPara (quem) {
    if (quem === null) {
      const perfil = await this.perfil()
      return { nome: perfil.nome, tag: perfil.tag }
    }
    if (!(await this.amigos())[quem]) return null
    return this.presencaPublica(true)
  }

  async receberPedido (de) {
    const amigos = await this.amigos()
    if (amigos[de.id]) return 'amigos'
    const recebidos = await this.recebidos()
    if (!recebidos[de.id] && Object.keys(recebidos).length >= MAXIMO_RECEBIDOS) return 'cheio'
    recebidos[de.id] = { nome: limpar(de.nome, 32), tag: limpar(de.tag, 40), em: Date.now() }
    await this.ctx.storage.put('recebidos', recebidos)
    this.paraMim({ tipo: 'pedido-amizade', de: { id: de.id, nome: recebidos[de.id].nome, tag: recebidos[de.id].tag } })
    await this.mandarPedidos()
    return 'ok'
  }

  // Ele aceitou o MEU pedido. So vale se eu tinha pedido mesmo.
  async amizadeAceita (de, dados) {
    const enviados = await this.enviados()
    if (!enviados[de]) return null
    delete enviados[de]
    await this.ctx.storage.put('enviados', enviados)
    const amigos = await this.amigos()
    amigos[de] = { nome: dados.nome, tag: dados.tag }
    await this.ctx.storage.put('amigos', amigos)
    this.paraMim({ tipo: 'amigo', amigo: dados, novo: true })
    await this.mandarPedidos()
    return this.presencaPublica(true)
  }

  // Recusado e calado: quem pediu so ve o pedido sumir.
  async pedidoRecusado (de) {
    const enviados = await this.enviados()
    if (!enviados[de]) return
    delete enviados[de]
    await this.ctx.storage.put('enviados', enviados)
    await this.mandarPedidos()
  }

  async pedidoCancelado (de) {
    const recebidos = await this.recebidos()
    if (!recebidos[de]) return
    delete recebidos[de]
    await this.ctx.storage.put('recebidos', recebidos)
    await this.mandarPedidos()
  }

  async amizadeDesfeita (de) {
    const amigos = await this.amigos()
    if (!amigos[de]) return
    delete amigos[de]
    await this.ctx.storage.put('amigos', amigos)
    this.paraMim({ tipo: 'amigo-removido', id: de })
  }

  async pedidoDeEntrada (pedido, de) {
    if (!(await this.amigos())[de.id] || !this.ativos().length) return false
    this.paraMim({ tipo: 'pedido-entrada', pedido, de, validade: VALIDADE_PEDIDO })
    return true
  }

  async entradaEncerrada (pedido) {
    this.paraMim({ tipo: 'entrada-encerrada', pedido })
  }

  // Resposta de um amigo ao MEU pedido para entrar.
  async respostaDeEntrada (pedidoId, por, aceitar, codigo, rotulo) {
    const pedido = await this.ler('pedido', null)
    if (!pedido || pedido.id !== pedidoId || !pedido.para.includes(por.id)) return 'encerrado'
    if (Date.now() - pedido.em > VALIDADE_PEDIDO) {
      await this.cancelarEntrada()
      this.paraMim({ tipo: 'entrada-recusada', pedido: pedidoId, expirou: true })
      return 'encerrado'
    }
    if (aceitar) {
      await this.ctx.storage.delete('pedido')
      this.paraMim({ tipo: 'entrada-aceita', pedido: pedidoId, codigo, rotulo, por })
      await Promise.allSettled(pedido.para.filter((id) => id !== por.id).map((id) => this.stub(id).entradaEncerrada(pedidoId)))
      return 'aceito'
    }
    pedido.para = pedido.para.filter((id) => id !== por.id)
    if (pedido.para.length) {
      await this.ctx.storage.put('pedido', pedido)
    } else {
      await this.ctx.storage.delete('pedido')
      this.paraMim({ tipo: 'entrada-recusada', pedido: pedidoId })
    }
    return 'recusado'
  }

  async conviteDeAmigo (de, codigo, rotulo) {
    if (!(await this.amigos())[de.id] || !this.ativos().length) return false
    this.paraMim({ tipo: 'convite', de, codigo, rotulo })
    return true
  }

  // --- queda e fantasma --------------------------------------------------------------

  async webSocketClose (ws) { await this.fechou(ws) }
  async webSocketError (ws) { await this.fechou(ws) }

  async fechou (ws) {
    const meu = this.dados(ws)
    ws.serializeAttachment(null)
    if (!meu || meu.saindo || this.ativos().length) return
    await this.ctx.storage.put('quedaDesde', Date.now())
    const quando = Date.now() + CARENCIA_OFFLINE
    const marcado = await this.ctx.storage.getAlarm()
    if (marcado === null || marcado > quando) await this.ctx.storage.setAlarm(quando)
  }

  async agendarVigia () {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + INTERVALO_VIGIA)
  }

  async alarm () {
    const agora = Date.now()
    for (const ws of this.ativos()) {
      const d = this.dados(ws)
      const carimbo = this.ctx.getWebSocketAutoResponseTimestamp(ws)
      const visto = carimbo ? carimbo.getTime() : d.desde
      if (agora - visto > JANELA_SILENCIO) {
        ws.serializeAttachment(null)
        try { ws.close(4000, 'sem sinal de vida') } catch { /* ja morreu */ }
      }
    }

    if (this.ativos().length) return this.ctx.storage.setAlarm(agora + INTERVALO_VIGIA)

    const queda = await this.ler('quedaDesde', 0)
    if (queda && agora - queda < CARENCIA_OFFLINE) return this.ctx.storage.setAlarm(queda + CARENCIA_OFFLINE)
    await this.ctx.storage.delete('quedaDesde')
    await this.cancelarEntrada()
    await this.marcarOnline(false)
  }
}
