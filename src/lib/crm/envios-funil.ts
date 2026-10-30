import { and, asc, eq, gte, inArray, sql } from 'drizzle-orm'
import { contatos, enviosFunil, eventosContato, funilInscricoes, funis } from '@/lib/db/schema'
import { urlDescadastro } from '@/lib/descadastro'
import { ErroResend, type ClienteResend } from '@/lib/resend'
import { bancoPadrao, type BancoCrm } from './banco'
import { montarEmail } from './email-html'
import { sair } from './funis'
import { etapasDaSequencia, linkWhatsapp, marcadoresPendentes } from './funis-conteudo'
import { ehSlugFunil, inicioDoDiaBrasilia, type SlugFunil } from './funis-regras'

/**
 * Motor dos funis (spec §2.4): o painel envia cada etapa pelo Resend.
 *
 * - Uma etapa é devida quando a referência + `esperarDias` já passou. A referência é a entrada
 *   no funil (etapa 0) ou o envio da etapa anterior, sempre na rodada atual (`rodada` = o
 *   `entrou_em` da inscrição; a reentrada abre rodada nova e mantém o histórico).
 * - `envios_funil` é único por (inscrição, rodada, etapa): a linha é reservada **antes** do envio,
 *   como `incerto`, e um conflito vira `pulado`. Só vira `enviado` (com o id do Resend) depois da
 *   resposta: um processo morto no meio deixa `incerto`, que conta no limite do dia, segura a etapa
 *   seguinte e aparece na lista de incertos para alguém conferir no Resend.
 * - Resultado de cada tentativa:
 *   - recusa sobre o contato (`invalido`, `nao_encontrado`; fica `erro`): tentada de novo na rodada
 *     seguinte, até 3 tentativas; na 3ª a inscrição sai do funil;
 *   - erro da conta (`limite` 429, `credencial` 401/403; fica `erro`): tentado no dia seguinte, sem
 *     contar tentativa e sem nunca encerrar a inscrição; `credencial` para a rodada inteira;
 *   - rede ou 5xx (`incerto`): o email pode ter saído, então nunca é repetido sozinho;
 *   - erro sem chamada à API (marcador pendente, token): fica `erro`, sem contar tentativa nem limite.
 * - O token de descadastro deriva da primeira reserva: toda tentativa da mesma etapa manda o
 *   mesmo corpo, com a mesma chave de idempotência.
 * - Imediatamente antes de cada envio, o contato, a inscrição e o funil são relidos: descadastrado,
 *   dados apagados, inscrição que não está ativa (ou mudou de rodada) ou funil desligado nunca recebem.
 * - Sem acesso público (o link de descadastro não abriria), nada sai.
 * - Para o Resend vão só o email e o nome (no corpo). Nada de dado de contato em log ou evento.
 */

export type EtapaDevida = { inscricaoId: number; contatoId: number; slug: SlugFunil; etapa: number }
export type ResultadoEnvio = 'enviado' | 'pulado' | 'erro' | 'incerto'
export type ResultadoEnviosFunil = { enviados: number; pulados: number; erros: number; incertos: number; restantes: number }
export type ResultadoBoasVindasAgora = ResultadoEnvio | 'nada_devido'

/** Ordem de envio quando o limite diário não cobre tudo. */
export const PRIORIDADE_FUNIS: readonly SlugFunil[] = ['boas-vindas', 'reativacao', 'prospeccao-fria', 'nutricao-blog']
export const LIMITE_DIARIO_PADRAO = 90
export const MOTIVO_CONCLUSAO = 'sequência concluída'
export const MOTIVO_FALHA_PERMANENTE = 'falha permanente no envio'
/** Chamadas à API recusadas antes de desistir da etapa (e tirar o contato do funil). */
export const MAX_TENTATIVAS = 3

