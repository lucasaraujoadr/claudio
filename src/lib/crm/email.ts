/**
 * Identidade do contato: email aparado e em minúsculas, ou `null` quando não é um
 * endereço plausível. Plausível = um único `@`, parte local e domínio não vazios, um
 * ponto no domínio (sem rótulo vazio), nenhum espaço, até 254 caracteres. Não tenta
 * validar o RFC 5321 inteiro: só barra o que certamente não recebe email.
 */
export function normalizarEmail(entrada: string | null | undefined): string | null {
  if (typeof entrada !== 'string') return null
  const e = entrada.trim().toLowerCase()
  if (e.length === 0 || e.length > 254) return null
  if (/\s/.test(e)) return null
  const partes = e.split('@')
  if (partes.length !== 2) return null
  const [local, dominio] = partes
  if (!local || !dominio) return null
  if (/[<>(),;:"[\]\\]/.test(local) || /[^a-z0-9.-]/.test(dominio.normalize('NFKC').replace(/[^\x00-\x7f]/g, 'a'))) {
    return null
  }
  const rotulos = dominio.split('.')
  if (rotulos.length < 2 || rotulos.some((r) => r.length === 0)) return null
  return e
}
