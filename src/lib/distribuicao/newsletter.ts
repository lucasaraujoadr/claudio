import { and, desc, eq, sql } from 'drizzle-orm'
import { acessoPublicoOk } from '@/lib/acesso-publico'
import { bancoPadrao, type BancoCrm } from '@/lib/crm/banco'
import { DOURADO, montarLayoutMarca, TINTA } from '@/lib/crm/email-html'
import { escaparHtml } from '@/lib/crm/funis-conteudo'
import { elegivelNewsletter, SEGMENTO_NEWSLETTER, sincronizarPendentes } from '@/lib/crm/sincronizar'
import { artigos, contatos, funilInscricoes, funis, newslettersEnvios, pecasDistribuicao, type NewsletterEnvio } from '@/lib/db/schema'
import { configResend, criarClienteResend, ErroResend, type ClienteResend } from '@/lib/resend'
import { siteUrl } from '@/lib/site'
import { newsletterEstrito, type Newsletter } from './schemas'

/**
 * Newsletter de um artigo: monta o email no modelo da marca a partir da peça `newsletter`,
 * cria o broadcast (rascunho) no segmento do Resend e o dispara com trava contra envio repetido.
 *
 * LGPD: antes de enviar, os descadastros pendentes são sincronizados com o Resend; se algum
 * descadastrado/apagado ainda não chegou lá, o envio é recusado. O Resend também respeita o
 * descadastro hospedado (`{{{RESEND_UNSUBSCRIBE_URL}}}`). Nenhuma mensagem aqui leva chave nem
 * dado de contato.
 */

export const MARCADOR_DESCADASTRO_RESEND = '{{{RESEND_UNSUBSCRIBE_URL}}}'
export const MENSAGEM_DESCADASTROS_PENDENTES =
  'há descadastros ainda não sincronizados com o Resend; tente de novo em alguns minutos'
const MOTIVO = 'Você recebeu este email porque autorizou o envio dos nossos conteúdos ou é nosso cliente.'
const ERRO_GENERICO = 'falha ao falar com o Resend'

export type ResultadoNewsletter<T = object> = ({ ok: true } & T) | { ok: false; mensagem: string }

export type ClienteNewsletter = Pick<
  ClienteResend,
  'garantirSegmento' | 'criarBroadcast' | 'atualizarBroadcast' | 'enviarBroadcast' | 'salvarContato' | 'adicionarAoSegmento' | 'removerDoSegmento'
>

export type OpcoesNewsletter = {
  db?: BancoCrm
  /** Omitido: `configResend()`; `null` = sem chave. */
  cliente?: ClienteNewsletter | null
  acessoPublico?: () => Promise<boolean>
  agora?: Date
}

function clientePadrao(): ClienteNewsletter | null {
  const cfg = configResend()
  return cfg ? criarClienteResend(cfg) : null
}

function comUtm(link: string, slug: string): string {
  const u = new URL(link)
  u.searchParams.set('utm_source', 'newsletter')
  u.searchParams.set('utm_medium', 'email')
  u.searchParams.set('utm_campaign', slug)
  return u.toString()
}

export function montarNewsletter(
  p: Newsletter,
  ctx: { link: string; slug: string },
): { html: string; texto: string; assunto: string; preCabecalho: string } {
  const url = comUtm(ctx.link, ctx.slug)
  const pontos = p.pontos.map((x) => `<li style="margin:0 0 8px">${escaparHtml(x)}</li>`).join('')
  const corpoHtml = [
    `<p style="margin:0 0 16px">${escaparHtml(p.abertura)}</p>`,
    `<ul style="margin:0 0 24px;padding-left:20px">${pontos}</ul>`,
    `<p style="margin:0 0 8px"><a href="${escaparHtml(url)}" style="display:inline-block;padding:12px 24px;background:${DOURADO};color:#0E0F11;font-weight:bold;text-decoration:none">Ler o artigo completo</a></p>`,
    `<p style="margin:16px 0 0;font-size:13px;color:${TINTA}">Ou copie o endereço: ${escaparHtml(url)}</p>`,
  ].join('')
  const html = montarLayoutMarca({
    titulo: p.assunto,
    preCabecalho: p.preCabecalho,
    corpoHtml,
    motivo: MOTIVO,
    urlDescadastro: MARCADOR_DESCADASTRO_RESEND,
  })
  const texto = [
    p.abertura,
    p.pontos.map((x) => `- ${x}`).join('\n'),
    `Ler o artigo completo: ${url}`,
    '—',
    MOTIVO,
    `Para não receber mais, descadastre-se: ${MARCADOR_DESCADASTRO_RESEND}`,
  ].join('\n\n')
  return { html, texto, assunto: p.assunto, preCabecalho: p.preCabecalho }
}

