import { bancoPadrao, type BancoCrm } from '@/lib/crm/banco'
import { ErroWp, type DadosPost, type criarClienteWp } from '@/lib/wordpress'
import { conferir, podePublicar, type ItemConferencia } from './conferencia'
import { slugValido } from './formato'
import { paraGutenberg, removerVerificar, sanitizarHtml } from './html'
import {
  desvincularDoWp,
  liberarEnvio,
  listarAgendados,
  obterArtigo,
  reivindicarEnvio,
  registrarEnvio,
  registrarErroEnvio,
} from './repositorio'

export type ModoEnvio = 'rascunho' | 'agendar' | 'publicar'
type ClienteWp = ReturnType<typeof criarClienteWp>

export type ResultadoEnvio =
  | { tipo: 'ok'; link: string; metaGravada: boolean }
  | { tipo: 'bloqueado'; itens: ItemConferencia[] }
  | { tipo: 'conflito' }
  | { tipo: 'erro'; mensagem: string }

const MARGEM_AGENDAMENTO_MS = 5 * 60_000
const STATUS_WP = { rascunho: 'draft', agendar: 'future', publicar: 'publish' } as const

async function enviarInterno(
  id: number,
  modo: ModoEnvio,
  opts: { sobrescrever?: boolean; cliente: ClienteWp; db?: BancoCrm; agora?: Date; keyword: string },
): Promise<ResultadoEnvio> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const cliente = opts.cliente
  const a = await obterArtigo(id, db)
  if (!a) return { tipo: 'erro', mensagem: 'artigo não encontrado' }

  try {
    const slug = a.slug ?? ''
    const slugEmUso = slugValido(slug) ? await cliente.slugEmUso(slug, a.wpPostId ?? undefined) : null
    const itens: ItemConferencia[] = conferir({
      titulo: a.titulo ?? '',
      slug,
      metaDescription: a.metaDescription ?? '',
      conteudoHtml: a.conteudoHtml ?? '',
      keyword: opts.keyword,
      categoriaId: a.categoriaId,
      capaMediaId: a.capaMediaId,
      revisado: a.revisado,
      slugEmUso,
    })
    // Ruling C: artigo já publicado só aceita "Atualizar no site"; rascunho/agendar tirariam o post do ar.
    if (a.wpStatus === 'publish' && modo !== 'publicar') {
      itens.push({ id: 'publicado', nivel: 'bloqueia', texto: 'Este artigo já está publicado; use "Atualizar no site".' })
      return { tipo: 'bloqueado', itens }
    }
    if (modo === 'rascunho') {
      if (itens.some((i) => i.nivel === 'bloqueia' && (i.id === 'titulo_vazio' || i.id === 'slug'))) {
        return { tipo: 'bloqueado', itens }
      }
    } else {
      if (modo === 'agendar' && (!a.agendadoPara || a.agendadoPara.getTime() <= agora.getTime() + MARGEM_AGENDAMENTO_MS)) {
        itens.push({ id: 'agendamento', nivel: 'bloqueia', texto: 'Agendamento: escolha uma data futura.' })
      }
      if (!podePublicar(itens)) return { tipo: 'bloqueado', itens }
    }

    let wpPostId = a.wpPostId
    if (wpPostId !== null) {
      const atual = await cliente.lerPost(wpPostId)
      if (atual === null) {
        await desvincularDoWp(id, db)
        wpPostId = null
      } else if (atual.modificadoGmt !== a.wpModificadoGmt && !opts.sobrescrever) {
        return { tipo: 'conflito' }
      }
    }

    const dados: DadosPost = {
      status: STATUS_WP[modo],
      titulo: (a.titulo ?? '').trim(),
      slug,
      conteudo: paraGutenberg(removerVerificar(sanitizarHtml(a.conteudoHtml ?? ''))),
      resumo: a.metaDescription ?? '',
      categorias: a.categoriaId != null ? [a.categoriaId] : [],
      capaId: a.capaMediaId,
      metaDescription: a.metaDescription ?? '',
      // Publicar com data = agora (menos num post já no ar, que mantém a data original): o WP mantém um date_gmt futuro antigo e deixaria o post agendado.
      ...(modo === 'agendar' && a.agendadoPara
        ? { dataGmt: a.agendadoPara.toISOString().slice(0, 19) }
        : modo === 'publicar' && a.wpStatus !== 'publish'
          ? { dataGmt: agora.toISOString().slice(0, 19) }
          : {}),
    }
    const post = wpPostId !== null ? await cliente.atualizarPost(wpPostId, dados) : await cliente.criarPost(dados)
    // O que vale é o status que o WP devolveu, não o pedido.
    const wpStatus = post.status === 'future' || post.status === 'publish' ? post.status : 'draft'
    await registrarEnvio(
      id,
      {
        wpPostId: post.id,
        wpStatus,
        wpLink: post.link,
        wpModificadoGmt: post.modificadoGmt,
      },
      agora,
      db,
    )
    return { tipo: 'ok', link: post.link, metaGravada: post.metaGravada }
  } catch (e) {
    if (e instanceof ErroWp) {
      await registrarErroEnvio(id, e.message, db)
      return { tipo: 'erro', mensagem: e.message }
    }
    throw e
  }
}

export async function enviarArtigo(
  id: number,
  modo: ModoEnvio,
  opts: { sobrescrever?: boolean; cliente: ClienteWp; db?: BancoCrm; agora?: Date; keyword: string },
): Promise<ResultadoEnvio> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  if (!(await obterArtigo(id, db))) return { tipo: 'erro', mensagem: 'artigo não encontrado' }
  const marca = await reivindicarEnvio(id, agora, db)
  if (!marca) return { tipo: 'erro', mensagem: 'envio já em andamento; aguarde' }
  try {
    return await enviarInterno(id, modo, { ...opts, db, agora })
  } finally {
    await liberarEnvio(id, marca, db)
  }
}

/** Reflete no painel o que o WordPress fez com os agendados. Devolve quantos já foram publicados. */
export async function sincronizarAgendados(cliente: ClienteWp, db: BancoCrm = bancoPadrao()): Promise<number> {
  let publicados = 0
  for (const a of await listarAgendados(db)) {
    if (a.wpPostId === null) continue
    try {
      const post = await cliente.lerPost(a.wpPostId)
      if (post === null) {
        await desvincularDoWp(a.id, db)
      } else if (post.status === 'publish') {
        await registrarEnvio(
          a.id,
          // Mantém o `modified_gmt` guardado: assim uma edição feita no WP ainda aparece como conflito.
          { wpPostId: post.id, wpStatus: 'publish', wpLink: post.link, wpModificadoGmt: a.wpModificadoGmt ?? post.modificadoGmt },
          new Date(),
          db,
        )
        publicados++
      }
    } catch (e) {
      // Um post com problema não impede os demais; tenta de novo no próximo dia.
      if (!(e instanceof ErroWp)) throw e
      // Credencial ou endereço errados afetam todos os posts: o cron deve acusar erro.
      if (e.tipo === 'credencial' || e.tipo === 'nao_encontrado') throw e
    }
  }
  return publicados
}
