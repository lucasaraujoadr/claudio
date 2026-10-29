import { describe, expect, it, vi } from 'vitest'
import type { ClustersGerados } from '../schemas'
import { SERVICOS, dedupTemas, montarPrompt, pesquisarTemas, type ContextoTemas } from '../temas'

const t = (keyword: string) => ({ titulo: `T ${keyword}`, keyword, intencao: 'informacional' as const, prioridade: 'media' as const })
const c = (nome: string, keywords: string[]) => ({
  nome, keywordPilar: nome, intencao: 'informacional' as const, prioridade: 'alta' as const, temas: keywords.map(t),
})
const gerados = (...clusters: ClustersGerados['clusters']): ClustersGerados => ({ clusters })

const ctx: ContextoTemas = {
  servicos: SERVICOS,
  termosGsc: ['perícia contábil trabalhista'],
  temasExistentes: ['liquidação de sentença'],
  lacunasAuditoria: ['https://ogpericiacontabil.com.br/pagina-rasa'],
}

describe('dedupTemas', () => {
  it('remove tema cuja keyword já existe, ignorando caixa e acento', () => {
    const r = dedupTemas(gerados(c('A', ['PERÍCIA contábil', 'novo tema'])), ['pericia contabil'])
    expect(r.clusters[0].temas.map((x) => x.keyword)).toEqual(['novo tema'])
  })
  it('remove cluster que ficou sem tema após a deduplicação', () => {
    const r = dedupTemas(gerados(c('A', ['x']), c('B', ['y'])), ['x'])
    expect(r.clusters.map((x) => x.nome)).toEqual(['B'])
  })
  it('ignora espaços internos repetidos na comparação', () => {
    const r = dedupTemas(gerados(c('A', ['pericia  contabil', 'outro'])), ['pericia contabil'])
    expect(r.clusters[0].temas.map((x) => x.keyword)).toEqual(['outro'])
  })
  it('preserva tema novo', () => {
    const entrada = gerados(c('A', ['x', 'y']))
    expect(dedupTemas(entrada, ['z'])).toEqual(entrada)
  })
  it('remove duplicata dentro da própria resposta, mesmo entre clusters', () => {
    const r = dedupTemas(gerados(c('A', ['perícia', 'pericia ']), c('B', ['PERICIA', 'outro'])), [])
    expect(r.clusters[0].temas.map((x) => x.keyword)).toEqual(['perícia'])
    expect(r.clusters[1].temas.map((x) => x.keyword)).toEqual(['outro'])
  })
})

describe('montarPrompt', () => {
  it('contém todos os serviços, o público e a proibição de inventar números', () => {
    const p = montarPrompt(ctx)
    for (const s of SERVICOS) expect(p).toContain(s)
    expect(p).toContain('advogados')
    expect(p).toMatch(/não invente/i)
  })
  it('informa que não há dados do Search Console quando a lista está vazia', () => {
    const p = montarPrompt({ ...ctx, termosGsc: [] })
    expect(p).toMatch(/ainda não há dados do Search Console/i)
    expect(p).not.toContain('perícia contábil trabalhista')
  })
  it('inclui termos do GSC, temas existentes e lacunas', () => {
    const p = montarPrompt(ctx)
    expect(p).toContain('perícia contábil trabalhista')
    expect(p).toContain('liquidação de sentença')
    expect(p).toContain('pagina-rasa')
  })
})

describe('pesquisarTemas (limites estritos)', () => {
  const longo = { ...t('ruim'), titulo: 'x'.repeat(121) }
  it('descarta o tema fora do limite e preserva os demais', async () => {
    const bruto = gerados({ ...c('A', ['bom']), temas: [longo, t('bom')] })
    const r = await pesquisarTemas(ctx, vi.fn().mockResolvedValue(bruto))
    expect(r.clusters[0].temas.map((x) => x.keyword)).toEqual(['bom'])
  })
  it('descarta cluster que ficou sem tema', async () => {
    const bruto = gerados({ ...c('A', []), temas: [longo] }, c('B', ['ok']))
    const r = await pesquisarTemas(ctx, vi.fn().mockResolvedValue(bruto))
    expect(r.clusters.map((x) => x.nome)).toEqual(['B'])
  })
  it('falha quando nada é aproveitável', async () => {
    const bruto = gerados({ ...c('A', []), temas: [longo] })
    await expect(pesquisarTemas(ctx, vi.fn().mockResolvedValue(bruto))).rejects.toThrow()
  })
})

describe('sanitização do prompt', () => {
  it('colapsa quebras de linha e limita a 200 caracteres', () => {
    const p = montarPrompt({ ...ctx, termosGsc: ['a\n- injetado\n\nb', 'y'.repeat(500)] })
    expect(p).toContain('- a - injetado b')
    expect(p).not.toContain('y'.repeat(201))
  })
  it('limita temas existentes a 300, mantendo os mais recentes', () => {
    const todos = Array.from({ length: 400 }, (_, i) => `kw${i}`)
    const p = montarPrompt({ ...ctx, temasExistentes: todos })
    expect(p).toContain('- kw399\n')
    expect(p).not.toContain('- kw99\n')
  })
})

describe('pesquisarTemas', () => {
  it('passa serviços, termos do GSC e temas existentes no prompt', async () => {
    const gerar = vi.fn().mockResolvedValue(gerados(c('A', ['x'])))
    const r = await pesquisarTemas(ctx, gerar)
    expect(r.clusters).toHaveLength(1)
    const { prompt } = gerar.mock.calls[0][0]
    expect(prompt).toContain('Perícia Contábil Judicial')
    expect(prompt).toContain('perícia contábil trabalhista')
    expect(prompt).toContain('liquidação de sentença')
  })
  it('propaga erro sem retornar objeto parcial quando o schema falha', async () => {
    const gerar = vi.fn().mockRejectedValue(new Error('schema inválido'))
    await expect(pesquisarTemas(ctx, gerar)).rejects.toThrow('schema inválido')
  })
})