/** Contatos que receberiam o broadcast: elegíveis pela regra da newsletter e já sincronizados com o Resend. */
export async function contarDestinatariosNewsletter(db: BancoCrm = bancoPadrao()): Promise<number> {
  const linhas = await db
    .select({ status: contatos.status, baseLegal: contatos.baseLegal, dadosApagadosEm: contatos.dadosApagadosEm })
    .from(contatos)
    .innerJoin(funilInscricoes, eq(funilInscricoes.contatoId, contatos.id))
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .where(and(eq(contatos.syncStatus, 'sincronizado'), eq(funis.slug, 'nutricao-blog'), eq(funilInscricoes.status, 'ativo')))
  return linhas.filter((c) => elegivelNewsletter(c, true)).length
}

function mensagemErro(e: unknown): string {
  return e instanceof ErroResend ? e.message : ERRO_GENERICO
}

/** Envio ainda em rascunho do artigo da peça (o mais recente). */
export async function rascunhoDaPeca(pecaId: number, db: BancoCrm = bancoPadrao()): Promise<NewsletterEnvio | null> {
  const [l] = await db
    .select({ e: newslettersEnvios })
    .from(pecasDistribuicao)
    .innerJoin(newslettersEnvios, eq(newslettersEnvios.artigoId, pecasDistribuicao.artigoId))
    .where(and(eq(pecasDistribuicao.id, pecaId), eq(newslettersEnvios.situacao, 'rascunho')))
    .orderBy(desc(newslettersEnvios.id))
    .limit(1)
  return l?.e ?? null
}

/** Último envio do artigo da peça, em qualquer situação. */
export async function ultimoEnvioDaPeca(pecaId: number, db: BancoCrm = bancoPadrao()): Promise<NewsletterEnvio | null> {
  const [l] = await db
    .select({ e: newslettersEnvios })
    .from(pecasDistribuicao)
    .innerJoin(newslettersEnvios, eq(newslettersEnvios.artigoId, pecasDistribuicao.artigoId))
    .where(eq(pecasDistribuicao.id, pecaId))
    .orderBy(desc(newslettersEnvios.id))
    .limit(1)
  return l?.e ?? null
}

/**
 * Cria o broadcast (rascunho) e grava `newsletters_envios` em `rascunho`. Se o artigo já tem um
 * rascunho, reescreve o mesmo broadcast em vez de criar outro.
 */
export async function criarRascunhoNewsletter(
  pecaId: number,
  opts: OpcoesNewsletter = {},
): Promise<ResultadoNewsletter<{ envio: NewsletterEnvio }>> {
  const db = opts.db ?? bancoPadrao()
  const cliente = opts.cliente !== undefined ? opts.cliente : clientePadrao()
  if (!cliente) return { ok: false, mensagem: 'Resend não configurado' }

  const [linha] = await db
    .select({ peca: pecasDistribuicao, slug: artigos.slug, wpLink: artigos.wpLink })
    .from(pecasDistribuicao)
    .innerJoin(artigos, eq(artigos.id, pecasDistribuicao.artigoId))
    .where(eq(pecasDistribuicao.id, pecaId))
  if (!linha || linha.peca.tipo !== 'newsletter') return { ok: false, mensagem: 'peça de newsletter não encontrada' }
  const conteudo = newsletterEstrito.safeParse(linha.peca.conteudo)
  if (!conteudo.success) return { ok: false, mensagem: 'a newsletter está vazia ou inválida; gere ou edite a peça' }
  const slug = linha.slug?.trim()
  const link = linha.wpLink?.trim() || (slug ? `${siteUrl()}/${slug}/` : null)
  if (!link || !/^https?:\/\//i.test(link)) return { ok: false, mensagem: 'o artigo ainda não tem link publicado' }

  const email = montarNewsletter(conteudo.data, { link, slug: slug || 'newsletter' })
  const nome = `Newsletter — ${email.assunto}`.slice(0, 150)
  const agora = opts.agora ?? new Date()

  try {
    const segmento = await cliente.garantirSegmento(SEGMENTO_NEWSLETTER)
    const destinatarios = await contarDestinatariosNewsletter(db)
    const existente = await rascunhoDaPeca(pecaId, db)
    let broadcastId = existente?.resendBroadcastId ?? null
    const dados = { nome, assunto: email.assunto, html: email.html, texto: email.texto }
    if (broadcastId) {
      try {
        await cliente.atualizarBroadcast(broadcastId, dados)
      } catch (e) {
        if (!(e instanceof ErroResend && e.tipo === 'nao_encontrado')) throw e
        broadcastId = null // apagado no Resend: cria outro na mesma linha
      }
    }
    if (!broadcastId) broadcastId = (await cliente.criarBroadcast({ segmentoId: segmento.id, ...dados })).id

    if (existente) {
      const [nova] = await db
        .update(newslettersEnvios)
        .set({ resendBroadcastId: broadcastId, destinatarios, erro: null, atualizadoEm: agora })
        .where(and(eq(newslettersEnvios.id, existente.id), eq(newslettersEnvios.situacao, 'rascunho')))
        .returning()
      if (nova) return { ok: true, envio: nova }
      return { ok: false, mensagem: 'a newsletter já foi enviada ou está sendo enviada' }
    }
    const [novo] = await db
      .insert(newslettersEnvios)
      .values({ artigoId: linha.peca.artigoId, resendBroadcastId: broadcastId, situacao: 'rascunho', destinatarios, criadoEm: agora, atualizadoEm: agora })
      .returning()
    return { ok: true, envio: novo }
  } catch (e) {
    console.error('Falha ao criar rascunho da newsletter', e instanceof Error ? e.name : 'erro')
    return { ok: false, mensagem: mensagemErro(e) }
  }
}

async function descadastrosPendentes(db: BancoCrm): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(contatos)
    .where(
      and(
        sql`${contatos.syncStatus} in ('pendente', 'erro')`,
        sql`(${contatos.status} = 'descadastrado' or ${contatos.dadosApagadosEm} is not null)`,
      ),
    )
  return Number(r?.n ?? 0)
}

