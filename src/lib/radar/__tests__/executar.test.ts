import { describe, expect, it, vi } from 'vitest'
import {
  criarBuscaComPrazo,
  diaEmBrasilia,
  executarRadar,
  jaRodouHoje,
  type RegistroRadar,
  type RepositorioRadar,
  type UltimaExecucao,
} from '../executar'

const AGORA = new Date('2026-10-29T10:00:00Z')
const URL1 = 'https://www.stj.jus.br/noticia/1'

/** Repositório em memória que reproduz a semântica atômica do INSERT ... ON CONFLICT ... WHERE. */
function repoFalso(inicial: UltimaExecucao | null = null) {
  let linha: UltimaExecucao | null = inicial
  const registros: RegistroRadar[] = []
  const gravadasT: unknown[] = []
  const gravadasTeses: unknown[] = []
  const repo: RepositorioRadar = {
    async reivindicar(agora, forcar) {
      if (linha && linha.status === 'rodando' && agora.getTime() - linha.executadoEm.getTime() < 6 * 60_000) return 'em_execucao'
      if (!forcar && jaRodouHoje(linha, agora)) return 'ja_rodou'
      linha = { status: 'rodando', executadoEm: agora, ultimoOkEm: linha?.ultimoOkEm ?? null, mensagem: null }
      return 'reivindicado'
    },
    ultimaExecucao: async () => linha,
    gravarTendencias: async (i) => (gravadasT.push(...i), i.length),
    tendenciasRecentes: async () => [{ id: 1, titulo: 'Fato', resumo: 'r', publicadoEm: null, palavrasChave: [] }],
    termosEmAlta: async () => ({ estado: 'sem_dados', termos: [] }),
    keywordsExistentes: async () => [],
    gravarTeses: async (i) => (gravadasTeses.push(...i), i.length),
    async registrar(r) {
      registros.push(r)
      linha = { status: r.status, executadoEm: r.executadoEm, mensagem: r.mensagem, ultimoOkEm: r.status === 'ok' ? r.executadoEm : (linha?.ultimoOkEm ?? null) }
    },
  }
  return { repo, registros, gravadasT, gravadasTeses, linha: () => linha }
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
const okHoje: UltimaExecucao = { status: 'ok', executadoEm: new Date('2026-10-29T08:00:00Z'), ultimoOkEm: new Date('2026-10-29T08:00:00Z'), mensagem: null }

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
    const f = repoFalso(okHoje)
    const buscar = buscarOk()
    const gerar = gerarOk()
    const r = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscar as never, gerar: gerar as never })
    expect(r).toMatchObject({ pulado: true, motivoPulo: 'ja_rodou' })
    expect(buscar).not.toHaveBeenCalled()
    expect(gerar).not.toHaveBeenCalled()
    expect(f.registros).toEqual([])
  })

  it('com forcar roda mesmo assim, ainda com no máximo uma busca e uma geração', async () => {
    const f = repoFalso(okHoje)
    const buscar = buscarOk()
    const gerar = gerarOk()
    await executarRadar({ agora: AGORA, forcar: true, repo: f.repo, buscar: buscar as never, gerar: gerar as never })
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(gerar).toHaveBeenCalledTimes(1)
  })

  it('corrida: duas execuções simultâneas gastam uma só vez (a segunda vê "em execução")', async () => {
    const f = repoFalso()
    const buscar = buscarOk()
    const gerar = gerarOk()
    const [a, b] = await Promise.all([
      executarRadar({ agora: AGORA, repo: f.repo, buscar: buscar as never, gerar: gerar as never }),
      executarRadar({ agora: AGORA, forcar: true, repo: f.repo, buscar: buscar as never, gerar: gerar as never }),
    ])
    expect([a.pulado, b.pulado].sort()).toEqual([false, true])
    expect([a, b].find((x) => x.pulado)?.motivoPulo).toBe('em_execucao')
    expect(buscar).toHaveBeenCalledTimes(1)
    expect(gerar).toHaveBeenCalledTimes(1)
  })

  it('um "rodando" com mais de 6 minutos (execução morta) pode ser retomado', async () => {
    const f = repoFalso({ status: 'rodando', executadoEm: new Date(AGORA.getTime() - 7 * 60_000), ultimoOkEm: null, mensagem: null })
    const r = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscarOk() as never, gerar: gerarOk() as never })
    expect(r.pulado).toBe(false)
  })

  it('erro depois de um ok no mesmo dia não reabre o gasto sem forcar', async () => {
    const f = repoFalso(okHoje)
    const falha = vi.fn(async () => {
      throw new Error('x')
    })
    const forcada = await executarRadar({ agora: AGORA, forcar: true, repo: f.repo, buscar: falha as never, gerar: (async () => {
      throw new Error('y')
    }) as never })
    expect(forcada.erros.map((e) => e.etapa)).toEqual(['coleta', 'teses'])
    expect(f.linha()).toMatchObject({ status: 'erro', ultimoOkEm: okHoje.ultimoOkEm })
    const buscar = buscarOk()
    const gerar = gerarOk()
    const seguinte = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscar as never, gerar: gerar as never })
    expect(seguinte).toMatchObject({ pulado: true, motivoPulo: 'ja_rodou' })
    expect(buscar).not.toHaveBeenCalled()
  })

  it('execução anterior só com erro (sem ok) não trava a nova tentativa', () => {
    expect(jaRodouHoje({ status: 'erro', executadoEm: AGORA, ultimoOkEm: null, mensagem: null }, AGORA)).toBe(false)
  })

  it('o dia é o de Brasília: 02:00 UTC ainda é o dia anterior', () => {
    expect(diaEmBrasilia(new Date('2026-10-29T02:00:00Z'))).toBe('2026-10-28')
    const antes = new Date('2026-10-29T02:00:00Z')
    expect(jaRodouHoje({ status: 'ok', executadoEm: antes, ultimoOkEm: antes, mensagem: null }, AGORA)).toBe(false)
  })

  it('falha na busca registra erro com mensagem fixa e, havendo fato dos últimos 14 dias, ainda gera teses uma vez', async () => {
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

  it('coleta falhou e não há fato dos últimos 14 dias: não gasta a geração, mesmo com termos em alta', async () => {
    const f = repoFalso()
    f.repo.tendenciasRecentes = async () => []
    f.repo.termosEmAlta = async () => ({ estado: 'ok', termos: [{ query: 'q', atual: 10, anterior: 1, aumento: 9 }] })
    const gerar = gerarOk()
    const buscar = vi.fn(async () => {
      throw new Error('x')
    })
    await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscar as never, gerar: gerar as never })
    expect(gerar).not.toHaveBeenCalled()
  })

  it('registra o que o conflito de hash descartou como ja_coletada', async () => {
    const f = repoFalso()
    f.repo.gravarTendencias = async () => 0
    const r = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscarOk() as never, gerar: gerarOk() as never })
    expect(r.coleta?.rejeitadas.ja_coletada).toBe(1)
  })
})

