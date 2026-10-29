import { NextResponse, type NextRequest } from 'next/server'
import { obterArtigo, salvarEdicao } from '@/lib/artigos/repositorio'
import { idDaRota } from '@/lib/artigos/visao'
import { configWp, criarClienteWp, ErroWp } from '@/lib/wordpress'

export const runtime = 'nodejs'
export const maxDuration = 60

const LIMITE_BYTES = 4 * 1024 * 1024

function tipoPorBytes(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (
    b.length >= 12 &&
    String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.subarray(8, 12)) === 'WEBP'
  )
    return 'image/webp'
  return null
}

const EXTENSAO: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = idDaRota((await ctx.params).id)
  if (!id) return NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
  const cfg = configWp()
  if (!cfg) return NextResponse.json({ erro: 'WordPress não configurado' }, { status: 503 })

  let arquivo: FormDataEntryValue | null
  try {
    arquivo = (await request.formData()).get('arquivo')
  } catch {
    return NextResponse.json({ erro: 'envie a imagem no campo "arquivo"' }, { status: 400 })
  }
  if (!arquivo || typeof arquivo === 'string') {
    return NextResponse.json({ erro: 'envie a imagem no campo "arquivo"' }, { status: 400 })
  }
  if (arquivo.size > LIMITE_BYTES) {
    return NextResponse.json({ erro: 'a imagem passa de 4 MB' }, { status: 413 })
  }
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  if (bytes.length > LIMITE_BYTES) return NextResponse.json({ erro: 'a imagem passa de 4 MB' }, { status: 413 })
  const tipo = tipoPorBytes(bytes)
  if (!tipo) return NextResponse.json({ erro: 'use uma imagem JPEG, PNG ou WebP' }, { status: 400 })

  try {
    if (!(await obterArtigo(id))) return NextResponse.json({ erro: 'artigo não encontrado' }, { status: 404 })
    const midia = await criarClienteWp(cfg).enviarImagem(bytes, `capa-${id}.${EXTENSAO[tipo]}`, tipo)
    const atualizado = await salvarEdicao(id, { capaMediaId: midia.id, capaUrl: midia.url }, new Date())
    if (!atualizado) return NextResponse.json({ erro: 'o artigo ainda está sendo gerado' }, { status: 409 })
    return NextResponse.json({ capaMediaId: midia.id, capaUrl: midia.url })
  } catch (e) {
    if (e instanceof ErroWp) return NextResponse.json({ erro: e.message }, { status: 502 })
    console.error('Falha ao enviar capa', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao enviar a capa' }, { status: 500 })
  }
}
