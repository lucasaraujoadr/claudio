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

type Ctx = 'topo' | 'quote' | 'li' | 'texto'

const BLOCOS = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'li'])

function nomeFinal(no: { name: string }): string {
  const n = no.name.toLowerCase()
  return RENOMEAR[n] ?? n
}

function contemBloco(nos: AnyNode[]): boolean {
  for (const no of nos) {
    if (no.type !== 'tag') continue
    if (DESCARTAR.has(no.name.toLowerCase())) continue
    if (BLOCOS.has(nomeFinal(no))) return true
    if (contemBloco(no.children as AnyNode[])) return true
  }
  return false
}

function vazio(s: string): boolean {
  return s.replace(/<(?!br>)[^>]*>/g, '').trim() === '' && !s.includes('<br>')
}

function lista(no: AnyNode & { name: string; children: AnyNode[] }): string {
  const tag = nomeFinal(no)
  const itens: string[] = []
  let buf = ''
  const fecharBuf = () => {
    const t = buf.trim()
    if (!vazio(t)) itens.push(`<li>${t}</li>`)
    buf = ''
  }
  for (const f of no.children) {
    if (f.type === 'tag' && nomeFinal(f) === 'li') {
      fecharBuf()
      const dentro = emitir(f.children as AnyNode[], 'li').trim()
      if (!vazio(dentro)) itens.push(`<li>${dentro}</li>`)
    } else {
      buf += emitir([f], 'li')
    }
  }
  fecharBuf()
  return itens.length ? `<${tag}>${itens.join('')}</${tag}>` : ''
}

// Reconstrução com lista branca, ciente da estrutura: blocos nunca ficam dentro de inline,
// de parágrafo, título ou item; li solto vira lista; texto solto em lista vira item.
function emitir(nos: AnyNode[], ctx: Ctx): string {
  let saida = ''
  let corrida: string[] = []
  const fecharCorrida = () => {
    if (corrida.length) saida += `<ul>${corrida.join('')}</ul>`
    corrida = []
  }
  const emBloco = ctx === 'topo' || ctx === 'quote'
  for (const no of nos) {
    if (no.type === 'text') {
      if (corrida.length && !no.data.trim()) continue
      fecharCorrida()
      saida += escTexto(no.data)
      continue
    }
    if (no.type !== 'tag') continue
    const nome = no.name.toLowerCase()
    if (DESCARTAR.has(nome)) continue
    const tag = nomeFinal(no)
    const filhos = no.children as AnyNode[]
    if (tag === 'li' && emBloco) {
      const dentro = emitir(filhos, 'li').trim()
      if (!vazio(dentro)) corrida.push(`<li>${dentro}</li>`)
      continue
    }
    fecharCorrida()
    if (BLOCOS.has(tag)) {
      if ((tag === 'ul' || tag === 'ol') && ctx !== 'texto') {
        saida += lista(no as never)
      } else if (!emBloco) {
        saida += emitir(filhos, ctx) + ' '
      } else if (tag === 'p' || (tag === 'h2' || tag === 'h3') && ctx === 'quote') {
        if (tag === 'p' && contemBloco(filhos)) saida += emitir(filhos, ctx)
        else {
          const dentro = emitir(filhos, 'texto').trim()
          if (!vazio(dentro)) saida += `<p>${dentro}</p>`
        }
      } else if (tag === 'h2' || tag === 'h3') {
        const dentro = emitir(filhos, 'texto').trim()
        if (!vazio(dentro)) saida += `<${tag}>${dentro}</${tag}>`
      } else if (tag === 'blockquote') {
        if (ctx === 'quote') saida += emitir(filhos, 'quote')
        else {
          const dentro = emitir(filhos, 'quote')
          if (!vazio(dentro)) saida += `<blockquote>${dentro}</blockquote>`
        }
      } else {
        saida += emitir(filhos, ctx) + ' '
      }
      continue
    }
    if (!PERMITIDAS.has(tag)) {
      saida += emitir(filhos, ctx)
      continue
    }
    if (tag === 'br') {
      saida += '<br>'
    } else if (contemBloco(filhos)) {
      saida += emitir(filhos, ctx)
    } else if (tag === 'a') {
      const href = hrefSeguro(no.attribs.href)
      const dentro = emitir(filhos, 'texto')
      saida += href ? `<a href="${escAttr(href)}">${dentro}</a>` : dentro
    } else if (tag === 'mark') {
      const v = no.attribs['data-verificar']
      const dentro = emitir(filhos, 'texto')
      saida += v !== undefined ? `<mark data-verificar="${escAttr(v)}">${dentro}</mark>` : `<mark>${dentro}</mark>`
    } else {
      saida += `<${tag}>${emitir(filhos, 'texto')}</${tag}>`
    }
  }
  fecharCorrida()
  return saida
}

