import { describe, expect, it, vi } from 'vitest'
import { gerarTeses, montarPromptTeses, tesesSchemaModelo, validarTeses, type ContextoTeses, type TesesModelo } from '../teses'

const ctx: ContextoTeses = {
  tendencias: [{ id: 7, titulo: 'STJ fixa tese sobre Selic', resumo: 'r', publicadoEm: '2026-10-27', palavrasChave: [] }],
  termosEmAlta: [{ query: 'pasep cálculo', atual: 100, anterior: 10, aumento: 90 }],
  existentes: ['Liquidação de Sentença'],
}
const tese = (extra: Partial<TesesModelo['teses'][number]> = {}) => ({
  titulo: 'Selic na liquidação', keyword: 'selic liquidação', intencao: 'informacional' as const,
  justificativa: 'Motivada pelo fato [7]: advogados precisam recalcular.', potencial: 'medio' as const,
  tendenciaId: 7, termosEmAlta: [], ...extra,
})

describe('validarTeses', () => {
  it('deduplica contra existentes (ignora caixa e acento) e dentro da resposta', () => {
    const r = validarTeses({ teses: [tese({ keyword: 'LIQUIDACAO DE SENTENÇA' }), tese({ keyword: 'Nova A' }), tese({ keyword: 'nova a' })] }, ctx)
    expect(r.validas.map((t) => t.keyword)).toEqual(['Nova A'])
    expect(r.validas[0].keywordNormalizada).toBe('nova a')
    expect(r.rejeitadas).toBe(2)
  })
  it('descarta tese cujo tendenciaId e termos não existem no contexto (sem sinal verificável)', () => {
    const r = validarTeses({ teses: [tese({ tendenciaId: 99, termosEmAlta: ['termo inventado'] })] }, ctx)
    expect(r.validas).toEqual([])
  })
  it('aceita termo em alta por cópia exata (normalizada) e monta os sinais', () => {
    const r = validarTeses({ teses: [tese({ tendenciaId: null, termosEmAlta: ['PASEP Cálculo'] })] }, ctx)
    expect(r.validas[0]).toMatchObject({ tendenciaId: null, sinais: ['Termo em alta: pasep cálculo'] })
  })
  it('descarta item fora dos limites estritos sem perder os demais', () => {
    const r = validarTeses({ teses: [tese({ keyword: 'x'.repeat(81) }), tese({ justificativa: 'curta' }), tese({ keyword: 'ok' })] }, ctx)
    expect(r.validas.map((t) => t.keyword)).toEqual(['ok'])
  })
  it('limita a 8', () => {
    const r = validarTeses({ teses: Array.from({ length: 8 }, (_, i) => tese({ keyword: `k${i}` })) }, ctx)
    expect(r.validas).toHaveLength(8)
  })
})

describe('gerarTeses', () => {
  it('sem fatos nem termos não chama o modelo', async () => {
    const gerar = vi.fn()
    const r = await gerarTeses({ tendencias: [], termosEmAlta: [], existentes: [] }, gerar)
    expect(gerar).not.toHaveBeenCalled()
    expect(r.chamou).toBe(false)
  })
  it('chama o modelo uma vez', async () => {
    const gerar = vi.fn(async () => ({ teses: [tese({ keyword: 'a' })] }))
    const r = await gerarTeses(ctx, gerar as never)
    expect(gerar).toHaveBeenCalledTimes(1)
    expect(r.validas).toHaveLength(1)
  })
})

describe('montarPromptTeses', () => {
  it('traz os fatos com id, os termos e o aviso de não inventar; sem GSC, diz que não há dados', () => {
    const p = montarPromptTeses(ctx)
    expect(p).toContain('[7] STJ fixa tese sobre Selic')
    expect(p).toContain('pasep cálculo')
    expect(p).toMatch(/Não invente volumes/)
    expect(montarPromptTeses({ ...ctx, termosEmAlta: [] })).toContain('Não há dados do Search Console ainda')
  })
})

describe('tesesSchemaModelo', () => {
  it('não tem minLength nem maxLength no JSON Schema enviado ao modelo', async () => {
    const { zodSchema } = await import('ai')
    const json = JSON.stringify(await zodSchema(tesesSchemaModelo).jsonSchema)
    expect(json).not.toContain('minLength')
    expect(json).not.toContain('maxLength')
    expect(json).toContain('maxItems')
  })
})
