/** Endereço público do site auditado; valor público, por isso pode ter padrão no código. */
export const SITE_URL_PADRAO = 'https://ogpericiacontabil.com.br'

/** Origem do site (https, sem barra final), de SITE_URL ou do padrão. Lida a cada chamada. */
export function siteUrl(): string {
  const bruto = process.env.SITE_URL?.trim() || SITE_URL_PADRAO
  let u: URL
  try {
    u = new URL(bruto)
  } catch {
    throw new Error('SITE_URL inválida: informe uma URL completa, como https://ogpericiacontabil.com.br')
  }
  if (u.protocol !== 'https:') throw new Error('SITE_URL precisa usar https://')
  return u.origin
}

/** Host do site, ex.: ogpericiacontabil.com.br. */
export function hostSite(): string {
  return new URL(siteUrl()).hostname
}

/** Valor do atributo `pattern` do campo de URL publicada: https no host do site. */
export function padraoUrlPublicada(): string {
  return `https://${hostSite().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.*`
}