export function sanitizarHtml(html: string): string {
  const $ = cheerio.load(html ?? '', null, false)
  return emitir($.root().contents().toArray() as AnyNode[], 'topo').trim()
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

// Serializa nós já sanitizados com o mesmo escape do sanitizador.
function serializar(nos: AnyNode[]): string {
  let r = ''
  for (const no of nos) {
    if (no.type === 'text') r += escTexto(no.data)
    else if (no.type === 'tag') {
      const n = no.name
      const f = no.children as AnyNode[]
      if (n === 'br') r += '<br>'
      else if (n === 'a') r += `<a href="${escAttr(no.attribs.href ?? '')}">${serializar(f)}</a>`
      else if (n === 'mark') {
        const v = no.attribs['data-verificar']
        r += v !== undefined ? `<mark data-verificar="${escAttr(v)}">${serializar(f)}</mark>` : `<mark>${serializar(f)}</mark>`
      } else r += `<${n}>${serializar(f)}</${n}>`
    }
  }
  return r
}

const paragrafoWp = (c: string) => `<!-- wp:paragraph --><p>${c}</p><!-- /wp:paragraph -->`

function listaWp(no: AnyNode & { name: string; children: AnyNode[] }): string {
  const itens = (no.children as AnyNode[])
    .filter((f) => f.type === 'tag' && f.name === 'li')
    .map((li) => {
      let conteudo = ''
      let inline: AnyNode[] = []
      const fecha = () => {
        conteudo += serializar(inline)
        inline = []
      }
      for (const f of (li as { children: AnyNode[] }).children) {
        if (f.type === 'tag' && (f.name === 'ul' || f.name === 'ol')) {
          fecha()
          conteudo += listaWp(f as never)
        } else inline.push(f)
      }
      fecha()
      return `<!-- wp:list-item --><li>${conteudo}</li><!-- /wp:list-item -->`
    })
    .join('')
  const attrs = no.name === 'ol' ? ' {"ordered":true}' : ''
  return `<!-- wp:list${attrs} --><${no.name} class="wp-block-list">${itens}</${no.name}><!-- /wp:list -->`
}

// Agrupa nós soltos (texto/inline) em parágrafos e delega blocos a `bloco`.
function blocosWp(nos: AnyNode[], bloco: (no: AnyNode & { name: string; children: AnyNode[] }) => string | null): string[] {
  const saida: string[] = []
  let solto: AnyNode[] = []
  const fecha = () => {
    const t = serializar(solto).trim()
    if (t) saida.push(paragrafoWp(t))
    solto = []
  }
  for (const no of nos) {
    const b = no.type === 'tag' ? bloco(no as never) : null
    if (b === null) solto.push(no)
    else {
      fecha()
      saida.push(b)
    }
  }
  fecha()
  return saida
}

export function paraGutenberg(html: string): string {
  const limpo = sanitizarHtml(html ?? '')
  const $ = cheerio.load(limpo, null, false)
  const topo = blocosWp($.root().contents().toArray() as AnyNode[], (no) => {
    const c = no.children as AnyNode[]
    switch (no.name) {
      case 'p':
        return paragrafoWp(serializar(c))
      case 'h2':
        return `<!-- wp:heading --><h2 class="wp-block-heading">${serializar(c)}</h2><!-- /wp:heading -->`
      case 'h3':
        return `<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">${serializar(c)}</h3><!-- /wp:heading -->`
      case 'ul':
      case 'ol':
        return listaWp(no)
      case 'blockquote': {
        const partes = blocosWp(c, (f) =>
          f.name === 'p' ? paragrafoWp(serializar(f.children as AnyNode[])) : f.name === 'ul' || f.name === 'ol' ? listaWp(f) : null,
        )
        return `<!-- wp:quote --><blockquote class="wp-block-quote">${partes.join('')}</blockquote><!-- /wp:quote -->`
      }
      default:
        return null // inline ou desconhecido: nunca descarta, vira parágrafo
    }
  })
  return topo.join('\n\n')
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

/** Texto puro para campos de uma linha (título, meta): sem tags, sem "<" ou ">" sobrando. Só servidor (usa cheerio). */
export function textoPuro(bruto: string): string {
  return cheerio
    .load(`<div>${bruto}</div>`)('div')
    .text()
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** HTML do artigo em texto, para prompts: sanitiza, tira as marcas "verificar" e mantém quebras entre blocos. */
export function htmlParaTexto(html: string): string {
  const $ = cheerio.load(removerVerificar(sanitizarHtml(html ?? '')), null, false)
  $('br').replaceWith('\n')
  $('h2, h3').each((_, el) => {
    $(el).replaceWith(`\n\n## ${$(el).text().replace(/\s+/g, ' ').trim()}\n\n`)
  })
  $('li').each((_, el) => {
    $(el).replaceWith(`\n- ${$(el).text().replace(/\s+/g, ' ').trim()}`)
  })
  $('p, blockquote, ul, ol').each((_, el) => {
    $(el).append('\n\n')
  })
  return $.root()
    .text()
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
