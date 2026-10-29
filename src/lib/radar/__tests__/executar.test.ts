import { describe, expect, it, vi } from 'vitest'
import { diaEmBrasilia, executarRadar, jaRodouHoje, type RegistroRadar, type RepositorioRadar } from '../executar'

const AGORA = new Date('2026-10-29T10:00:00Z')
const URL1 = 'https://www.stj.jus.br/noticia/1'

function repoFalso(ultima: { status: string; executadoEm: Date } | null = null) {
  const registros: RegistroRadar[] = []
  const gravadasT: unknown[] = []
  const gravadasTeses: unknown[] = []
  const repo: RepositorioRadar = {
    ultimaExecucao: async () => ultima,
    gravarTendencias: async (i) => (gravadasT.push(...i), i.length),
    tendenciasRecentes: async () => [{ id: 1, titulo: 'Fato', resumo: 'r', publicadoEm: null, palavrasChave: [] }],
    termosEmAlta: async () => ({ estado: 'sem_dados', termos: [] }),
    keywordsExistentes: async () => [],
    gravarTeses: async (i) => (gravadasTeses.push(...i), i.length),
    registrar: async (r) => void registros.push(r),
  }
  return { repo, registros, gravadasT, gravadasTeses }
}
const buscarOk = () =>
  vi.fn(async () => ({
    valor: { tendencias: [{ titulo: 'T', resumo: 'R', fonteUrl: URL1, publicadoEm: null, palavrasChave: [] }] },
    fontes: [URL1],
  }))
const gerarOk = () =>
  vi.fn(async () => ({
    teses: [{ titulo: 'Tese', keyword: 'tese a', intencao: 'informacional', justificativa: 'Motivada pelo fato 1 para advogados.', potencial: 'alto', tendenciaId: 1, termosEmAlta: [] }],
  }))

describe('executarRadar', () => {
  it('faz uma busca e uma geração de teses, grava e registra', async () => {
    const f = repoFalso()
    const buscar = buscarOk()
    const gerar = gerarOk()
    const r = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscar as never, gerar: gerar as never })
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(gerar).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ pulado: false, erros: [], coleta: { retornadas: 1, gravadas: 1 }, teses: { gravadas: 1 } })
    expect(f.registros).toEqual([expect.objectContaining({ fonte: 'tendencias', status: 'ok', linhas: 2 })])
  })
  it('teto de custo: já rodou com sucesso hoje, sem forcar, não chama ninguém', async () => {
    const f = repoFalso({ status: 'ok', executadoEm: new Date('2026-10-29T08:00:00Z') })
    const buscar = buscarOk()
    const gerar = gerarOk()
    const r = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscar as never, gerar: gerar as never })
    expect(r.pulado).toBe(true)
    expect(buscar).not.toHaveBeenCalled()
    expect(gerar).not.toHaveBeenCalled()
    expect(f.registros).toEqual([])
  })
  it('com forcar roda mesmo assim, ainda com no máximo uma busca e uma geração', async () => {
    const f = repoFalso({ status: 'ok', executadoEm: new Date('2026-10-29T08:00:00Z') })
    const buscar = buscarOk()
    const gerar = gerarOk()
    await executarRadar({ agora: AGORA, forcar: true, repo: f.repo, buscar: buscar as never, gerar: gerar as never })
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(gerar).toHaveBeenCalledTimes(1)
  })
  it('execução anterior com erro não trava a nova tentativa do dia', () => {
    expect(jaRodouHoje({ status: 'erro', executadoEm: AGORA }, AGORA)).toBe(false)
  })
  it('o dia é o de Brasília: 02:00 UTC ainda é o dia anterior', () => {
    expect(diaEmBrasilia(new Date('2026-10-29T02:00:00Z'))).toBe('2026-10-28')
    expect(jaRodouHoje({ status: 'ok', executadoEm: new Date('2026-10-29T02:00:00Z') }, AGORA)).toBe(false)
  })
  it('falha na busca registra erro com mensagem fixa, mas ainda gera teses uma vez', async () => {
    const f = repoFalso()
    const buscar = vi.fn(async () => {
      throw new Error('segredo-do-provedor')
    })
    const gerar = gerarOk()
    const r = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscar as never, gerar: gerar as never })
    expect(r.erros).toEqual([{ etapa: 'coleta', erro: 'Error' }])
    expect(gerar).toHaveBeenCalledTimes(1)
    expect(f.registros[0].status).toBe('erro')
    expect(f.registros[0].mensagem).not.toContain('segredo')
  })
  it('registra o que o conflito de hash descartou como ja_coletada', async () => {
    const f = repoFalso()
    f.repo.gravarTendencias = async () => 0
    const r = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscarOk() as never, gerar: gerarOk() as never })
    expect(r.coleta?.rejeitadas.ja_coletada).toBe(1)
  })
})
