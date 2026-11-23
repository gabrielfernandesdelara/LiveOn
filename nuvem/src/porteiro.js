// Porteiro: conta codigo de sala errado, por IP (2.1.0, pedido do dono).
//
// Cinco errados SEGUIDOS e aquele IP espera cinco minutos para tentar de
// novo, ate com o codigo certo. Entrar numa sala zera a conta. Um objeto por
// IP, nomeado pelo CF-Connecting-IP: a sala que recebe o codigo errado e um
// objeto novo e vazio a cada chute, entao a conta nao pode morar nela.
//
// Soma com o LIMITE_ENTRADA (20 conexoes por minuto por IP, no fetch): aquele
// freia a varredura rapida; este pega o chute devagar, que passaria por baixo.

import { DurableObject } from 'cloudflare:workers'

export const TENTATIVAS_DE_CODIGO = 5
const ESPERA = 5 * 60 * 1000

export class Porteiro extends DurableObject {
  async espera () {
    const ate = (await this.ctx.storage.get('ate')) || 0
    return Math.max(0, ate - Date.now())
  }

  // Mais um errado. Devolve quanto falta esperar (0 se ainda pode tentar) e
  // quantas tentativas restam.
  async errou () {
    const erros = ((await this.ctx.storage.get('erros')) || 0) + 1
    if (erros >= TENTATIVAS_DE_CODIGO) {
      await this.ctx.storage.put('ate', Date.now() + ESPERA)
      await this.ctx.storage.put('erros', 0)
      return { espera: ESPERA, restam: 0 }
    }
    await this.ctx.storage.put('erros', erros)
    return { espera: 0, restam: TENTATIVAS_DE_CODIGO - erros }
  }

  async acertou () {
    if (await this.ctx.storage.get('erros')) await this.ctx.storage.put('erros', 0)
  }
}
