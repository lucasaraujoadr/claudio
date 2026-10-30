import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { contatos, enviosFunil, funilInscricoes } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { garantirFunis } from '../funis'
import { resumoEnviosFunil } from '../envios-painel'
import { criarBancoTesteFunis } from './banco-teste-funis'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
})

const DIA = 86_400_000
const agora = new Date('2026-10-29T15:00:00Z')

async function inscrito(email: string, nome: string, entrouEm: Date) {
  const [f] = (await garantirFunis({ db })).filter((x) => x.slug === 'boas-vindas')
  const [c] = await db.insert(contatos).values({ nome, email, emailNormalizado: email, origem: 'site', baseLegal: 'consentimento' }).returning()
  const [i] = await db.insert(funilInscricoes).values({ contatoId: c.id, funilId: f.id, origem: 'site', entrouEm }).returning()
  return { c, i }
}

describe('resumoEnviosFunil', () => {
  it('conta enviados e erros dos últimos 30 dias e lista os incertos com contato, etapa e data', async () => {
    const { c, i } = await inscrito('a@example.com', 'Ana', new Date(agora.getTime() - 40 * DIA))
    const rodada = i.entrouEm
    await db.insert(enviosFunil).values([
      { inscricaoId: i.id, rodada, etapa: 0, status: 'enviado', enviadoEm: new Date(agora.getTime() - 2 * DIA) },
      { inscricaoId: i.id, rodada, etapa: 1, status: 'incerto', enviadoEm: new Date(agora.getTime() - 1 * DIA) },
      { inscricaoId: i.id, rodada, etapa: 2, status: 'erro', enviadoEm: new Date(agora.getTime() - 3 * DIA) },
      // Fora da janela: não entra nas contagens nem na lista.
      { inscricaoId: i.id, rodada: new Date(rodada.getTime() + 1000), etapa: 0, status: 'enviado', enviadoEm: new Date(agora.getTime() - 45 * DIA) },
    ])
    const r = await resumoEnviosFunil('boas-vindas', { db, agora })
    expect(r.enviados).toBe(1)
    expect(r.erros).toBe(1)
    expect(r.incertos).toHaveLength(1)
    expect(r.incertos[0]).toMatchObject({ contatoId: c.id, nome: 'Ana', email: 'a@example.com', etapa: 1 })
    expect(r.incertos[0].quando).toEqual(new Date(agora.getTime() - 1 * DIA))
  })

  it('incerto antigo continua na lista até alguém conferir (não some com a janela)', async () => {
    const { i } = await inscrito('b@example.com', 'Bia', new Date(agora.getTime() - 90 * DIA))
    await db.insert(enviosFunil).values({ inscricaoId: i.id, rodada: i.entrouEm, etapa: 0, status: 'incerto', enviadoEm: new Date(agora.getTime() - 60 * DIA) })
    const r = await resumoEnviosFunil('boas-vindas', { db, agora })
    expect(r.incertos).toHaveLength(1)
    expect(r.enviados).toBe(0)
  })

  it('fila de hoje: etapas devidas do funil, sem concluir nada ao só olhar', async () => {
    const { i } = await inscrito('c@example.com', 'Caio', new Date(agora.getTime() - 1 * DIA))
    // Todas as etapas já enviadas: a rotina concluiria; a tela só lê.
    const { EMAILS_FUNIS } = await import('../funis-conteudo')
    await db.insert(enviosFunil).values(
      EMAILS_FUNIS['boas-vindas'].map((_, etapa) => ({ inscricaoId: i.id, rodada: i.entrouEm, etapa, status: 'enviado' as const, enviadoEm: new Date(agora.getTime() - 1000) })),
    )
    await inscrito('d@example.com', 'Davi', new Date(agora.getTime() - 1 * DIA))
    const r = await resumoEnviosFunil('boas-vindas', { db, agora })
    expect(r.fila).toBe(1)
    const [ins] = await db.select().from(funilInscricoes).where((await import('drizzle-orm')).eq(funilInscricoes.id, i.id))
    expect(ins.status).toBe('ativo')
  })
})