/**
 * Dispara o broadcast (agora ou agendado). Só envia a partir de `rascunho`; a troca de situação
 * acontece ANTES da chamada ao Resend, de forma condicional, então dois cliques nunca enviam duas
 * vezes. Se o Resend recusar, a linha volta a `rascunho` com o erro.
 */
export async function enviarNewsletter(
  envioId: number,
  opts: OpcoesNewsletter & { agendarPara?: Date } = {},
): Promise<ResultadoNewsletter<{ situacao: 'agendado' | 'enviado'; destinatarios: number }>> {
  const db = opts.db ?? bancoPadrao()
  const cliente = opts.cliente !== undefined ? opts.cliente : clientePadrao()
  if (!cliente) return { ok: false, mensagem: 'Resend não configurado' }
  const agora = opts.agora ?? new Date()
  const agendarPara = opts.agendarPara
  if (agendarPara && (Number.isNaN(agendarPara.getTime()) || agendarPara.getTime() <= agora.getTime())) {
    return { ok: false, mensagem: 'a data de agendamento precisa estar no futuro' }
  }

  const [envio] = await db.select().from(newslettersEnvios).where(eq(newslettersEnvios.id, envioId))
  if (!envio) return { ok: false, mensagem: 'envio não encontrado' }
  if (envio.situacao !== 'rascunho' || !envio.resendBroadcastId) {
    return { ok: false, mensagem: 'esta newsletter já foi enviada ou não tem rascunho' }
  }

  // Sem acesso público o descadastro hospedado não volta pelo webhook.
  const acesso = await (opts.acessoPublico ?? (() => acessoPublicoOk()))().catch(() => false)
  if (!acesso) {
    return { ok: false, mensagem: 'o painel não está acessível publicamente; o descadastro não voltaria pelo webhook. Ajuste a proteção da Vercel antes de enviar' }
  }

  try {
    await sincronizarPendentes({ db, cliente })
  } catch (e) {
    console.error('Falha ao sincronizar antes da newsletter', e instanceof Error ? e.name : 'erro')
  }
  if ((await descadastrosPendentes(db)) > 0) return { ok: false, mensagem: MENSAGEM_DESCADASTROS_PENDENTES }

  const destinatarios = await contarDestinatariosNewsletter(db)
  if (destinatarios === 0) return { ok: false, mensagem: 'não há destinatários sincronizados no segmento da newsletter' }

  const situacao = agendarPara ? 'agendado' : 'enviado'
  const [reivindicado] = await db
    .update(newslettersEnvios)
    .set({
      situacao,
      destinatarios,
      agendadoPara: agendarPara ?? null,
      enviadoEm: agendarPara ? null : agora,
      erro: null,
      atualizadoEm: agora,
    })
    .where(and(eq(newslettersEnvios.id, envioId), eq(newslettersEnvios.situacao, 'rascunho')))
    .returning({ id: newslettersEnvios.id })
  if (!reivindicado) return { ok: false, mensagem: 'esta newsletter já foi enviada ou está sendo enviada' }

  try {
    await cliente.enviarBroadcast(envio.resendBroadcastId, agendarPara)
  } catch (e) {
    const mensagem = mensagemErro(e)
    console.error('Falha ao enviar newsletter', e instanceof Error ? e.name : 'erro')
    await db
      .update(newslettersEnvios)
      .set({ situacao: 'rascunho', agendadoPara: null, enviadoEm: null, erro: mensagem, atualizadoEm: new Date() })
      .where(eq(newslettersEnvios.id, envioId))
    return { ok: false, mensagem }
  }
  return { ok: true, situacao, destinatarios }
}
