/**
 * Verifica se o painel é alcançável de fora (sem login da Vercel). O link de descadastro, os webhooks
 * e o formulário do site dependem disso (spec §2.9). Só `200` com o JSON `{ ok: true }` conta: a página
 * de login da Vercel devolve 401, um redirect ou HTML, e tudo isso é "não acessível".
 */

export const URL_PUBLICA_PADRAO = 'https://claudio-psi-lime.vercel.app'
const TIMEOUT_MS = 5_000
const VALIDADE_OK_MS = 10 * 60_000
/** Falha vale pouco: quem acabou de liberar o acesso na Vercel não espera 10 min. */
const VALIDADE_FALHA_MS = 60_000

/** `URL_PUBLICA_PAINEL` sem barra no final; padrão: o domínio de produção. */
export function urlPublicaPainel(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.URL_PUBLICA_PAINEL?.trim() || URL_PUBLICA_PADRAO
  return url.replace(/\/+$/, '')
}

let cache: { ate: number; ok: boolean } | null = null

export function limparCacheAcessoPublico(): void {
  cache = null
}

export async function acessoPublicoOk(f: typeof fetch = fetch): Promise<boolean> {
  const agora = Date.now()
  if (cache && cache.ate > agora) return cache.ok
  let ok = false
  try {
    const resp = await f(`${urlPublicaPainel()}/api/publico/saude`, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (resp.status === 200) {
      const json: unknown = await resp.json().catch(() => null)
      ok = typeof json === 'object' && json !== null && (json as { ok?: unknown }).ok === true
    }
  } catch {
    ok = false
  }
  cache = { ate: agora + (ok ? VALIDADE_OK_MS : VALIDADE_FALHA_MS), ok }
  return ok
}
