import { and, asc, eq, gte, sql } from 'drizzle-orm'
import { contatos, enviosFunil, eventosContato, funilInscricoes, funis } from '@/lib/db/schema'
import { urlDescadastro } from '@/lib/descadastro'
import { ErroResend, type ClienteResend } from '@/lib/resend'
import { bancoPadrao, type BancoCrm } from './banco'
import { montarEmail } from './email-html'
import { etapasDaSequencia, linkWhatsapp, marcadoresPendentes } from './funis-conteudo'
import { ehSlugFunil, inicioDoDiaBrasilia, type SlugFunil } from './funis-regras'

/**
 * Motor dos funis (spec §2.4): o painel envia cada etapa pelo Resend.
 *
 * - Uma etapa é devida quando a referência + `esperarDias` já passou. A referência é a entrada
 *   no funil (etapa 0) ou o envio da etapa anterior.
 * - `envios_funil` é único por (inscrição, etapa): a linha é gravada **antes** do envio (reserva) e
 *   um conflito vira `pulado`. Uma etapa com `erro` é tentada de novo na rodada seguinte.
 * - Imediatamente antes de cada envio, o contato, a inscrição e o funil são relidos: descadastrado,
 *   dados apagados, inscrição que não está ativa ou funil desligado nunca recebem.
 * - Sem acesso público (o link de descadastro não abriria), nada sai.
 * - Para o Resend vão só o email e o nome (no corpo). Nada de dado de contato em log ou evento.
 */

export type EtapaDevida = { inscricaoId: number; contatoId: number; slug: SlugFunil; etapa: number }
export type ResultadoEnvio = 'enviado' | 'pulado' | 'erro'
export type ResultadoEnviosFunil = { enviados: number; pulados: number; erros: number; restantes: number }
export type ResultadoBoasVindasAgora = ResultadoEnvio | 'nada_devido'

/** Ordem de envio quando o limite diário não cobre tudo. */
export const PRIORIDADE_FUNIS: readonly SlugFunil[] = ['boas-vindas', 'reativacao', 'prospeccao-fria', 'nutricao-blog']
export const LIMITE_DIARIO_PADRAO = 90
export const MOTIVO_CONCLUSAO = 'sequência concluída'

const DIA_MS = 86_400_000
const ERRO_MARCADOR = 'texto com marcador pendente'
const ERRO_GENERICO = 'falha no envio'

export function limiteDiario(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.RESEND_LIMITE_DIARIO ?? LIMITE_DIARIO_PADRAO)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : LIMITE_DIARIO_PADRAO
}

async function buscarDevidas(db: BancoCrm, agora: Date, filtro?: { contatoId: number; slug: SlugFunil }): Promise<EtapaDevida[]> {
  const linhas = await db
    .select({
      inscricaoId: funilInscricoes.id,
      contatoId: funilInscricoes.contatoId,
      slug: funis.slug,
      entrouEm: funilInscricoes.entrouEm,
      etapa: enviosFunil.etapa,
      status: enviosFunil.status,
      enviadoEm: enviosFunil.enviadoEm,
    })
    .from(funilInscricoes)
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .innerJoin(contatos, eq(contatos.id, funilInscricoes.contatoId))
    .leftJoin(enviosFunil, eq(enviosFunil.inscricaoId, funilInscricoes.id))
    .where(
      and(
        eq(funilInscricoes.status, 'ativo'),
        eq(funis.ativo, true),
        sql`${contatos.status} <> 'descadastrado'`,
        sql`${contatos.dadosApagadosEm} is null`,
        filtro ? and(eq(funilInscricoes.contatoId, filtro.contatoId), eq(funis.slug, filtro.slug)) : undefined,
      ),
    )
    .orderBy(asc(funilInscricoes.id))

  const porInscricao = new Map<number, { contatoId: number; slug: SlugFunil; entrouEm: Date; enviados: Map<number, Date> }>()
  for (const l of linhas) {
    if (!ehSlugFunil(l.slug)) continue
    let i = porInscricao.get(l.inscricaoId)
    if (!i) {
      i = { contatoId: l.contatoId, slug: l.slug, entrouEm: l.entrouEm, enviados: new Map() }
      porInscricao.set(l.inscricaoId, i)
    }
    if (l.etapa !== null && l.status === 'enviado' && l.enviadoEm) i.enviados.set(l.etapa, l.enviadoEm)
  }

  const devidas: (EtapaDevida & { referencia: number })[] = []
  for (const [inscricaoId, i] of porInscricao) {
    const etapas = etapasDaSequencia(i.slug)
    let etapa = 0
    while (etapa < etapas.length && i.enviados.has(etapa)) etapa++
    if (etapa >= etapas.length) continue
    const referencia = etapa === 0 ? i.entrouEm : i.enviados.get(etapa - 1)
    // Etapa anterior sem envio confirmado (só acontece se faltar uma do meio): espera.
    if (!referencia) continue
    if (referencia.getTime() + etapas[etapa].esperarDias * DIA_MS > agora.getTime()) continue
    devidas.push({ inscricaoId, contatoId: i.contatoId, slug: i.slug, etapa, referencia: referencia.getTime() })
  }
  devidas.sort(
    (a, b) => PRIORIDADE_FUNIS.indexOf(a.slug) - PRIORIDADE_FUNIS.indexOf(b.slug) || a.referencia - b.referencia || a.inscricaoId - b.inscricaoId,
  )
  return devidas.map(({ inscricaoId, contatoId, slug, etapa }) => ({ inscricaoId, contatoId, slug, etapa }))
}

