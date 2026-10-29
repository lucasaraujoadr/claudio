import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'

// Sanitização por reconstrução com lista branca: só o que está aqui sai no resultado.
const DESCARTAR = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template'])
const PERMITIDAS = new Set(['p', 'h2', 'h3', 'strong', 'em', 'ul', 'ol', 'li', 'blockquote', 'a', 'mark', 'br'])
const RENOMEAR: Record<string, string> = {
  b: 'strong', i: 'em', h1: 'h2', h4: 'h3', h5: 'h3', h6: 'h3', div: 'p',
}

function escTexto(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function escAttr(s: string): string {
  return escTexto(s).replace(/"/g, '&quot;')
}

function hrefSeguro(bruto: string | undefined): string | null {
  if (!bruto) return null
  // Navegadores ignoram espaços e controles dentro do esquema ("java\nscript:").
  // eslint-disable-next-line no-control-regex
  const href = bruto.replace(/[\u0000- \u007f-\u009f]/g, '')
  if (!href) return null
  if (href.startsWith('#')) return href
  if (/^https?:\/\//i.test(href)) return href
  return null
}

function reconstruir(nos: AnyNode[]): string {
  let saida = ''
  for (const no of nos) {
    if (no.type === 'text') {
      saida += escTexto(no.data)
      continue
    }
    if (no.type !== 'tag') continue // comentários, diretivas, cdata etc. somem
    const nome = no.name.toLowerCase()
    if (DESCARTAR.has(nome)) continue
    const tag = RENOMEAR[nome] ?? nome
    const filhos = () => reconstruir(no.children as AnyNode[])
    if (!PERMITIDAS.has(tag)) {
      saida += filhos()
      continue
    }
    if (tag === 'br') {
      saida += '<br>'
    } else if (tag === 'a') {
      const href = hrefSeguro(no.attribs.href)
      saida += href ? `<a href="${escAttr(href)}">${filhos()}</a>` : filhos()
    } else if (tag === 'mark') {
      const v = no.attribs['data-verificar']
      saida += v !== undefined ? `<mark data-verificar="${escAttr(v)}">${filhos()}</mark>` : `<mark>${filhos()}</mark>`
    } else {
      saida += `<${tag}>${filhos()}</${tag}>`
    }
  }
  return saida
}

export function sanitizarHtml(html: string): string {
  const $ = cheerio.load(html ?? '', null, false)
  return reconstruir($.root().contents().toArray() as AnyNode[])
}

export function removerVerificar(html: string): string {
  const $ = cheerio.load(html ?? '', null, false)
  $('mark').each((_, el) => {
    $(el).replaceWith($(el).contents())
  })
  return $.root().html() ?? ''
}

export function contarVerificar(html: string): number {
  const $ = cheerio.load(html ?? '', null, false)
  return $('mark[data-verificar]').length
}

const INLINE = new Set(['strong', 'em', 'a', 'mark', 'br'])

export function paraGutenberg(htmlSanitizado: string): string {
  const $ = cheerio.load(htmlSanitizado ?? '', null, false)
  const blocos: string[] = []
  let solto = ''
  const paragrafo = (conteudo: string) => `<!-- wp:paragraph --><p>${conteudo}</p><!-- /wp:paragraph -->`
  const fecharSolto = () => {
    if (solto.trim()) blocos.push(paragrafo(solto.trim()))
    solto = ''
  }
  for (const no of $.root().contents().toArray() as AnyNode[]) {
    if (no.type === 'text') {
      solto += escTexto(no.data)
      continue
    }
    if (no.type !== 'tag') continue
    const nome = no.name
    const interno = $(no).html() ?? ''
    if (INLINE.has(nome)) {
      solto += $.html(no)
      continue
    }
    fecharSolto()
    if (nome === 'p') blocos.push(paragrafo(interno))
    else if (nome === 'h2') blocos.push(`<!-- wp:heading --><h2 class="wp-block-heading">${interno}</h2><!-- /wp:heading -->`)
    else if (nome === 'h3') blocos.push(`<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${interno}</h3><!-- /wp:heading -->`)
    else if (nome === 'ul' || nome === 'ol') {
      const itens = $(no)
        .children('li')
        .toArray()
        .map((li) => `<!-- wp:list-item --><li>${$(li).html() ?? ''}</li><!-- /wp:list-item -->`)
        .join('')
      const attrs = nome === 'ol' ? ' {"ordered":true}' : ''
      blocos.push(`<!-- wp:list${attrs} --><${nome} class="wp-block-list">${itens}</${nome}><!-- /wp:list -->`)
    } else if (nome === 'blockquote') {
      const sub = cheerio.load(interno, null, false)
      const partes: string[] = []
      let s = ''
      const fecha = () => {
        if (s.trim()) partes.push(paragrafo(s.trim()))
        s = ''
      }
      for (const f of sub.root().contents().toArray() as AnyNode[]) {
        if (f.type === 'text') s += escTexto(f.data)
        else if (f.type === 'tag' && f.name === 'p') {
          fecha()
          partes.push(paragrafo(sub(f).html() ?? ''))
        } else if (f.type === 'tag') s += sub.html(f)
      }
      fecha()
      blocos.push(`<!-- wp:quote --><blockquote class="wp-block-quote">${partes.join('')}</blockquote><!-- /wp:quote -->`)
    }
  }
  fecharSolto()
  return blocos.join('\n\n')
}

export function extrairPrimeiroParagrafo(html: string): string {
  const $ = cheerio.load(html ?? '', null, false)
  return $('p').first().text().replace(/\s+/g, ' ').trim()
}

export function extrairH2(html: string): string[] {
  const $ = cheerio.load(html ?? '', null, false)
  return $('h2')
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function contarLinksInternos(html: string, host: string): number {
  const alvo = host.toLowerCase().replace(/^www\./, '')
  const $ = cheerio.load(html ?? '', null, false)
  let n = 0
  $('a[href]').each((_, el) => {
    try {
      const u = new URL($(el).attr('href') ?? '')
      if (u.hostname.toLowerCase().replace(/^www\./, '') === alvo) n++
    } catch {
      // href relativo ou inválido: não conta
    }
  })
  return n
}
