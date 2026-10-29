import { NextResponse, type NextRequest } from 'next/server'
import { virarTema } from '@/lib/radar/repositorio'

export const runtime = 'nodejs'

function voltar(request: NextRequest, flag: 'criado' | 'existia' | 'ja-tratada' | 'erro') {
  return NextResponse.redirect(new URL(`/tendencias?tese=${flag}`, request.url), 303)
}

export async function POST(request: NextRequest) {
  let id = NaN
  try {
    const valor = (await request.formData()).get('id')
    id = typeof valor === 'string' && /^\d{1,9}$/.test(valor) ? Number(valor) : NaN
  } catch {
    return voltar(request, 'erro')
  }
  if (!Number.isInteger(id)) return voltar(request, 'erro')
  try {
    const r = await virarTema(id)
    return voltar(request, r === 'ja_tratada' ? 'ja-tratada' : r)
  } catch (erro) {
    console.error('Falha ao transformar tese em tema', erro instanceof Error ? erro.name : 'erro')
    return voltar(request, 'erro')
  }
}
