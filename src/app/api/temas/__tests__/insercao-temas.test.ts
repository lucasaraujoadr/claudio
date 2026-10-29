import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'
import type { ClustersGerados } from '@/lib/ai/schemas'

/** O alvo do onConflictDoNothing (comparado pelo nome: resetModules recria o schema). */
const alvo = (c: unknown) => (c as { target?: { name?: string } }).target?.name

type Linha = Record<string, unknown>

/**
 * Banco falso: grava em memória e simula o índice único de topics.keyword_normalizada
 * (com onConflictDoNothing, a linha conflitante é ignorada em vez de lançar).
 */
function bancoFalso(keywordsExistentes: string[] = []) {
  const topicos: Linha[] = keywordsExistentes.map((k, i) => ({ id: i + 1, keywordNormalizada: k }))
  const clustersGravados: Linha[] = []
  const conflitos: unknown[] = []
  const apagados: number[] = []
  let seq = 100
  const insert = (tabela: unknown) => ({
    values: (v: Linha | Linha[]) => {
      const linhas = Array.isArray(v) ? v : [v]
      const nome = getTableName(tabela as never)
      const gravar = (ignorarConflito: boolean) => {
        const gravadas: Linha[] = []
        for (const l of linhas) {
          if (nome === 'topics') {
            if (typeof l.keywordNormalizada !== 'string') throw new Error('keywordNormalizada ausente')
            if (topicos.some((t) => t.keywordNormalizada === l.keywordNormalizada)) {
              if (ignorarConflito) continue
              throw new Error('duplicate key value violates unique constraint')
            }
            const g = { ...l, id: ++seq }
            topicos.push(g)
            gravadas.push(g)
          } else {
            const g = { ...l, id: ++seq }
            clustersGravados.push(g)
            gravadas.push(g)
          }
        }
        return gravadas
      }
      return {
        returning: async () => gravar(false),
        onConflictDoNothing: (opts: unknown) => {
          conflitos.push(opts)
          return { returning: async () => gravar(true), then: (r: (x: unknown) => void) => r(gravar(true)) }
        },
        then: (r: (x: unknown) => void) => r(gravar(false)),
      }
    },
  })
  const del = (tabela: unknown) => ({
    where: async () => {
      if (getTableName(tabela as never) === 'clusters') apagados.push(clustersGravados.length)
    },
  })
  const db = {
    insert,
    delete: del,
    transaction: async <T,>(fn: (tx: unknown) => Promise<T>) => fn({ insert, delete: del }),
  }
  return { db, topicos, clustersGravados, conflitos, apagados }
}

function formulario(campos: Record<string, string>) {
  const corpo = new FormData()
  for (const [k, v] of Object.entries(campos)) corpo.set(k, v)
  return new Request('http://localhost/api/x', { method: 'POST', body: corpo }) as never
}

describe('POST /api/temas/criar-de-query', () => {
  beforeEach(() => vi.resetModules())

  async function chamar(banco: ReturnType<typeof bancoFalso>, query: string) {
    vi.doMock('@/lib/db', () => ({ getDb: () => banco.db }))
    const { POST } = await import('../criar-de-query/route')
    const r = await POST(formulario({ query }))
    return new URL(r.headers.get('location') ?? '').searchParams.get('tema')
  }

  it('grava keyword_normalizada e usa onConflictDoNothing na coluna', async () => {
    const banco = bancoFalso()
    expect(await chamar(banco, 'Cálculos  Trabalhistas')).toBe('criado')
    expect(banco.topicos[0]).toMatchObject({ keyword: 'Cálculos  Trabalhistas', keywordNormalizada: 'calculos trabalhistas' })
    expect(banco.conflitos.map(alvo)).toEqual(['keyword_normalizada'])
  })

  it('query sem acento de um tema com acento já existente não cria outro', async () => {
    const banco = bancoFalso(['calculos trabalhistas'])
    expect(await chamar(banco, 'calculos trabalhistas')).toBe('existia')
    expect(banco.topicos).toHaveLength(1)
  })

  it('duplo clique: a segunda requisição vira "existia" em vez de erro ou duplicata', async () => {
    const banco = bancoFalso()
    expect(await chamar(banco, 'pericia bancaria')).toBe('criado')
    vi.resetModules()
    expect(await chamar(banco, 'Perícia Bancária')).toBe('existia')
    expect(banco.topicos).toHaveLength(1)
  })
})

describe('POST /api/temas/pesquisar', () => {
  beforeEach(() => vi.resetModules())

  const tema = (keyword: string) => ({ titulo: `T ${keyword}`, keyword, intencao: 'informacional' as const, prioridade: 'media' as const })
  const cluster = (nome: string, keywords: string[]) => ({
    nome, keywordPilar: nome, intencao: 'informacional' as const, prioridade: 'alta' as const, temas: keywords.map(tema),
  })

  async function chamar(banco: ReturnType<typeof bancoFalso>, gerados: ClustersGerados, existentesNoContexto: string[] = []) {
    vi.doMock('@/lib/db', () => ({ getDb: () => banco.db }))
    vi.doMock('@/lib/ai/cliente', () => ({ openaiConfigurada: () => true, ChaveOpenAIAusenteError: class extends Error {} }))
    vi.doMock('@/lib/ai/contexto', () => ({
      carregarContexto: async () => ({ servicos: [], termosGsc: [], temasExistentes: existentesNoContexto, lacunasAuditoria: [] }),
    }))
    const real = await vi.importActual<typeof import('@/lib/ai/temas')>('@/lib/ai/temas')
    vi.doMock('@/lib/ai/temas', () => ({ ...real, pesquisarTemas: async () => gerados }))
    const { POST } = await import('../pesquisar/route')
    const r = await POST(formulario({}))
    return new URL(r.headers.get('location') ?? '').searchParams
  }

  it('grava keyword_normalizada e informa quantos temas entraram', async () => {
    const banco = bancoFalso()
    const p = await chamar(banco, { clusters: [cluster('A', ['Perícia Contábil', 'Liquidação'])] })
    expect(p.get('pesquisa')).toBe('ok')
    expect(p.get('novos')).toBe('2')
    expect(banco.topicos.map((t) => t.keywordNormalizada)).toEqual(['pericia contabil', 'liquidacao'])
    expect(banco.conflitos.map(alvo)).toEqual(['keyword_normalizada'])
  })

  it('um tema que colide no índice (corrida) é ignorado sem desfazer os demais', async () => {
    // O contexto não sabia do tema (gravado por outra requisição no meio da pesquisa).
    const banco = bancoFalso(['pericia contabil'])
    const p = await chamar(banco, { clusters: [cluster('A', ['Perícia Contábil', 'Liquidação']), cluster('B', ['Cálculos'])] })
    expect(p.get('pesquisa')).toBe('ok')
    expect(p.get('novos')).toBe('2')
    expect(banco.topicos.map((t) => t.keywordNormalizada)).toEqual(['pericia contabil', 'liquidacao', 'calculos'])
  })

  it('cluster cujos temas todos colidiram é removido; se nada entrou, a pesquisa é "vazio"', async () => {
    const banco = bancoFalso(['pericia contabil'])
    const p = await chamar(banco, { clusters: [cluster('A', ['Perícia Contábil'])] })
    expect(p.get('pesquisa')).toBe('vazio')
    expect(banco.apagados).toHaveLength(1)
  })
})
