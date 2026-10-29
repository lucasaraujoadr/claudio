import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { criarClienteBrevo } from '@/lib/brevo'
import { executarCronDiario, type RegistroSincronizacao } from '@/lib/cron-diario'
import { contatos, funilInscricoes, funis, importacoesContatos } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { executarEtapaFunis, FalhaEtapaFunis } from '../funis-cron'
import { INTERROMPIDO_POR_TEMPO } from '../funis'
import { criarBancoTesteFunis } from './banco-teste-funis'
import { brevoFalso } from './brevo-fake'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
  vi.restoreAllMocks()
})

const AGORA = new Date('2026-10-29T09:00:00Z')
const ANTIGO = new Date(AGORA.getTime() - 300 * 86_400_000)

describe('executarEtapaFunis', () => {
  it('sem chave: garante os funis, inscreve a reativação e guarda pendente', async () => {
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const r = await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), agora: AGORA })
    expect(await db.select().from(funis)).toHaveLength(4)
    expect(r.detalhes).toMatchObject({ reativacao: 1, prospeccao: 0, brevo: 'não conectado' })
    expect(r.mensagem).toContain('Brevo não conectado')
    const [i] = await db.select().from(funilInscricoes)
    expect(i).toMatchObject({ status: 'ativo', origem: 'cron', listaSync: 'pendente' })
  })

  it('com chave: envia o contato ao Brevo e depois o põe na lista do funil', async () => {
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), agora: AGORA })
    await db.update(funis).set({ brevoListaId: 5 }).where(eq(funis.slug, 'reativacao'))
    const b = brevoFalso()
    const r = await executarEtapaFunis({ db, cliente: b.cliente, agora: AGORA })
    expect(r.detalhes).toMatchObject({ contatosEnviados: 1, listasAdicionados: 1 })
    expect(b.contatos.get('c@example.com')?.listIds).toEqual([5])
  })

  it('uma subetapa que falha não impede as outras; o erro só traz nomes de etapas', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await db.insert(contatos).values({ nome: 'C', email: 'segredo@example.com', emailNormalizado: 'segredo@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), agora: AGORA })
    await db.update(funis).set({ brevoListaId: 5 }).where(eq(funis.slug, 'reativacao'))
    const b = brevoFalso()
    b.cliente.upsertContato = async () => {
      throw new Error('segredo@example.com explodiu')
    }
    const e = await executarEtapaFunis({ db, cliente: b.cliente, agora: AGORA }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(FalhaEtapaFunis)
    const f = e as FalhaEtapaFunis
    expect(f.falhas).toEqual(['contatos'])
    expect(f.parcial.detalhes).toHaveProperty('listasAdicionados')
    expect(f.mensagemSegura).not.toContain('segredo')
    expect(JSON.stringify(log.mock.calls)).not.toContain('segredo')
  })
})