const DIA_MS = 86_400_000
const ERRO_MARCADOR = 'texto com marcador pendente'
const ERRO_TOKEN = 'link de descadastro indisponível (DESCADASTRO_SEGREDO)'
const ERRO_DESCONHECIDO = 'falha no envio; confira no Resend se o email saiu'
const ERRO_INTERROMPIDO = 'o envio não terminou; confira no Resend se o email saiu'
const ERRO_CANCELADO = 'não enviado: o contato, a inscrição ou o funil mudou antes do envio'
const TIPOS_INCERTOS: ReadonlySet<ErroResend['tipo']> = new Set(['rede', 'servidor'])
/** Recusas sobre o contato: só elas contam para a falha permanente. `limite` e `credencial` são da conta. */
const TIPOS_DO_CONTATO: ReadonlySet<ErroResend['tipo']> = new Set(['invalido', 'nao_encontrado'])

export function limiteDiario(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.RESEND_LIMITE_DIARIO ?? LIMITE_DIARIO_PADRAO)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : LIMITE_DIARIO_PADRAO
}

async function concluir(db: BancoCrm, inscricaoId: number, contatoId: number, slug: SlugFunil, agora: Date): Promise<void> {
  const concluidas = await db
    .update(funilInscricoes)
    .set({ status: 'concluido', saiuEm: agora, motivoSaida: MOTIVO_CONCLUSAO })
    .where(and(eq(funilInscricoes.id, inscricaoId), eq(funilInscricoes.status, 'ativo')))
    .returning({ id: funilInscricoes.id })
  if (concluidas.length === 0) return
  const [f] = await db.select({ nome: funis.nome }).from(funis).where(eq(funis.slug, slug))
  await db.insert(eventosContato).values({
    contatoId,
    tipo: 'saiu_funil',
    dados: { funil: slug, nome: f?.nome ?? null, motivo: MOTIVO_CONCLUSAO, concluido: true },
    em: agora,
  })
}

type EstadoEtapa = { status: 'enviado' | 'erro' | 'incerto'; tentativas: number; enviadoEm: Date }

async function buscarDevidas(
  db: BancoCrm,
  agora: Date,
  filtro?: { contatoId: number; slug: SlugFunil },
  somenteLeitura = false,
): Promise<EtapaDevida[]> {
  const linhas = await db
    .select({
      inscricaoId: funilInscricoes.id,
      contatoId: funilInscricoes.contatoId,
      slug: funis.slug,
      entrouEm: funilInscricoes.entrouEm,
      etapa: enviosFunil.etapa,
      status: enviosFunil.status,
      tentativas: enviosFunil.tentativas,
      enviadoEm: enviosFunil.enviadoEm,
    })
    .from(funilInscricoes)
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .innerJoin(contatos, eq(contatos.id, funilInscricoes.contatoId))
    // Só a rodada atual (comparação no banco: sem perder a precisão do timestamp).
    .leftJoin(enviosFunil, and(eq(enviosFunil.inscricaoId, funilInscricoes.id), eq(enviosFunil.rodada, funilInscricoes.entrouEm)))
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

  const porInscricao = new Map<number, { contatoId: number; slug: SlugFunil; entrouEm: Date; etapas: Map<number, EstadoEtapa> }>()
  for (const l of linhas) {
    if (!ehSlugFunil(l.slug)) continue
    let i = porInscricao.get(l.inscricaoId)
    if (!i) {
      i = { contatoId: l.contatoId, slug: l.slug, entrouEm: l.entrouEm, etapas: new Map() }
      porInscricao.set(l.inscricaoId, i)
    }
    if (l.etapa !== null && l.status !== null && l.tentativas !== null && l.enviadoEm !== null) {
      i.etapas.set(l.etapa, { status: l.status, tentativas: l.tentativas, enviadoEm: l.enviadoEm })
    }
  }

  const devidas: (EtapaDevida & { referencia: number })[] = []
  for (const [inscricaoId, i] of porInscricao) {
    const etapas = etapasDaSequencia(i.slug)
    // Sem sequência (nutrição): nada a enviar e nada a concluir.
    if (etapas.length === 0) continue
    let etapa = 0
    while (etapa < etapas.length && i.etapas.get(etapa)?.status === 'enviado') etapa++
    if (etapa >= etapas.length) {
      // Todas enviadas (ex.: queda depois do último envio): conclui aqui.
      if (!somenteLeitura) await concluir(db, inscricaoId, i.contatoId, i.slug, agora)
      continue
    }
    const atual = i.etapas.get(etapa)
    // Incerto nunca é repetido sozinho; recusa só até o máximo de tentativas.
    if (atual && (atual.status === 'incerto' || atual.tentativas >= MAX_TENTATIVAS)) continue
    const referencia = etapa === 0 ? i.entrouEm : i.etapas.get(etapa - 1)?.enviadoEm
    if (!referencia) continue
    if (referencia.getTime() + etapas[etapa].esperarDias * DIA_MS > agora.getTime()) continue
    devidas.push({ inscricaoId, contatoId: i.contatoId, slug: i.slug, etapa, referencia: referencia.getTime() })
  }
  devidas.sort(
    (a, b) => PRIORIDADE_FUNIS.indexOf(a.slug) - PRIORIDADE_FUNIS.indexOf(b.slug) || a.referencia - b.referencia || a.inscricaoId - b.inscricaoId,
  )
  return devidas.map(({ inscricaoId, contatoId, slug, etapa }) => ({ inscricaoId, contatoId, slug, etapa }))
}

