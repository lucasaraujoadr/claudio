import { z } from 'zod'
import * as cheerio from 'cheerio'

// Schema enviado ao modelo: leniente, sem min/max. Saída estrita exige todo campo em `required`: opcional = `.nullable()`.
export const blocoSchemaModelo = z.object({
  tipo: z.enum(['paragrafo', 'lista', 'lista_numerada', 'citacao']),
  texto: z.string().nullable(),
  itens: z.array(z.string()).nullable(),
  verificar: z.string().nullable(),
})

export const artigoSchemaModelo = z.object({
  titulo: z.string(),
  slug: z.string(),
  metaDescription: z.string(),
  introducao: z.array(blocoSchemaModelo),
  secoes: z.array(
    z.object({
      titulo: z.string(),
      subsecoes: z.array(z.object({ titulo: z.string(), blocos: z.array(blocoSchemaModelo) })).nullable(),
      blocos: z.array(blocoSchemaModelo),
    }),
  ),
  faq: z.array(z.object({ pergunta: z.string(), resposta: z.string() })),
  conclusao: z.array(blocoSchemaModelo),
})

export type BlocoModelo = z.infer<typeof blocoSchemaModelo>
export type ArtigoModelo = z.infer<typeof artigoSchemaModelo>

const SLUG_MAX = 75

export function normalizarSlug(s: string): string {
  const limpo = (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (limpo.length <= SLUG_MAX) return limpo
  let corte = limpo.slice(0, SLUG_MAX)
  // Se cortou no meio de uma palavra, volta até o último hífen.
  if (limpo[SLUG_MAX] !== '-' && corte.includes('-')) corte = corte.slice(0, corte.lastIndexOf('-'))
  return corte.replace(/-+$/g, '')
}

export function slugValido(s: string): boolean {
  return s.length >= 1 && s.length <= SLUG_MAX && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function desesc(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

function normalizarUrl(u: string): string {
  return u.trim().replace(/\/+$/, '')
}

function inline(texto: string, permitidas: Set<string>): string {
  let t = esc(texto)
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>')
  return t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, ancora: string, url: string) =>
    permitidas.has(normalizarUrl(desesc(url))) ? `<a href="${url}">${ancora}</a>` : ancora,
  )
}

function bloco(b: BlocoModelo, permitidas: Set<string>): string {
  const marcar = (conteudo: string) =>
    b.verificar ? `<mark data-verificar="${esc(b.verificar)}">${conteudo}</mark>` : conteudo
  if (b.tipo === 'lista' || b.tipo === 'lista_numerada') {
    const itens = (b.itens ?? []).filter((i) => i.trim())
    if (!itens.length) return ''
    const tag = b.tipo === 'lista' ? 'ul' : 'ol'
    return `<${tag}>${itens.map((i) => `<li>${marcar(inline(i, permitidas))}</li>`).join('')}</${tag}>`
  }
  const texto = (b.texto ?? '').trim()
  if (!texto) return ''
  const c = marcar(inline(texto, permitidas))
  return b.tipo === 'citacao' ? `<blockquote><p>${c}</p></blockquote>` : `<p>${c}</p>`
}

export function paraHtml(a: ArtigoModelo, urlsPermitidas: string[]): string {
  const perm = new Set(urlsPermitidas.map(normalizarUrl))
  const blocos = (bs: BlocoModelo[]) => bs.map((b) => bloco(b, perm)).join('')
  let h = blocos(a.introducao)
  for (const s of a.secoes) {
    h += `<h2>${esc(s.titulo)}</h2>` + blocos(s.blocos)
    for (const sub of s.subsecoes ?? []) {
      h += `<h3>${esc(sub.titulo)}</h3>` + blocos(sub.blocos)
    }
  }
  if (a.faq.length) {
    h += '<h2>Perguntas frequentes</h2>'
    for (const f of a.faq) h += `<h3>${esc(f.pergunta)}</h3><p>${inline(f.resposta, perm)}</p>`
  }
  return h + blocos(a.conclusao)
}

export function contarPalavras(html: string): number {
  // Espaço entre blocos, para que "</h2><p>" não cole duas palavras.
  const separado = (html ?? '').replace(/<\/(p|h[1-6]|li|blockquote|ul|ol|div)>|<br\s*\/?>/gi, ' $&')
  const texto = cheerio.load(separado, null, false).root().text()
  const m = texto.trim().match(/\S+/g)
  return m ? m.length : 0
}
