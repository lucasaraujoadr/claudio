import { NextResponse, type NextRequest } from 'next/server'
import { descartarTese } from '@/lib/radar/repositorio'

export const runtime = 'nodejs'

function voltar(request: NextRequest, flag: 'descartada' | 'ja-tratada' | 'erro') {
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
    return voltar(request, (await descartarTese(id)) ? 'descartada' : 'ja-tratada')
  } catch (erro) {
    console.error('Falha ao descartar tese', erro instanceof Error ? erro.name : 'erro')
    return voltar(request, 'erro')
  }
}
