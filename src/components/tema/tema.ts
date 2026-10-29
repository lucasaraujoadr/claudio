/**
 * Tema do painel: `escuro` ou `claro`.
 *
 * Fonte da verdade, em ordem: cookie `tema` (o servidor lê e já renderiza o atributo),
 * `localStorage` (mesma escolha, caso o cookie tenha expirado) e, sem escolha salva,
 * `prefers-color-scheme`. O atributo vive em `<html data-theme="…">`.
 */
export type Tema = 'escuro' | 'claro'

export const TEMAS: readonly Tema[] = ['escuro', 'claro']
export const NOME_COOKIE_TEMA = 'tema'
export const CHAVE_STORAGE_TEMA = 'tema'
export const ATRIBUTO_TEMA = 'data-theme'
/** Um ano, em segundos. */
export const DURACAO_COOKIE_TEMA = 60 * 60 * 24 * 365

/** Aceita só os dois valores conhecidos; qualquer outra coisa vira null. */
export function normalizarTema(valor: unknown): Tema | null {
  return valor === 'escuro' || valor === 'claro' ? valor : null
}

export function alternarTema(atual: Tema): Tema {
  return atual === 'escuro' ? 'claro' : 'escuro'
}

/**
 * Cor do `<meta name="theme-color">` (barra do navegador no celular) em cada tema: o
 * fundo da página (`--og-fundo`).
 */
export const COR_TEMA: Record<Tema, string> = { claro: '#f5f3ee', escuro: '#0e0f11' }

/**
 * Valor do `document.cookie` que grava a escolha. `seguro` acrescenta `Secure` (página
 * servida por HTTPS): o cookie não vaza numa conexão sem criptografia.
 */
export function cookieDoTema(tema: Tema, seguro = false): string {
  return `${NOME_COOKIE_TEMA}=${tema}; path=/; max-age=${DURACAO_COOKIE_TEMA}; SameSite=Lax${seguro ? '; Secure' : ''}`
}

/** Lê o tema de uma string de cookies (`document.cookie` ou cabeçalho Cookie). */
export function temaDoCookie(cookies: string): Tema | null {
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${NOME_COOKIE_TEMA}=([^;]*)`))
  if (!m) return null
  try {
    return normalizarTema(decodeURIComponent(m[1]))
  } catch {
    // Sequência % malformada (`tema=%E0%A4%A`): não é um tema válido.
    return null
  }
}

/** A página foi servida por HTTPS? (decide o `Secure` do cookie). */
function paginaSegura(doc: Document): boolean {
  return doc.location?.protocol === 'https:'
}

/**
 * Faz a cor da barra do navegador seguir o tema escolhido, não só o do sistema: muda o
 * `content` de todos os `<meta name="theme-color">` (os de `media` claro e escuro).
 */
export function sincronizarCorDoTema(tema: Tema, doc: Document = document): void {
  const metas = doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
  if (metas.length === 0) {
    const meta = doc.createElement('meta')
    meta.name = 'theme-color'
    meta.content = COR_TEMA[tema]
    doc.head.appendChild(meta)
    return
  }
  metas.forEach((m) => {
    m.content = COR_TEMA[tema]
  })
}

/**
 * Tema efetivo no navegador agora. O atributo em `<html>` tem prioridade porque o script
 * inline já resolveu cookie → localStorage → sistema antes da primeira pintura.
 */
export function temaAtual(doc: Document = document): Tema {
  const doAtributo = normalizarTema(doc.documentElement.getAttribute(ATRIBUTO_TEMA))
  if (doAtributo) return doAtributo
  const salvo = temaDoCookie(doc.cookie) ?? lerStorage()
  if (salvo) return salvo
  return prefereEscuro() ? 'escuro' : 'claro'
}

/** Aplica no DOM (atributo e cor da barra do navegador) e grava nas duas persistências. */
export function aplicarTema(tema: Tema, doc: Document = document): void {
  doc.documentElement.setAttribute(ATRIBUTO_TEMA, tema)
  sincronizarCorDoTema(tema, doc)
  doc.cookie = cookieDoTema(tema, paginaSegura(doc))
  try {
    localStorage.setItem(CHAVE_STORAGE_TEMA, tema)
  } catch {
    // Storage bloqueado (modo privado, política do navegador): o cookie já basta.
  }
}

function lerStorage(): Tema | null {
  try {
    return normalizarTema(localStorage.getItem(CHAVE_STORAGE_TEMA))
  } catch {
    return null
  }
}

function prefereEscuro(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Script inline do `<head>`: roda durante o parse do HTML, antes da primeira pintura.
 * Só toca no atributo quando o servidor não o trouxe (sem cookie); se vier do
 * localStorage, regrava o cookie para o próximo request já sair certo do servidor.
 * Também alinha os `<meta name="theme-color">` que já estiverem no DOM ao tema resolvido.
 * Autocontido de propósito: não pode depender do bundle.
 */
export const SCRIPT_TEMA = `(function(){try{var d=document.documentElement,a="${ATRIBUTO_TEMA}",t=d.getAttribute(a);if(t!=="escuro"&&t!=="claro"){var m=document.cookie.match(/(?:^|;\\s*)${NOME_COOKIE_TEMA}=(escuro|claro)(?:;|$)/);t=m?m[1]:null;if(!t){try{var s=localStorage.getItem("${CHAVE_STORAGE_TEMA}");if(s==="escuro"||s==="claro"){t=s;document.cookie="${NOME_COOKIE_TEMA}="+s+"; path=/; max-age=${DURACAO_COOKIE_TEMA}; SameSite=Lax"+(location.protocol==="https:"?"; Secure":"")}}catch(e){}}if(!t)t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"escuro":"claro";d.setAttribute(a,t)}var c=t==="escuro"?"${COR_TEMA.escuro}":"${COR_TEMA.claro}",q=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<q.length;i++)q[i].setAttribute("content",c)}catch(e){}})()`
