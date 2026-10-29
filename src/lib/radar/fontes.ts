import { createHash } from 'node:crypto'
import { chaveDeFonte } from '@/lib/ai/cliente'

export type MotivoFonte = 'url_invalida' | 'pagina_de_busca' | 'fonte_nao_citada'

// Parâmetros de consulta que denunciam página de busca ou de listagem de resultados.
const PARAM_BUSCA = /^(q|s\d*|query|search|busca|buscar|pesquisa|pesquisar|termo|palavra|texto|keyword|keywords)$|busca|pesq|search|livre/i
// Segmentos de caminho que denunciam o mesmo (pesquisa de jurisprudência, resultados etc.).
const SEGMENTO_BUSCA = /^(busca|buscar|pesquisa|pesquisar|search|resultados?|listar\w*|consulta-?processual)$/i

/** Página de busca ou de listagem não é fonte de um fato: muda a cada consulta. */
export function ehPaginaDeBusca(url: URL): boolean {
  for (const chave of url.searchParams.keys()) if (PARAM_BUSCA.test(chave)) return true
  const segmentos = url.pathname.split('/').filter(Boolean)
  // A página inicial de um site também não aponta para fato nenhum.
  if (segmentos.length === 0) return true
  return segmentos.some((s) => SEGMENTO_BUSCA.test(s))
}

/**
 * Valida a URL que o modelo de busca devolveu: http(s), não é busca/listagem e consta entre as
 * fontes que o provedor realmente citou (mesma normalização de gerarObjetoComBuscaEFontes).
 */
export function validarFonte(
  fonteUrl: string,
  fontes: string[],
): { ok: true; chave: string } | { ok: false; motivo: MotivoFonte } {
  const chave = chaveDeFonte(fonteUrl.trim())
  if (!chave) return { ok: false, motivo: 'url_invalida' }
  if (ehPaginaDeBusca(new URL(fonteUrl.trim()))) return { ok: false, motivo: 'pagina_de_busca' }
  const citadas = new Set(fontes.map(chaveDeFonte))
  if (!citadas.has(chave)) return { ok: false, motivo: 'fonte_nao_citada' }
  return { ok: true, chave }
}

/** Identidade de uma fonte: sha256 da URL normalizada. */
export function hashDeFonte(chave: string): string {
  return createHash('sha256').update(chave).digest('hex')
}
