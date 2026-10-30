import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { criarClienteBrevo } from '@/lib/brevo'
import { executarCronDiario, type RegistroSincronizacao } from '@/lib/cron-diario'
import { contatos, enviosFunil, funilInscricoes, funis, importacoesContatos } from '@/lib/db/schema'
import { ErroResend, type ClienteResend } from '@/lib/resend'
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
const ORIGINAL = { ...process.env }
afterEach(async () => {
  await fechar()
  vi.restoreAllMocks()
  process.env = { ...ORIGINAL }
})

const AGORA = new Date('2026-10-29T09:00:00Z')

function resendFalso() {
  const enviados: Parameters<ClienteResend['enviarEmail']>[0][] = []
  const cliente = {
    enviarEmail: async (e: Parameters<ClienteResend['enviarEmail']>[0]) => {
      enviados.push(e)
      return { id: `re_${enviados.length}` }
    },
  } as unknown as ClienteResend
  return { cliente, enviados }
}
const ANTIGO = new Date(AGORA.getTime() - 300 * 86_400_000)

describe('executarEtapaFunis', () => {
  it('sem chave: garante os funis, inscreve a reativação e guarda pendente', async () => {
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const r = await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), resend: null, agora: AGORA })
    expect(await db.select().from(funis)).toHaveLength(4)
    expect(r.detalhes).toMatchObject({ reativacao: 1, prospeccao: 0, brevo: 'não conectado' })
    expect(r.mensagem).toContain('Brevo não conectado')
    const [i] = await db.select().from(funilInscricoes)
    expect(i).toMatchObject({ status: 'ativo', origem: 'cron' })
  })

  it('com Resend: envia as etapas devidas, inclusive as inscrições de hoje; sem acesso público, nada sai', async () => {
    process.env.DESCADASTRO_SEGREDO = 'segredo-de-teste-descartavel'
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const fora = resendFalso()
    let checagens = 0
    const semAcesso = await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), resend: fora.cliente, acessoPublico: async () => (checagens++, false), agora: AGORA })
    expect(checagens).toBe(1)
    expect(fora.enviados).toHaveLength(0)
    expect(semAcesso.detalhes).toMatchObject({ acessoPublico: 'não', enviados: 0, envioRestantes: 1 })
    expect(semAcesso.mensagem).toContain('sem acesso público')
    const r = resendFalso()
    const ok = await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), resend: r.cliente, acessoPublico: async () => true, agora: AGORA })
    expect(r.enviados).toHaveLength(1)
    expect(ok.detalhes).toMatchObject({ reativacao: 0, enviados: 1, envioErros: 0, envioRestantes: 0 })
    expect(ok.mensagem).toContain('emails enviados: 1')
    expect(await db.select().from(enviosFunil)).toHaveLength(1)
  })

  it('incertos aparecem na mensagem para alguém conferir', async () => {
    process.env.DESCADASTRO_SEGREDO = 'segredo-de-teste-descartavel'
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const cliente = { enviarEmail: async () => { throw new ErroResend('rede') } } as unknown as ClienteResend
    const r = await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), resend: cliente, acessoPublico: async () => true, agora: AGORA })
    expect(r.detalhes).toMatchObject({ enviados: 0, envioIncertos: 1 })
    expect(r.mensagem).toContain('incertos (conferir no Resend; não são repetidos): 1')
  })

  it('sem chave do Resend: nada é enviado e a mensagem diz', async () => {
    const r = await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), resend: null, agora: AGORA })
    expect(r.detalhes.resend).toBe('não configurado')
    expect(r.mensagem).toContain('Resend não configurado')
  })

  it('uma subetapa que falha não impede as outras; o erro só traz nomes de etapas', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await db.insert(contatos).values({ nome: 'C', email: 'segredo@example.com', emailNormalizado: 'segredo@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), resend: null, agora: AGORA })
    const b = brevoFalso()
    b.cliente.upsertContato = async () => {
      throw new Error('segredo@example.com explodiu')
    }
    const e = await executarEtapaFunis({ db, cliente: b.cliente, resend: null, agora: AGORA }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(FalhaEtapaFunis)
    const f = e as FalhaEtapaFunis
    expect(f.falhas).toEqual(['contatos'])
    expect(f.parcial.detalhes).toHaveProperty('prospeccao')
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
    const r = await executarEtapaFunis({ db, cliente: criarClienteBrevo({ apiKey: null }), resend: null, agora: AGORA })
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
    const e = await executarEtapaFunis({ db, cliente: b.cliente, resend: resendFalso().cliente, acessoPublico: async () => true, agora: AGORA, relogio: () => agoraMs, prazoMs: 90_000 }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(FalhaEtapaFunis)
    const f = e as FalhaEtapaFunis
    expect(f.mensagemSegura).toMatch(/^Interrompido por tempo/)
    expect(f.mensagemSegura).toContain('envios')
    // Parou dentro do envio de contatos: nem todos foram, e a etapa dos envios não rodou.
    expect(b.chamadas.filter((c) => c.op === 'upsert').length).toBeLessThan(12)

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
    const r = await executarEtapaFunis({ db, cliente: brevoFalso().cliente, resend: null, agora: AGORA, relogio: () => 0 })
    expect(r.mensagem).not.toContain(INTERROMPIDO_POR_TEMPO)
  })
})
