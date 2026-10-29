import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'

type Linha = Record<string, unknown>

/** Banco falso: teses_sugeridas e topics em memória; topics simula o índice único com onConflictDoNothing. */
function bancoFalso(tese: Linha | null, topicosExistentes: string[] = []) {
  const teses: Linha[] = tese ? [tese] : []
  const topicos: Linha[] = topicosExistentes.map((k, i) => ({ id: i + 1, keywordNormalizada: k }))
  const conflitos: unknown[] = []
  const tx = {
    update: (t: unknown) => ({
      set: (s: Linha) => ({
        where: () => ({
          returning: async () => {
            expect(getTableName(t as never)).toBe('teses_sugeridas')
            const alvo = teses.find((x) => x.status === 'nova')
            if (!alvo) return []
            Object.assign(alvo, s)
            return [{ ...alvo }]
          },
          then: (r: (x: unknown) => void) => r(undefined),
        }),
      }),
    }),
    insert: () => ({
      values: (v: Linha) => ({
        onConflictDoNothing: (o: unknown) => {
          conflitos.push(o)
          return {
            returning: async () => {
              if (topicos.some((t) => t.keywordNormalizada === v.keywordNormalizada)) return []
              topicos.push({ ...v, id: 100 })
              return [{ id: 100 }]
            },
          }
        },
      }),
    }),
  }
  return { db: { transaction: async <T,>(fn: (t: unknown) => Promise<T>) => fn(tx) }, teses, topicos, conflitos }
}

const tese = { id: 5, titulo: 'Selic', keyword: 'Selic na liquidação', keywordNormalizada: 'selic na liquidacao', intencao: 'informacional', status: 'nova' }

describe('virarTema', () => {
  beforeEach(() => vi.resetModules())
  async function virar(b: ReturnType<typeof bancoFalso>) {
    vi.doMock('@/lib/db', () => ({ getDb: () => b.db }))
    const { virarTema } = await import('../repositorio')
    return virarTema(5)
  }

  it('cria o tema com origem tendencia e marca a tese como virou_tema', async () => {
    const b = bancoFalso({ ...tese })
    expect(await virar(b)).toBe('criado')
    expect(b.topicos[0]).toMatchObject({ origem: 'tendencia', keywordNormalizada: 'selic na liquidacao', status: 'ideia' })
    expect(b.teses[0].status).toBe('virou_tema')
    expect((b.conflitos[0] as { target: { name: string } }).target.name).toBe('keyword_normalizada')
  })
  it('conflito no índice único: diz "existia", não duplica e marca a tese como virou_tema', async () => {
    const b = bancoFalso({ ...tese }, ['selic na liquidacao'])
    expect(await virar(b)).toBe('existia')
    expect(b.topicos).toHaveLength(1)
    expect(b.teses[0].status).toBe('virou_tema')
  })
  it('segundo clique: tese já tratada não cria nada', async () => {
    const b = bancoFalso({ ...tese, status: 'virou_tema' })
    expect(await virar(b)).toBe('ja_tratada')
    expect(b.topicos).toHaveLength(0)
  })
})
