import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executarCronDiario, type RegistroSincronizacao } from '@/lib/cron-diario'
import { contatos, enviosFunil, funilInscricoes, funis, importacoesContatos } from '@/lib/db/schema'
import { ErroResend, type ClienteResend } from '@/lib/resend'
import type { BancoCrm } from '../banco'
import { executarEtapaFunis, FalhaEtapaFunis, paraRelatorioCron } from '../funis-cron'
import { INTERROMPIDO_POR_TEMPO } from '../funis'
import { criarBancoTesteFunis } from './banco-teste-funis'

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
    salvarContato: async () => ({ id: 'rc_1' }),
    garantirSegmento: async () => ({ id: 'seg_1' }),
    adicionarAoSegmento: async () => {},
    removerDoSegmento: async () => {},
  } as unknown as ClienteResend
  return { cliente, enviados }
}
const ANTIGO = new Date(AGORA.getTime() - 300 * 86_400_000)

describe('executarEtapaFunis', () => {
  it('sem chave do Resend: garante os funis, inscreve a reativação e guarda pendente', async () => {
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const r = await executarEtapaFunis({ db, resend: null, agora: AGORA })
    expect(await db.select().from(funis)).toHaveLength(4)
    expect(r.detalhes).toMatchObject({ reativacao: 1, prospeccao: 0, resend: 'não configurado' })
    expect(r.detalhes).not.toHaveProperty('brevo')
    const [i] = await db.select().from(funilInscricoes)
    expect(i).toMatchObject({ status: 'ativo', origem: 'cron' })
  })

  it('com Resend: envia as etapas devidas, inclusive as inscrições de hoje; sem acesso público, nada sai', async () => {
    process.env.DESCADASTRO_SEGREDO = 'segredo-de-teste-descartavel'
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const fora = resendFalso()
    let checagens = 0
    const semAcesso = await executarEtapaFunis({ db, resend: fora.cliente, acessoPublico: async () => (checagens++, false), agora: AGORA })
    expect(checagens).toBe(1)
    expect(fora.enviados).toHaveLength(0)
    expect(semAcesso.detalhes).toMatchObject({ acessoPublico: 'não', enviados: 0, envioRestantes: 1 })
    expect(semAcesso.mensagem).toContain('sem acesso público')
    const r = resendFalso()
    const ok = await executarEtapaFunis({ db, resend: r.cliente, acessoPublico: async () => true, agora: AGORA })
    expect(r.enviados).toHaveLength(1)
    expect(ok.detalhes).toMatchObject({ reativacao: 0, enviados: 1, envioErros: 0, envioRestantes: 0 })
    expect(ok.mensagem).toContain('emails enviados: 1')
    expect(await db.select().from(enviosFunil)).toHaveLength(1)
  })

  it('incertos aparecem na mensagem para alguém conferir', async () => {
    process.env.DESCADASTRO_SEGREDO = 'segredo-de-teste-descartavel'
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const cliente = { enviarEmail: async () => { throw new ErroResend('rede') } } as unknown as ClienteResend
    const r = await executarEtapaFunis({ db, resend: cliente, acessoPublico: async () => true, agora: AGORA })
    expect(r.detalhes).toMatchObject({ enviados: 0, envioIncertos: 1 })
    expect(r.mensagem).toContain('incertos (conferir no Resend; não são repetidos): 1')
  })

  it('sem chave do Resend: nada é enviado e a mensagem diz', async () => {
    const r = await executarEtapaFunis({ db, resend: null, agora: AGORA })
    expect(r.detalhes.resend).toBe('não configurado')
    expect(r.mensagem).toContain('Resend não configurado')
  })

  it('com Resend: sincroniza os contatos pendentes antes dos envios', async () => {
    await db.insert(contatos).values({ nome: 'C', email: 'c@example.com', emailNormalizado: 'c@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const r = await executarEtapaFunis({ db, resend: resendFalso().cliente, acessoPublico: async () => true, agora: AGORA })
    expect(r.detalhes).toMatchObject({ contatosEnviados: 1, contatosErros: 0 })
    expect(r.mensagem).toContain('contatos sincronizados: 1')
    const [c] = await db.select().from(contatos)
    expect(c.syncStatus).toBe('sincronizado')
  })

  it('uma subetapa que falha não impede as outras; o erro só traz nomes de etapas', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    await db.insert(contatos).values({ nome: 'C', email: 'segredo@example.com', emailNormalizado: 'segredo@example.com', origem: 'planilha', baseLegal: 'contrato', status: 'cliente', criadoEm: ANTIGO })
    const e = await executarEtapaFunis({
      db,
      resend: resendFalso().cliente,
      acessoPublico: async () => {
        throw new Error('segredo@example.com explodiu')
      },
      agora: AGORA,
    }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(FalhaEtapaFunis)
    const f = e as FalhaEtapaFunis
    expect(f.falhas).toEqual(['envios'])
    expect(f.parcial.detalhes).toHaveProperty('contatosEnviados')
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

  it('sem chave do Resend, a fonte funis é registrada como nao_configurado (e a inscrição continua)', async () => {
    const { regs, registrar } = registrador()
    const r = await executarCronDiario({
      hoje: AGORA,
      gsc: null,
      ga4: null,
      funis: async () => paraRelatorioCron(await executarEtapaFunis({ db, resend: null, agora: AGORA })),
      registrar,
    })
    expect(r.funis?.status).toBe('nao_configurado')
    expect(regs.find((x) => x.fonte === 'funis')).toMatchObject({ status: 'nao_configurado' })
    expect(regs.find((x) => x.fonte === 'funis')?.mensagem).toContain('Resend não configurado')
  })

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
        throw new FalhaEtapaFunis(['reativacao'], { linhas: 0, detalhes: {}, mensagem: 'Reativação: —.', semResend: false })
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
    const r = await executarEtapaFunis({ db, resend: null, agora: AGORA })
    expect((await db.select().from(importacoesContatos)).map((l) => l.id)).toEqual(['novo'])
    expect(r.detalhes.lotesApagados).toBe(1)
  })
})

describe('prazo interno da etapa de funis', () => {
  it('passou do prazo: para entre subetapas/lotes e a rotina grava "interrompido por tempo", nunca ok', async () => {
    await db.insert(contatos).values(
      Array.from({ length: 12 }, (_, i) => ({ nome: 'C', email: `t${i}@example.com`, emailNormalizado: `t${i}@example.com`, origem: 'planilha' as const, baseLegal: 'contrato' as const, status: 'cliente' as const, criadoEm: ANTIGO })),
    )
    const r = resendFalso()
    let agoraMs = 0
    const remover = r.cliente.removerDoSegmento
    // Cada chamada ao Resend "demora" 20 s no relógio falso.
    let removidos = 0
    r.cliente.removerDoSegmento = async (...args) => {
      agoraMs += 20_000
      removidos++
      return remover(...args)
    }
    const e = await executarEtapaFunis({ db, resend: r.cliente, acessoPublico: async () => true, agora: AGORA, relogio: () => agoraMs, prazoMs: 90_000 }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(FalhaEtapaFunis)
    const f = e as FalhaEtapaFunis
    expect(f.mensagemSegura).toMatch(/^Interrompido por tempo/)
    expect(f.mensagemSegura).toContain('envios')
    // Parou dentro do envio de contatos: nem todos foram, e a etapa dos envios não rodou.
    expect(removidos).toBeLessThan(12)

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
    const r = await executarEtapaFunis({ db, resend: null, agora: AGORA, relogio: () => 0 })
    expect(r.mensagem).not.toContain(INTERROMPIDO_POR_TEMPO)
  })
})
