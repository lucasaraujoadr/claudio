import { hostSite } from './site'

export function urlPublicadaValida(valor: string): boolean {
  try {
    const u = new URL(valor)
    return u.protocol === 'https:' && u.hostname === hostSite() && u.username === '' && u.password === '' && u.port === ''
  } catch {
    return false
  }
}
