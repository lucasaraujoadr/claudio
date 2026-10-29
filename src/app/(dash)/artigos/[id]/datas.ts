/** Datas do agendamento: o campo `datetime-local` é sempre no horário de Brasília. */
export const FUSO = 'America/Sao_Paulo'

const partes = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

function emBrasilia(d: Date): { y: number; m: number; d: number; h: number; mi: number } {
  const p = Object.fromEntries(partes.formatToParts(d).map((x) => [x.type, x.value]))
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute) }
}

/** Minutos que Brasília está à frente (negativo: atrás) do UTC naquele instante. */
function deslocamento(d: Date): number {
  const p = emBrasilia(d)
  const comoUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi)
  return Math.round((comoUtc - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000)
}

/** "2026-11-03T09:30" (Brasília) → ISO em UTC. Valor inválido → null. */
export function localParaIso(local: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const base = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  if (Number.isNaN(base)) return null
  return new Date(base - deslocamento(new Date(base)) * 60_000).toISOString()
}

/** ISO → valor do `datetime-local` no horário de Brasília. */
export function isoParaLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = emBrasilia(d)
  const z = (n: number) => String(n).padStart(2, '0')
  return `${p.y}-${z(p.m)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`
}

const formatoBrasilia = new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' })

/** ISO → "03/11/2026, 09:30" no horário de Brasília. */
export function formatarBrasilia(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : formatoBrasilia.format(d)
}
