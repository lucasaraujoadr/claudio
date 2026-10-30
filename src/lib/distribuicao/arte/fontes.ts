import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type FonteSatori = { name: string; data: Buffer; weight: 400 | 600; style: 'normal' }

let cache: Promise<FonteSatori[]> | null = null

async function ler(): Promise<FonteSatori[]> {
  const dir = join(process.cwd(), 'assets', 'fontes')
  const [serif, plex, plexSemi] = await Promise.all([
    readFile(join(dir, 'SourceSerif4-Semibold.ttf')),
    readFile(join(dir, 'IBMPlexSans-Regular.ttf')),
    readFile(join(dir, 'IBMPlexSans-SemiBold.ttf')),
  ])
  return [
    { name: 'Source Serif 4', data: serif, weight: 600, style: 'normal' },
    { name: 'IBM Plex Sans', data: plex, weight: 400, style: 'normal' },
    { name: 'IBM Plex Sans', data: plexSemi, weight: 600, style: 'normal' },
  ]
}

/** Lê os TTF do repositório (assets/fontes). Entram no bundle via outputFileTracingIncludes. */
export function carregarFontes(): Promise<FonteSatori[]> {
  const p = cache ?? ler()
  cache = p
  p.catch(() => {
    if (cache === p) cache = null
  })
  return p
}
