import type { ItemConferencia } from '@/lib/artigos/conferencia'
import type { Artigo } from '@/lib/db/schema'

/**
 * O artigo como a tela de revisão usa: o que a rota `GET/PUT /api/artigos/[id]` devolve
 * (artigo + keyword + conferência), com datas em ISO. Nada de credencial nem trava de envio.
 */
export type ArtigoTela = {
  id: number
  topicId: number
  situacao: Artigo['situacao']
  titulo: string | null
  slug: string | null
  metaDescription: string | null
  /** HTML sanitizado no servidor (pode ter `<mark data-verificar>`). */
  conteudoHtml: string | null
  fontes: { titulo?: string; url: string }[]
  categoriaId: number | null
  capaMediaId: number | null
  capaUrl: string | null
  revisado: boolean
  agendadoPara: string | null
  wpStatus: string | null
  wpLink: string | null
  alteradoAposEnvio: boolean
  erro: string | null
  keyword: string
  conferencia: ItemConferencia[]
}

type Entrada = Omit<ArtigoTela, 'agendadoPara'> & { agendadoPara: Date | string | null }

/** Recorta e normaliza a visão do servidor (ou o JSON da rota) para a tela. */
export function paraTela(v: Entrada): ArtigoTela {
  return {
    id: v.id,
    topicId: v.topicId,
    situacao: v.situacao,
    titulo: v.titulo,
    slug: v.slug,
    metaDescription: v.metaDescription,
    conteudoHtml: v.conteudoHtml,
    fontes: Array.isArray(v.fontes) ? v.fontes : [],
    categoriaId: v.categoriaId,
    capaMediaId: v.capaMediaId,
    capaUrl: v.capaUrl,
    revisado: v.revisado,
    agendadoPara: v.agendadoPara == null ? null : new Date(v.agendadoPara).toISOString(),
    wpStatus: v.wpStatus,
    wpLink: v.wpLink,
    alteradoAposEnvio: v.alteradoAposEnvio,
    erro: v.erro,
    keyword: v.keyword,
    conferencia: Array.isArray(v.conferencia) ? v.conferencia : [],
  }
}

/** Mesmo critério de `podePublicar` (conferencia.ts), sem puxar o cheerio para o navegador. */
export function semBloqueio(itens: ItemConferencia[]): boolean {
  return !itens.some((i) => i.nivel === 'bloqueia')
}
