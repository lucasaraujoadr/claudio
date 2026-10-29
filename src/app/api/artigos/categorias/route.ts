import { NextResponse } from 'next/server'
import { configWp, criarClienteWp, ErroWp } from '@/lib/wordpress'

export const runtime = 'nodejs'

export async function GET() {
  const cfg = configWp()
  if (!cfg) return NextResponse.json({ erro: 'WordPress não configurado' }, { status: 503 })
  try {
    return NextResponse.json(await criarClienteWp(cfg).listarCategorias())
  } catch (e) {
    if (e instanceof ErroWp) return NextResponse.json({ erro: e.message }, { status: 503 })
    console.error('Falha ao listar categorias', e instanceof Error ? e.name : 'erro')
    return NextResponse.json({ erro: 'falha ao listar categorias' }, { status: 503 })
  }
}
