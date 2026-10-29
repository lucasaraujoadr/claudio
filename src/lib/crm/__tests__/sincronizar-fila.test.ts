import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { contatos } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { sincronizarPendentes } from '../sincronizar'
import { criarBancoTesteFunis } from './banco-teste-funis'
import { brevoFalso } from './brevo-fake'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
})

const novo = (i: number, syncStatus: 'pendente' | 'erro') => ({
  nome: `P${i}`,
  email: `p${i}@example.com`,
  emailNormalizado: `p${i}@example.com`,
  origem: 'planilha' as const,
  baseLegal: 'contrato' as const,
  syncStatus,
})

describe('sincronizarPendentes: ordem e filtro (E9)', () => {
  it('pendente antes de erro: contatos que sempre falham (ids baixos) não tomam o teto', async () => {
    await db.insert(contatos).values([novo(1, 'erro'), novo(2, 'erro'), novo(3, 'erro'), novo(4, 'pendente')])
    const b = brevoFalso()
    await sincronizarPendentes({ db, cliente: b.cliente, limite: 1, registrar: false })
    expect(b.chamadas.filter((c) => c.op === 'upsert').map((c) => c.email)).toEqual(['p4@example.com'])
  })

  it('quem falha na fase pendente não é tentado de novo na fase erro da mesma execução', async () => {
    await db.insert(contatos).values([novo(1, 'pendente')])
    const b = brevoFalso()
    b.falhar('p1@example.com', { ok: false, motivo: 'http', status: 400, mensagem: 'O Brevo recusou os dados (400).' })
    const r = await sincronizarPendentes({ db, cliente: b.cliente, registrar: false })
    expect(r).toMatchObject({ erros: 1 })
    expect(b.chamadas.filter((c) => c.op === 'upsert')).toHaveLength(1)
  })

  it('`ids` limita aos contatos pedidos', async () => {
    const [a] = await db.insert(contatos).values([novo(1, 'pendente'), novo(2, 'pendente')]).returning()
    const b = brevoFalso()
    await sincronizarPendentes({ db, cliente: b.cliente, ids: [a.id], registrar: false })
    expect(b.chamadas.filter((c) => c.op === 'upsert').map((c) => c.email)).toEqual(['p1@example.com'])
    b.chamadas.length = 0
    await sincronizarPendentes({ db, cliente: b.cliente, ids: [], registrar: false })
    expect(b.chamadas).toHaveLength(0)
  })
})