/** Etapas devidas agora, já na ordem de prioridade (boas-vindas, reativação, prospecção, nutrição). */
export async function etapasDevidas(agora: Date, opts: { db?: BancoCrm } = {}): Promise<EtapaDevida[]> {
  return buscarDevidas(opts.db ?? bancoPadrao(), agora)
}

/** Emails de funil já enviados hoje (fuso de Brasília): contam no limite diário do plano. */
async function enviadosHoje(db: BancoCrm, agora: Date): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enviosFunil)
    .where(and(eq(enviosFunil.status, 'enviado'), gte(enviosFunil.enviadoEm, inicioDoDiaBrasilia(agora))))
  return Number(n)
}

/** O POST one-click (RFC 8058) vai para a rota pública; o link do corpo abre a página. */
function urlOneClick(url: string): string {
  const u = new URL(url)
  u.pathname = '/api/publico/descadastro'
  return u.toString()
}

/**
 * Envia uma etapa. Reserva a linha em `envios_funil` (conflito = `pulado`), relê contato,
 * inscrição e funil logo antes de enviar e grava o resultado. Depois da última etapa, a
 * inscrição vira `concluido`.
 */
export async function enviarEtapa(
  item: EtapaDevida,
  opts: { db?: BancoCrm; cliente: ClienteResend; agora: Date; acessoPublico: boolean },
): Promise<ResultadoEnvio> {
  if (!opts.acessoPublico) return 'pulado'
  const db = opts.db ?? bancoPadrao()
  const { agora } = opts
  const etapas = etapasDaSequencia(item.slug)
  const email = etapas[item.etapa]
  if (!email) return 'pulado'

  // Reserva: insere, ou retoma uma tentativa que falhou. Linha `enviado` existente = conflito.
  const reservada = await db
    .insert(enviosFunil)
    .values({ inscricaoId: item.inscricaoId, etapa: item.etapa, status: 'enviado', enviadoEm: agora })
    .onConflictDoUpdate({
      target: [enviosFunil.inscricaoId, enviosFunil.etapa],
      set: { status: 'enviado', erro: null, resendEmailId: null, enviadoEm: agora },
      setWhere: sql`${enviosFunil.status} = 'erro'`,
    })
    .returning({ id: enviosFunil.id })
  if (reservada.length === 0) return 'pulado'
  const envioId = reservada[0].id
  const falhou = async (mensagem: string): Promise<'erro'> => {
    await db.update(enviosFunil).set({ status: 'erro', erro: mensagem }).where(eq(enviosFunil.id, envioId))
    return 'erro'
  }

  // Releitura imediatamente antes do envio (LGPD): nada do que foi selecionado antes vale aqui.
  const [atual] = await db
    .select({
      email: contatos.email,
      nome: contatos.nome,
      status: contatos.status,
      dadosApagadosEm: contatos.dadosApagadosEm,
      inscricao: funilInscricoes.status,
      contatoDaInscricao: funilInscricoes.contatoId,
      funilAtivo: funis.ativo,
      slug: funis.slug,
    })
    .from(funilInscricoes)
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .innerJoin(contatos, eq(contatos.id, funilInscricoes.contatoId))
    .where(eq(funilInscricoes.id, item.inscricaoId))
  if (
    !atual ||
    atual.contatoDaInscricao !== item.contatoId ||
    atual.slug !== item.slug ||
    atual.status === 'descadastrado' ||
    atual.dadosApagadosEm !== null ||
    atual.inscricao !== 'ativo' ||
    !atual.funilAtivo
  ) {
    await db.delete(enviosFunil).where(eq(enviosFunil.id, envioId))
    return 'pulado'
  }

  let montado: ReturnType<typeof montarEmail>
  let url: string
  try {
    url = urlDescadastro(item.contatoId, agora)
    montado = montarEmail(email, { nome: atual.nome || null, urlDescadastro: url, whatsapp: linkWhatsapp() })
  } catch {
    return falhou('link de descadastro indisponível (DESCADASTRO_SEGREDO)')
  }
  // `[fonte do contato]` (prospecção) sem resolver: o email não sai.
  if (marcadoresPendentes([montado.assunto, montado.texto]).length > 0) return falhou(ERRO_MARCADOR)

  let resendEmailId: string
  try {
    const r = await opts.cliente.enviarEmail({
      para: atual.email,
      assunto: montado.assunto,
      html: montado.html,
      texto: montado.texto,
      cabecalhos: { 'List-Unsubscribe': `<${urlOneClick(url)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      chaveIdempotencia: `funil-${item.inscricaoId}-${item.etapa}`,
      tags: [
        { name: 'funil', value: item.slug },
        { name: 'etapa', value: String(item.etapa) },
      ],
    })
    resendEmailId = r.id
  } catch (e) {
    // Mensagens do ErroResend são fixas (sem chave nem corpo da resposta); o resto, frase própria.
    return falhou(e instanceof ErroResend ? e.message : ERRO_GENERICO)
  }

  await db.update(enviosFunil).set({ resendEmailId }).where(eq(enviosFunil.id, envioId))
  await db.insert(eventosContato).values({
    contatoId: item.contatoId,
    tipo: 'enviado',
    dados: { funil: item.slug, etapa: item.etapa, resendEmailId },
    em: agora,
  })

  if (item.etapa === etapas.length - 1) {
    const concluidas = await db
      .update(funilInscricoes)
      .set({ status: 'concluido', saiuEm: agora, motivoSaida: MOTIVO_CONCLUSAO })
      .where(and(eq(funilInscricoes.id, item.inscricaoId), eq(funilInscricoes.status, 'ativo')))
      .returning({ id: funilInscricoes.id })
    if (concluidas.length > 0) {
      const [f] = await db.select({ nome: funis.nome }).from(funis).where(eq(funis.slug, item.slug))
      await db.insert(eventosContato).values({
        contatoId: item.contatoId,
        tipo: 'saiu_funil',
        dados: { funil: item.slug, nome: f?.nome ?? null, motivo: MOTIVO_CONCLUSAO, concluido: true },
        em: agora,
      })
    }
  }
  return 'enviado'
}

/**
 * Rotina diária: envia as etapas devidas por ordem de prioridade até o limite do plano
 * (descontado o que já saiu hoje). O que não couber fica para o dia seguinte (`restantes`).
 * `deveParar` (prazo da rotina) para entre envios.
 */
export async function executarEnviosFunil(opts: {
  db?: BancoCrm
  cliente: ClienteResend
  agora: Date
  acessoPublico: boolean
  limite?: number
  deveParar?: () => boolean
}): Promise<ResultadoEnviosFunil> {
  const db = opts.db ?? bancoPadrao()
  const devidas = await buscarDevidas(db, opts.agora)
  const r: ResultadoEnviosFunil = { enviados: 0, pulados: 0, erros: 0, restantes: devidas.length }
  if (!opts.acessoPublico || devidas.length === 0) return r
  const cota = Math.max(0, (opts.limite ?? limiteDiario()) - (await enviadosHoje(db, opts.agora)))
  for (const item of devidas) {
    // Erro conta: a chamada ao Resend pode ter sido contada no plano.
    if (r.enviados + r.erros >= cota || opts.deveParar?.()) break
    const s = await enviarEtapa(item, { db, cliente: opts.cliente, agora: opts.agora, acessoPublico: true })
    if (s === 'enviado') r.enviados++
    else if (s === 'pulado') r.pulados++
    else r.erros++
    r.restantes--
  }
  return r
}

/**
 * Boas-vindas na hora (chamada em `after()` pela rota do formulário do site): envia a etapa 0
 * se for devida e couber no limite do dia; senão fica para a rotina diária.
 */
export async function enviarBoasVindasAgora(
  contatoId: number,
  opts: { db?: BancoCrm; cliente: ClienteResend; agora: Date; acessoPublico: boolean },
): Promise<ResultadoBoasVindasAgora> {
  if (!opts.acessoPublico) return 'pulado'
  const db = opts.db ?? bancoPadrao()
  const [item] = (await buscarDevidas(db, opts.agora, { contatoId, slug: 'boas-vindas' })).filter((d) => d.etapa === 0)
  if (!item) return 'nada_devido'
  if ((await enviadosHoje(db, opts.agora)) >= limiteDiario()) return 'pulado'
  return enviarEtapa(item, { ...opts, db })
}
