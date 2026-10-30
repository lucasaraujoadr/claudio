import { and, desc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
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
 * descadastro hospedado (`{{{RESEND_UNSUBSCRIBE_URL}}}`), que só volta ao CRM pelo webhook: sem
 * `RESEND_WEBHOOK_SECRET` o envio é recusado. Nenhuma mensagem aqui leva chave nem dado de contato.
 *
 * Situação `erro`: o envio pode ter saído (o Resend não confirmou nem desmentiu). A linha não volta
 * a rascunho e não reenvia; o próximo rascunho do artigo confere o broadcast antigo antes.
 */

export const MARCADOR_DESCADASTRO_RESEND = '{{{RESEND_UNSUBSCRIBE_URL}}}'
export const MENSAGEM_DESCADASTROS_PENDENTES =
  'há descadastros ainda não sincronizados com o Resend; tente de novo em alguns minutos'
export const MENSAGEM_SEM_WEBHOOK =
  'o webhook do Resend não está configurado (RESEND_WEBHOOK_SECRET); sem ele, quem se descadastrar pelo link do email não seria registrado no CRM. Configure antes de enviar'
export const MENSAGEM_ENVIO_NAO_CONFIRMADO = 'o envio não foi confirmado; confira no painel do Resend antes de tentar de novo'
export const MENSAGEM_PECA_EDITADA = 'a peça foi editada depois do rascunho; atualize o rascunho antes de enviar'
const MENSAGEM_JA_ENVIADA = 'a newsletter deste artigo já foi enviada'
/** Tempo máximo da sincronização antes do envio (a rota tem 120 s). */
const PRAZO_SINCRONIZACAO_MS = 60_000
const MOTIVO = 'Você recebeu este email porque autorizou o envio dos nossos conteúdos ou é nosso cliente.'
const MINUTOS_LINHA_PRESA = 2
const ERRO_GENERICO = 'falha ao falar com o Resend'

export type ResultadoNewsletter<T = object> = ({ ok: true } & T) | { ok: false; mensagem: string }

export type ClienteNewsletter = Pick<
  ClienteResend,
  'garantirSegmento' | 'criarBroadcast' | 'atualizarBroadcast' | 'enviarBroadcast' | 'lerBroadcast' | 'salvarContato' | 'adicionarAoSegmento' | 'removerDoSegmento'
>

export type OpcoesNewsletter = {
  db?: BancoCrm
  /** Omitido: `configResend()`; `null` = sem chave. */
  cliente?: ClienteNewsletter | null
  acessoPublico?: () => Promise<boolean>
  agora?: Date
  /** Segredo do webhook do Resend. Omitido: `RESEND_WEBHOOK_SECRET`. */
  segredoWebhook?: string | null
  /** Prazo da sincronização antes do envio: `true` para parar. Omitido: 60 s. */
  deveParar?: () => boolean
}

function clientePadrao(): ClienteNewsletter | null {
  const cfg = configResend()
  return cfg ? criarClienteResend(cfg) : null
}

function comUtm(link: string, slug: string): string | null {
  let u: URL
  try {
    u = new URL(link)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
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
  if (!url) throw new Error('link do artigo inválido')
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
    .selectDistinctOn([contatos.id], { status: contatos.status, baseLegal: contatos.baseLegal, dadosApagadosEm: contatos.dadosApagadosEm })
    .from(contatos)
    .innerJoin(funilInscricoes, eq(funilInscricoes.contatoId, contatos.id))
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .where(and(eq(contatos.syncStatus, 'sincronizado'), eq(funis.slug, 'nutricao-blog'), eq(funilInscricoes.status, 'ativo')))
  return linhas.filter((c) => elegivelNewsletter(c, true)).length
}

function mensagemErro(e: unknown): string {
  return e instanceof ErroResend ? e.message : ERRO_GENERICO
}

/**
 * Estado do broadcast no Resend: `rascunho` (ainda `draft`), `enviado` (saiu de rascunho:
 * agendado, na fila, enviando ou enviado), `sumiu` (404: nunca vai sair) ou `desconhecido`
 * (a leitura falhou ou o status veio vazio).
 */
async function estadoBroadcast(cliente: ClienteNewsletter, id: string): Promise<'rascunho' | 'enviado' | 'sumiu' | 'desconhecido'> {
  try {
    const { status } = await cliente.lerBroadcast(id)
    if (status === 'draft') return 'rascunho'
    return status === '' ? 'desconhecido' : 'enviado'
  } catch (e) {
    return e instanceof ErroResend && e.tipo === 'nao_encontrado' ? 'sumiu' : 'desconhecido'
  }
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

  let email: ReturnType<typeof montarNewsletter>
  try {
    email = montarNewsletter(conteudo.data, { link, slug: slug || 'newsletter' })
  } catch {
    return { ok: false, mensagem: 'o link do artigo é inválido' }
  }
  const nome = `Newsletter — ${email.assunto}`.slice(0, 150)
  const agora = opts.agora ?? new Date()

  try {
    const [jaEnviada] = await db
      .select({ id: newslettersEnvios.id })
      .from(newslettersEnvios)
      .where(and(eq(newslettersEnvios.artigoId, linha.peca.artigoId), eq(newslettersEnvios.situacao, 'enviado')))
      .limit(1)
    if (jaEnviada) return { ok: false, mensagem: MENSAGEM_JA_ENVIADA }

    // Envio anterior não confirmado (`erro`): só deixa criar outro rascunho se o broadcast antigo
    // comprovadamente não saiu. Se saiu, a linha vira `enviado`; se não dá para saber, recusa.
    const naoConfirmados = await db
      .select()
      .from(newslettersEnvios)
      .where(and(eq(newslettersEnvios.artigoId, linha.peca.artigoId), eq(newslettersEnvios.situacao, 'erro'), isNotNull(newslettersEnvios.resendBroadcastId)))
    for (const antigo of naoConfirmados) {
      const estado = await estadoBroadcast(cliente, antigo.resendBroadcastId!)
      if (estado === 'desconhecido') return { ok: false, mensagem: MENSAGEM_ENVIO_NAO_CONFIRMADO }
      if (estado === 'enviado') {
        await db
          .update(newslettersEnvios)
          .set({ situacao: 'enviado', erro: null, enviadoEm: antigo.enviadoEm ?? agora, atualizadoEm: agora })
          .where(and(eq(newslettersEnvios.id, antigo.id), eq(newslettersEnvios.situacao, 'erro')))
        return { ok: false, mensagem: MENSAGEM_JA_ENVIADA }
      }
    }

    const segmento = await cliente.garantirSegmento(SEGMENTO_NEWSLETTER)
    const destinatarios = await contarDestinatariosNewsletter(db)
    const dados = { nome, assunto: email.assunto, html: email.html, texto: email.texto }

    // A linha vem antes do broadcast: o índice único de envio em aberto decide quem cria.
    const [criada] = await db
      .insert(newslettersEnvios)
      .values({ artigoId: linha.peca.artigoId, situacao: 'rascunho', destinatarios, criadoEm: agora, atualizadoEm: agora })
      .onConflictDoNothing()
      .returning()
    // Cria o broadcast para uma linha que ainda não tem id; se falhar, a linha some (não fica órfã).
    const criarParaLinha = async (linhaId: number): Promise<ResultadoNewsletter<{ envio: NewsletterEnvio }>> => {
      try {
        const { id } = await cliente.criarBroadcast({ segmentoId: segmento.id, ...dados })
        const [nova] = await db
          .update(newslettersEnvios)
          .set({ resendBroadcastId: id, conteudoEm: agora, atualizadoEm: agora })
          .where(eq(newslettersEnvios.id, linhaId))
          .returning()
        return { ok: true, envio: nova }
      } catch (e) {
        await db.delete(newslettersEnvios).where(eq(newslettersEnvios.id, linhaId)).catch(() => {})
        throw e
      }
    }
    if (criada) return await criarParaLinha(criada.id)

    const existente = await rascunhoDaPeca(pecaId, db)
    const EM_CRIACAO = { ok: false, mensagem: 'o rascunho está sendo criado; tente de novo em instantes' } as const
    if (!existente) return EM_CRIACAO
    if (!existente.resendBroadcastId) {
      // Linha sem broadcast há mais de 2 min: quem a criou morreu. Assume por atualização condicional.
      const limite = new Date(agora.getTime() - MINUTOS_LINHA_PRESA * 60_000)
      const [assumida] = await db
        .update(newslettersEnvios)
        .set({ atualizadoEm: agora })
        .where(
          and(
            eq(newslettersEnvios.id, existente.id),
            eq(newslettersEnvios.situacao, 'rascunho'),
            isNull(newslettersEnvios.resendBroadcastId),
            lt(newslettersEnvios.atualizadoEm, limite),
          ),
        )
        .returning({ id: newslettersEnvios.id })
      if (!assumida) return EM_CRIACAO
      return await criarParaLinha(assumida.id)
    }
    let broadcastId: string | null = existente.resendBroadcastId
    try {
      await cliente.atualizarBroadcast(broadcastId, dados)
    } catch (e) {
      if (!(e instanceof ErroResend && e.tipo === 'nao_encontrado')) throw e
      broadcastId = null // apagado no Resend: cria outro na mesma linha
    }
    if (!broadcastId) broadcastId = (await cliente.criarBroadcast({ segmentoId: segmento.id, ...dados })).id
    const [nova] = await db
      .update(newslettersEnvios)
      .set({ resendBroadcastId: broadcastId, destinatarios, erro: null, conteudoEm: agora, atualizadoEm: agora })
      .where(and(eq(newslettersEnvios.id, existente.id), eq(newslettersEnvios.situacao, 'rascunho')))
      .returning()
    if (nova) return { ok: true, envio: nova }
    return { ok: false, mensagem: 'a newsletter já foi enviada ou está sendo enviada' }
  } catch (e) {
    console.error('Falha ao criar rascunho da newsletter', e instanceof Error ? e.name : 'erro')
    return { ok: false, mensagem: mensagemErro(e) }
  }
}

/**
 * Contatos ainda `pendente`/`erro` que NÃO são elegíveis: podem continuar no segmento do Resend
 * (descadastro, apagamento, saída do funil, mudança de base legal que não sincronizou). Os
 * elegíveis pendentes são inofensivos e não bloqueiam.
 */
async function pendentesNaoElegiveis(db: BancoCrm): Promise<number> {
  const linhas = await db
    .select({ id: contatos.id, status: contatos.status, baseLegal: contatos.baseLegal, dadosApagadosEm: contatos.dadosApagadosEm })
    .from(contatos)
    .where(inArray(contatos.syncStatus, ['pendente', 'erro']))
  if (linhas.length === 0) return 0
  const nutricao = await db
    .selectDistinct({ id: funilInscricoes.contatoId })
    .from(funilInscricoes)
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .where(and(eq(funis.slug, 'nutricao-blog'), eq(funilInscricoes.status, 'ativo')))
  const naNutricao = new Set(nutricao.map((n) => n.id))
  return linhas.filter((c) => !elegivelNewsletter(c, naNutricao.has(c.id))).length
}

/**
 * Dispara o broadcast (sempre agora: o descadastro é checado imediatamente antes, e um envio
 * agendado sairia sem essa checagem). Só envia a partir de `rascunho`; a troca de situação
 * acontece ANTES da chamada ao Resend, de forma condicional, então dois cliques nunca enviam duas
 * vezes. Se o Resend recusar, a linha volta a `rascunho` com o erro. Se a resposta for ambígua
 * (rede/servidor) e não der para conferir o broadcast, a linha fica em `erro`: pode ter saído.
 *
 * Recusa antes: sem o segredo do webhook, ou se a peça foi editada depois do rascunho (`conteudoEm`).
 */
export async function enviarNewsletter(
  envioId: number,
  opts: OpcoesNewsletter = {},
): Promise<ResultadoNewsletter<{ situacao: 'enviado'; destinatarios: number }>> {
  const db = opts.db ?? bancoPadrao()
  const cliente = opts.cliente !== undefined ? opts.cliente : clientePadrao()
  if (!cliente) return { ok: false, mensagem: 'Resend não configurado' }
  const agora = opts.agora ?? new Date()

  const [envio] = await db.select().from(newslettersEnvios).where(eq(newslettersEnvios.id, envioId))
  if (!envio) return { ok: false, mensagem: 'envio não encontrado' }
  if (envio.situacao !== 'rascunho' || !envio.resendBroadcastId) {
    return { ok: false, mensagem: 'esta newsletter já foi enviada ou não tem rascunho' }
  }

  // Sem o webhook, o descadastro feito na página do Resend nunca chegaria ao CRM.
  const segredo = (opts.segredoWebhook === undefined ? process.env.RESEND_WEBHOOK_SECRET : opts.segredoWebhook)?.trim()
  if (!segredo) return { ok: false, mensagem: MENSAGEM_SEM_WEBHOOK }

  const [peca] = await db
    .select({ atualizadoEm: pecasDistribuicao.atualizadoEm })
    .from(pecasDistribuicao)
    .where(and(eq(pecasDistribuicao.artigoId, envio.artigoId), eq(pecasDistribuicao.tipo, 'newsletter')))
  if (!peca) return { ok: false, mensagem: 'peça de newsletter não encontrada' }
  const conteudoEm = envio.conteudoEm ?? envio.criadoEm
  if (peca.atualizadoEm.getTime() > conteudoEm.getTime()) return { ok: false, mensagem: MENSAGEM_PECA_EDITADA }

  // Sem acesso público o descadastro hospedado não volta pelo webhook.
  const acesso = await (opts.acessoPublico ?? (() => acessoPublicoOk()))().catch(() => false)
  if (!acesso) {
    return { ok: false, mensagem: 'o painel não está acessível publicamente; o descadastro não voltaria pelo webhook. Ajuste a proteção da Vercel antes de enviar' }
  }

  // Com prazo: se parar antes do fim, quem ficou pendente e não é elegível ainda bloqueia logo abaixo.
  const inicio = Date.now()
  const deveParar = opts.deveParar ?? (() => Date.now() - inicio >= PRAZO_SINCRONIZACAO_MS)
  try {
    await sincronizarPendentes({ db, cliente, deveParar })
  } catch (e) {
    console.error('Falha ao sincronizar antes da newsletter', e instanceof Error ? e.name : 'erro')
  }
  if ((await pendentesNaoElegiveis(db)) > 0) return { ok: false, mensagem: MENSAGEM_DESCADASTROS_PENDENTES }

  const destinatarios = await contarDestinatariosNewsletter(db)
  if (destinatarios === 0) return { ok: false, mensagem: 'não há destinatários sincronizados no segmento da newsletter' }

  const [reivindicado] = await db
    .update(newslettersEnvios)
    .set({
      situacao: 'enviado',
      destinatarios,
      agendadoPara: null,
      enviadoEm: agora,
      erro: null,
      atualizadoEm: agora,
    })
    .where(and(eq(newslettersEnvios.id, envioId), eq(newslettersEnvios.situacao, 'rascunho')))
    .returning({ id: newslettersEnvios.id })
  if (!reivindicado) return { ok: false, mensagem: 'esta newsletter já foi enviada ou está sendo enviada' }

  try {
    await cliente.enviarBroadcast(envio.resendBroadcastId)
  } catch (e) {
    console.error('Falha ao enviar newsletter', e instanceof Error ? e.name : 'erro')
    // Erro ambíguo (rede/servidor): o Resend pode ter aceitado o envio. Se o broadcast deixou de
    // ser rascunho, vale como enviado; se não dá para saber, fica em `erro` (nunca volta a rascunho).
    if (e instanceof ErroResend && (e.tipo === 'rede' || e.tipo === 'servidor')) {
      const estado = await estadoBroadcast(cliente, envio.resendBroadcastId)
      if (estado === 'enviado') return { ok: true, situacao: 'enviado', destinatarios }
      if (estado === 'desconhecido') {
        await db
          .update(newslettersEnvios)
          .set({ situacao: 'erro', erro: MENSAGEM_ENVIO_NAO_CONFIRMADO, atualizadoEm: new Date() })
          .where(and(eq(newslettersEnvios.id, envioId), eq(newslettersEnvios.situacao, 'enviado')))
        return { ok: false, mensagem: MENSAGEM_ENVIO_NAO_CONFIRMADO }
      }
    }
    // Recusa confirmada: volta a rascunho. `conteudoEm` não muda (o conteúdo do broadcast é o mesmo).
    const mensagem = mensagemErro(e)
    await db
      .update(newslettersEnvios)
      .set({ situacao: 'rascunho', agendadoPara: null, enviadoEm: null, erro: mensagem, atualizadoEm: new Date() })
      .where(and(eq(newslettersEnvios.id, envioId), eq(newslettersEnvios.situacao, 'enviado')))
    return { ok: false, mensagem }
  }
  return { ok: true, situacao: 'enviado', destinatarios }
}