describe('rotina diária com funis', () => {
  function registrador() {
    const regs: RegistroSincronizacao[] = []
    return { regs, registrar: async (r: RegistroSincronizacao) => void regs.push(r) }
  }

  it('falha dos funis não afeta o GSC e o GA4; registra fonte "funis" sem dado de contato', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { regs, registrar } = registrador()
    const r = await executarCronDiario({
      hoje: AGORA,
      gsc: async () => ({ linhas: 1 }),
      ga4: async () => ({ linhas: 2 }),
      funis: async () => {
        throw new Error('duplicate key (email)=(fulano@example.com)')
      },
      registrar,
    })
    expect(r.gsc.status).toBe('ok')
    expect(r.ga4.status).toBe('ok')
    expect(r.funis?.status).toBe('erro')
    const porFonte = Object.fromEntries(regs.map((x) => [x.fonte, x]))
    expect(porFonte.funis).toMatchObject({ fonte: 'funis', status: 'erro' })
    expect(JSON.stringify(regs)).not.toContain('fulano')
    expect(JSON.stringify(log.mock.calls)).not.toContain('fulano')
  })

  it('funis ok gravam a mensagem própria; falha parcial grava as etapas que falharam', async () => {
    const { regs, registrar } = registrador()
    await executarCronDiario({ hoje: AGORA, gsc: null, ga4: null, funis: async () => ({ linhas: 3, mensagem: 'Reativação: 3.' }), registrar })
    expect(regs.find((x) => x.fonte === 'funis')).toMatchObject({ status: 'ok', linhas: 3, mensagem: 'Reativação: 3.' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { regs: r2, registrar: reg2 } = registrador()
    await executarCronDiario({
      hoje: AGORA,
      gsc: null,
      ga4: null,
      funis: async () => {
        throw new FalhaEtapaFunis(['reativacao'], { linhas: 0, detalhes: {}, mensagem: 'Reativação: —.' })
      },
      registrar: reg2,
    })
    expect(r2.find((x) => x.fonte === 'funis')?.mensagem).toBe('Falha em: reativacao. Reativação: —.')
  })
})

describe('dados mínimos: lotes de planilha vencidos', () => {
  it('a etapa diária apaga lotes com mais de 24 h (com o CSV inteiro) e mantém os recentes', async () => {
    await db.insert(importacoesContatos).values([
      { id: 'velho', nomeArquivo: 'a.csv', conteudo: 'email\nfulano@example.com', totalLinhas: 1, criadoEm: new Date(AGORA.getTime() - 25 * 3_600_000) },
      { id: 'novo', nomeArquivo: 'b.csv', conteudo: 'email\nciclano@example.com', totalLinhas: 1, criadoEm: new Date(AGORA.getTime() - 3_600_000) },
    ])
    const r = await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), agora: AGORA })
    expect((await db.select().from(importacoesContatos)).map((l) => l.id)).toEqual(['novo'])
    expect(r.detalhes.lotesApagados).toBe(1)
  })
})

describe('prazo interno da etapa de funis', () => {
  it('passou do prazo: para entre subetapas/lotes e a rotina grava "interrompido por tempo", nunca ok', async () => {
    await db.insert(contatos).values(
      Array.from({ length: 12 }, (_, i) => ({ nome: 'C', email: `t${i}@example.com`, emailNormalizado: `t${i}@example.com`, origem: 'planilha' as const, baseLegal: 'contrato' as const, status: 'cliente' as const, criadoEm: ANTIGO })),
    )
    const b = brevoFalso()
    let agoraMs = 0
    const upsert = b.cliente.upsertContato
    // Cada envio ao Brevo "demora" 20 s no relógio falso.
    b.cliente.upsertContato = async (c) => {
      agoraMs += 20_000
      return upsert(c)
    }
    const e = await executarEtapaFunis({ db, cliente: b.cliente, agora: AGORA, relogio: () => agoraMs, prazoMs: 90_000 }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(FalhaEtapaFunis)
    const f = e as FalhaEtapaFunis
    expect(f.mensagemSegura).toMatch(/^Interrompido por tempo/)
    expect(f.mensagemSegura).toContain('listas')
    // Parou dentro do envio de contatos: nem todos foram, e a etapa das listas não rodou.
    expect(b.chamadas.filter((c) => c.op === 'upsert').length).toBeLessThan(12)
    expect(b.chamadas.filter((c) => c.op === 'adicionarALista')).toHaveLength(0)

    const regs: RegistroSincronizacao[] = []
    await executarCronDiario({
      hoje: AGORA,
      gsc: null,
      ga4: null,
      funis: async () => {
        throw e
      },
      registrar: async (r) => void regs.push(r),
    })
    expect(regs.find((x) => x.fonte === 'funis')).toMatchObject({ status: 'erro', mensagem: expect.stringMatching(/^Interrompido por tempo/) })
  })

  it('dentro do prazo: nada é interrompido', async () => {
    const r = await executarEtapaFunis({ db, cliente: brevoFalso().cliente, agora: AGORA, relogio: () => 0 })
    expect(r.mensagem).not.toContain(INTERROMPIDO_POR_TEMPO)
  })
})
