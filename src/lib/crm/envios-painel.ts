import { and, asc, desc, eq, gte, sql } from 'drizzle-orm'
import { contatos, enviosFunil, funilInscricoes, funis } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import { etapasDevidas } from './envios-funil'
import type { SlugFunil } from './funis-regras'

/** Janela dos números da tela de funis. */
export const JANELA_ENVIOS_DIAS = 30
const DIA_MS = 86_400_000

export type EnvioIncerto = { contatoId: number; nome: string | null; email: string; etapa: number; quando: Date }

export type ResumoEnviosFunil = {
  /** Emails enviados nos últimos 30 dias. */
  enviados: number
  /** Tentativas que o Resend recusou nos últimos 30 dias. */
  erros: number
  /** Etapas devidas agora neste funil (o que a rotina de hoje enviaria, sem contar o limite diário). */
  fila: number
  /** Resultado que não voltou: pode ter saído ou não. Nunca repetidos sozinhos; ficam aqui até alguém conferir. */
  incertos: EnvioIncerto[]
}

const MAX_INCERTOS = 100

/**
 * Dados da tela de um funil: envios recentes, fila de hoje e os envios incertos. Só lê (a fila usa
 * `somenteLeitura`, para ver a página não concluir inscrições). Os incertos não somem com a janela
 * de 30 dias: continuam listados enquanto existirem.
 */
export async function resumoEnviosFunil(slug: SlugFunil, opts: { db?: BancoCrm; agora?: Date } = {}): Promise<ResumoEnviosFunil> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const desde = new Date(agora.getTime() - JANELA_ENVIOS_DIAS * DIA_MS)
  const doFunil = and(eq(funis.slug, slug))

  const [contagens, incertos, devidas] = await Promise.all([
    db
      .select({ status: enviosFunil.status, n: sql<number>`count(*)::int` })
      .from(enviosFunil)
      .innerJoin(funilInscricoes, eq(funilInscricoes.id, enviosFunil.inscricaoId))
      .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
      .where(and(doFunil, gte(enviosFunil.enviadoEm, desde)))
      .groupBy(enviosFunil.status),
    db
      .select({
        contatoId: contatos.id,
        nome: contatos.nome,
        email: contatos.email,
        etapa: enviosFunil.etapa,
        quando: enviosFunil.enviadoEm,
        dadosApagadosEm: contatos.dadosApagadosEm,
      })
      .from(enviosFunil)
      .innerJoin(funilInscricoes, eq(funilInscricoes.id, enviosFunil.inscricaoId))
      .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
      .innerJoin(contatos, eq(contatos.id, funilInscricoes.contatoId))
      .where(and(doFunil, eq(enviosFunil.status, 'incerto')))
      .orderBy(desc(enviosFunil.enviadoEm), asc(enviosFunil.id))
      .limit(MAX_INCERTOS),
    etapasDevidas(agora, { db, somenteLeitura: true }),
  ])
  const n = (s: 'enviado' | 'erro') => Number(contagens.find((c) => c.status === s)?.n ?? 0)
  return {
    enviados: n('enviado'),
    erros: n('erro'),
    fila: devidas.filter((d) => d.slug === slug).length,
    incertos: incertos.map((l) => ({
      contatoId: l.contatoId,
      // Dados apagados a pedido: o nome já não existe e o email é só a chave de supressão.
      nome: l.dadosApagadosEm ? null : l.nome || null,
      email: l.email,
      etapa: l.etapa,
      quando: l.quando,
    })),
  }
}
