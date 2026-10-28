import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_SESSAO } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const resposta = NextResponse.redirect(new URL('/login', request.url), 303)
  resposta.cookies.set(COOKIE_SESSAO, '', {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return resposta
}