describe('orçamento de tempo', () => {
  it('passou de 190 s: pula a geração de teses, mas registra o desfecho', async () => {
    const f = repoFalso()
    let t = 0
    const buscar = vi.fn(async () => {
      t += 200_000
      return { valor: { tendencias: [] }, fontes: [] }
    })
    const gerar = gerarOk()
    const r = await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscar as never, gerar: gerar as never, relogio: () => t })
    expect(gerar).not.toHaveBeenCalled()
    expect(r.erros).toEqual([{ etapa: 'teses', erro: 'PrazoEsgotadoError' }])
    expect(f.registros).toHaveLength(1)
    expect(f.registros[0].status).toBe('erro')
  })

  it('registra mesmo se algo inesperado lançar no meio (finally)', async () => {
    const f = repoFalso()
    f.repo.tendenciasRecentes = async () => {
      throw new Error('banco')
    }
    await executarRadar({ agora: AGORA, repo: f.repo, buscar: buscarOk() as never, gerar: gerarOk() as never })
    expect(f.registros).toHaveLength(1)
  })

  const env = { OPENROUTER_API_KEY: 'k' }
  const schema = { parse: () => null } as never
  const resposta = (text: string) => ({ text, sources: [] }) as never

  it('com 130 s gastos, a nova tentativa da busca (JSON inválido) não acontece', async () => {
    let t = 0
    const gerarTexto = vi.fn(async () => {
      t += 130_000
      return resposta('não é json')
    })
    const buscar = criarBuscaComPrazo({ relogio: () => t, inicio: 0, gerarTexto: gerarTexto as never, env })
    await expect(buscar({ schema: (await import('zod')).z.object({ a: (await import('zod')).z.string() }), prompt: 'p' })).rejects.toThrow()
    expect(gerarTexto).toHaveBeenCalledTimes(1)
    void schema
  })

  it('com pouco tempo gasto, a nova tentativa acontece (no máximo duas chamadas)', async () => {
    let t = 0
    const gerarTexto = vi.fn(async () => {
      t += 10_000
      return resposta('não é json')
    })
    const { z } = await import('zod')
    const buscar = criarBuscaComPrazo({ relogio: () => t, inicio: 0, gerarTexto: gerarTexto as never, env })
    await expect(buscar({ schema: z.object({ a: z.string() }), prompt: 'p' })).rejects.toThrow()
    expect(gerarTexto).toHaveBeenCalledTimes(2)
  })
})
