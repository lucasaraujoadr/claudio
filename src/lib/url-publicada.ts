const HOST_SITE = 'ogpericiacontabil.com.br'

export function urlPublicadaValida(valor: string): boolean {
  try {
    const u = new URL(valor)
    return u.protocol === 'https:' && u.hostname === HOST_SITE && u.username === '' && u.password === '' && u.port === ''
  } catch {
    return false
  }
}
