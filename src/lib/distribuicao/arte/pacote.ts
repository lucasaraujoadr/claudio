import { PDFDocument } from 'pdf-lib'
import { strToU8, zipSync } from 'fflate'
import { carrosselEstrito, type Carrossel } from '../schemas'
import { renderizarLamina } from './lamina'

/** Nome de arquivo seguro a partir do slug do artigo. */
export function nomeBase(slug: string | null): string {
  const s = (slug ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
  return s || 'artigo'
}

export function carrosselDaPeca(conteudo: unknown): Carrossel | null {
  const r = carrosselEstrito.safeParse(conteudo)
  return r.success ? r.data : null
}

export async function renderizarPng(c: Carrossel, n: number, variacao: 'escura' | 'clara'): Promise<Uint8Array | { erro: string }> {
  const r = await renderizarLamina(c.laminas[n - 1], n, c.laminas.length, variacao)
  if (!(r instanceof Response)) return r
  return new Uint8Array(await r.arrayBuffer())
}

export async function renderizarTodas(c: Carrossel, variacao: 'escura' | 'clara'): Promise<Uint8Array[] | { erro: string }> {
  const pngs: Uint8Array[] = []
  for (let n = 1; n <= c.laminas.length; n++) {
    const r = await renderizarPng(c, n, variacao)
    if (!(r instanceof Uint8Array)) return r
    pngs.push(r)
  }
  return pngs
}

export async function montarPdf(pngs: Uint8Array[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (const png of pngs) {
    const img = await pdf.embedPng(png)
    const pagina = pdf.addPage([1080, 1350])
    pagina.drawImage(img, { x: 0, y: 0, width: 1080, height: 1350 })
  }
  return pdf.save()
}

export function montarZip(pngs: Uint8Array[], legenda: string): Uint8Array {
  const arquivos: Record<string, Uint8Array> = {}
  pngs.forEach((p, i) => {
    arquivos[`lamina-${String(i + 1).padStart(2, '0')}.png`] = p
  })
  arquivos['legenda.txt'] = strToU8(legenda)
  return zipSync(arquivos, { level: 0 })
}