/**
 * Etapas devidas agora, já na ordem de prioridade (boas-vindas, reativação, prospecção, nutrição).
 * Conclui, de passagem, inscrições cuja rodada atual já teve todas as etapas enviadas
 * (`somenteLeitura` não conclui nada: é o que as telas usam).
 */
export async function etapasDevidas(agora: Date, opts: { db?: BancoCrm; somenteLeitura?: boolean } = {}): Promise<EtapaDevida[]> {
  return buscarDevidas(opts.db ?? bancoPadrao(), agora, undefined, opts.somenteLeitura ?? false)
}

/** Emails de funil que saíram (ou podem ter saído) hoje, fuso de Brasília, em qualquer rodada. */
async function enviadosHoje(db: BancoCrm, agora: Date): Promise<number> {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(enviosFunil)
    .where(and(inArray(enviosFunil.status, ['enviado', 'incerto']), gte(enviosFunil.enviadoEm, inicioDoDiaBrasilia(agora))))
  return Number(n)
}

/** O POST one-click (RFC 8058) vai para a rota pública; o link do corpo abre a página. */
function urlOneClick(url: string): string {
  const u = new URL(url)
  u.pathname = '/api/publico/descadastro'
  return u.toString()
}

/** Resultado interno: `chamouApi` diz se a tentativa conta no limite do plano. */
async function tentarEtapa(
  item: EtapaDevida,
  db: BancoCrm,
  cliente: ClienteResend,
  agora: Date,
): Promise<{ resultado: ResultadoEnvio; chamouApi: boolean; pararRodada?: boolean }> {
  const nada = (resultado: ResultadoEnvio) => ({ resultado, chamouApi: false })
  const etapas = etapasDaSequencia(item.slug)
  const email = etapas[item.etapa]
  if (!email) return nada('pulado')

  // Reserva na rodada atual, como `incerto` (pode sair a partir daqui): insere, ou retoma uma
  // recusa (`erro`) com tentativas sobrando. `enviado` e `incerto` existentes = conflito sem
  // atualização = pulado.
  const rodadaAtual = sql`(select ${funilInscricoes.entrouEm} from ${funilInscricoes} where ${funilInscricoes.id} = ${item.inscricaoId})`
  const [reserva] = await db
    .insert(enviosFunil)
    .values({
      inscricaoId: item.inscricaoId,
      rodada: rodadaAtual,
      etapa: item.etapa,
      status: 'incerto',
      erro: ERRO_INTERROMPIDO,
      primeiraTentativaEm: agora,
      enviadoEm: agora,
    })
    .onConflictDoUpdate({
      target: [enviosFunil.inscricaoId, enviosFunil.rodada, enviosFunil.etapa],
      set: { status: 'incerto', erro: ERRO_INTERROMPIDO, enviadoEm: agora },
      setWhere: sql`${enviosFunil.status} = 'erro' and ${enviosFunil.tentativas} < ${MAX_TENTATIVAS}`,
    })
    .returning({
      id: enviosFunil.id,
      rodada: enviosFunil.rodada,
      primeiraTentativaEm: enviosFunil.primeiraTentativaEm,
      tentativas: enviosFunil.tentativas,
      nova: sql<boolean>`(xmax = 0)`,
    })
  if (!reserva) return nada('pulado')
  const envioId = reserva.id

  // Releitura imediatamente antes do envio (LGPD): nada do que foi selecionado antes vale aqui.
  const [atual] = await db
    .select({
      email: contatos.email,
      nome: contatos.nome,
      status: contatos.status,
      dadosApagadosEm: contatos.dadosApagadosEm,
      inscricao: funilInscricoes.status,
      contatoDaInscricao: funilInscricoes.contatoId,
      funilId: funis.id,
      funilAtivo: funis.ativo,
      slug: funis.slug,
      mesmaRodada: sql<boolean>`${funilInscricoes.entrouEm} = ${enviosFunil.rodada}`,
    })
    .from(enviosFunil)
    .innerJoin(funilInscricoes, eq(funilInscricoes.id, enviosFunil.inscricaoId))
    .innerJoin(funis, eq(funis.id, funilInscricoes.funilId))
    .innerJoin(contatos, eq(contatos.id, funilInscricoes.contatoId))
    .where(eq(enviosFunil.id, envioId))
  if (
    !atual ||
    !atual.mesmaRodada ||
    atual.contatoDaInscricao !== item.contatoId ||
    atual.slug !== item.slug ||
    atual.status === 'descadastrado' ||
    atual.dadosApagadosEm !== null ||
    atual.inscricao !== 'ativo' ||
    !atual.funilAtivo
  ) {
    // Desfaz a reserva sem apagar histórico de tentativas anteriores.
    if (reserva.nova) await db.delete(enviosFunil).where(eq(enviosFunil.id, envioId))
    else await db.update(enviosFunil).set({ status: 'erro', erro: ERRO_CANCELADO }).where(eq(enviosFunil.id, envioId))
    return nada('pulado')
  }

  // Erro sem chamada à API: fica `erro`, sem tentativa contada; volta a ser tentado (de graça).
  const semApi = async (mensagem: string) => {
    await db.update(enviosFunil).set({ status: 'erro', erro: mensagem }).where(eq(enviosFunil.id, envioId))
    return nada('erro')
  }
  let montado: ReturnType<typeof montarEmail>
  let url: string
  try {
    // Token da primeira reserva: a mesma etapa manda sempre o mesmo corpo.
    url = urlDescadastro(item.contatoId, reserva.primeiraTentativaEm)
    montado = montarEmail(email, { nome: atual.nome || null, urlDescadastro: url, whatsapp: linkWhatsapp() })
  } catch {
    return semApi(ERRO_TOKEN)
  }
  // `[fonte do contato]` (prospecção) sem resolver: o email não sai.
  if (marcadoresPendentes([montado.assunto, email.preCabecalho, montado.texto]).length > 0) return semApi(ERRO_MARCADOR)

  const tentativas = reserva.tentativas + 1
  let resendEmailId: string
  try {
    const r = await cliente.enviarEmail({
      para: atual.email,
      assunto: montado.assunto,
      html: montado.html,
      texto: montado.texto,
      cabecalhos: { 'List-Unsubscribe': `<${urlOneClick(url)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      chaveIdempotencia: `funil-${item.inscricaoId}-${item.etapa}-${reserva.rodada.getTime()}`,
      tags: [
        { name: 'funil', value: item.slug },
        { name: 'etapa', value: String(item.etapa) },
      ],
    })
    resendEmailId = r.id
  } catch (e) {
    // Mensagens do ErroResend são fixas (sem chave nem corpo da resposta).
    if (!(e instanceof ErroResend) || TIPOS_INCERTOS.has(e.tipo)) {
      // Rede, 5xx ou falha desconhecida: pode ter saído. Nunca repetido sozinho.
      await db
        .update(enviosFunil)
        .set({ status: 'incerto', tentativas, erro: e instanceof ErroResend ? e.message : ERRO_DESCONHECIDO })
        .where(eq(enviosFunil.id, envioId))
      return { resultado: 'incerto', chamouApi: true }
    }
    if (!TIPOS_DO_CONTATO.has(e.tipo)) {
      // Erro da conta (429, chave): não é culpa do contato; tenta amanhã sem gastar tentativa.
      await db.update(enviosFunil).set({ status: 'erro', erro: e.message }).where(eq(enviosFunil.id, envioId))
      return { resultado: 'erro', chamouApi: true, pararRodada: e.tipo === 'credencial' }
    }
    await db.update(enviosFunil).set({ status: 'erro', tentativas, erro: e.message }).where(eq(enviosFunil.id, envioId))
    if (tentativas >= MAX_TENTATIVAS) {
      await sair(atual.funilId, [item.contatoId], { db, motivo: MOTIVO_FALHA_PERMANENTE, agora })
    }
    return { resultado: 'erro', chamouApi: true }
  }

  await db.update(enviosFunil).set({ status: 'enviado', resendEmailId, tentativas, erro: null }).where(eq(enviosFunil.id, envioId))
  await db.insert(eventosContato).values({
    contatoId: item.contatoId,
    tipo: 'enviado',
    dados: { funil: item.slug, etapa: item.etapa, resendEmailId },
    em: agora,
  })
  if (item.etapa === etapas.length - 1) await concluir(db, item.inscricaoId, item.contatoId, item.slug, agora)
  return { resultado: 'enviado', chamouApi: true }
}

/**
 * Envia uma etapa: reserva a linha em `envios_funil` (conflito = `pulado`), relê contato,
 * inscrição e funil logo antes de enviar e grava o resultado. Depois da última etapa, a
 * inscrição vira `concluido`.
 */
export async function enviarEtapa(
  item: EtapaDevida,
  opts: { db?: BancoCrm; cliente: ClienteResend; agora: Date; acessoPublico: boolean },
): Promise<ResultadoEnvio> {
  if (!opts.acessoPublico) return 'pulado'
  return (await tentarEtapa(item, opts.db ?? bancoPadrao(), opts.cliente, opts.agora)).resultado
}

/**
 * Rotina diária: envia as etapas devidas por ordem de prioridade até o limite do plano
 * (descontado o que já saiu hoje). O que não couber fica para o dia seguinte (`restantes`).
 * Só tentativas que chamaram a API contam no limite. `deveParar` (prazo da rotina) para entre envios.
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
  const r: ResultadoEnviosFunil = { enviados: 0, pulados: 0, erros: 0, incertos: 0, restantes: devidas.length }
  if (!opts.acessoPublico || devidas.length === 0) return r
  const cota = Math.max(0, (opts.limite ?? limiteDiario()) - (await enviadosHoje(db, opts.agora)))
  let usadas = 0
  for (const item of devidas) {
    if (usadas >= cota || opts.deveParar?.()) break
    const { resultado, chamouApi, pararRodada } = await tentarEtapa(item, db, opts.cliente, opts.agora)
    if (chamouApi) usadas++
    if (resultado === 'enviado') r.enviados++
    else if (resultado === 'pulado') r.pulados++
    else if (resultado === 'incerto') r.incertos++
    else r.erros++
    r.restantes--
    // Chave inválida ou sem permissão: todo envio seguinte falharia igual. O resto fica para amanhã.
    if (pararRodada) break
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
  return (await tentarEtapa(item, db, opts.cliente, opts.agora)).resultado
}
