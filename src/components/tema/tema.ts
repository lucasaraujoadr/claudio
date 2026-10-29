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

/** Valor do `document.cookie` que grava a escolha. */
export function cookieDoTema(tema: Tema): string {
  return `${NOME_COOKIE_TEMA}=${tema}; path=/; max-age=${DURACAO_COOKIE_TEMA}; SameSite=Lax`
}

/** Lê o tema de uma string de cookies (`document.cookie` ou cabeçalho Cookie). */
export function temaDoCookie(cookies: string): Tema | null {
  const m = cookies.match(new RegExp(`(?:^|;\\s*)${NOME_COOKIE_TEMA}=([^;]*)`))
  return m ? normalizarTema(decodeURIComponent(m[1])) : null
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

/** Aplica no DOM e grava nas duas persistências. */
export function aplicarTema(tema: Tema, doc: Document = document): void {
  doc.documentElement.setAttribute(ATRIBUTO_TEMA, tema)
  doc.cookie = cookieDoTema(tema)
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
 * Autocontido de propósito: não pode depender do bundle.
 */
export const SCRIPT_TEMA = `(function(){try{var d=document.documentElement,a="${ATRIBUTO_TEMA}",t=d.getAttribute(a);if(t!=="escuro"&&t!=="claro"){var m=document.cookie.match(/(?:^|;\\s*)${NOME_COOKIE_TEMA}=(escuro|claro)(?:;|$)/);t=m?m[1]:null;if(!t){try{var s=localStorage.getItem("${CHAVE_STORAGE_TEMA}");if(s==="escuro"||s==="claro"){t=s;document.cookie="${NOME_COOKIE_TEMA}="+s+"; path=/; max-age=${DURACAO_COOKIE_TEMA}; SameSite=Lax"}}catch(e){}}if(!t)t=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"escuro":"claro";d.setAttribute(a,t)}}catch(e){}})()`
