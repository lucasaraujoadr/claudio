import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_SESSAO, DURACAO_SESSAO_MS, criarTokenSessao, isCorrectPassword } from '@/lib/auth'

export async function POST(request: NextRequest) {
  let senha: FormDataEntryValue | null = null
  try {
    senha = (await request.formData()).get('senha')
  } catch {
    // Corpo que não é formulário: mesma resposta de uma senha errada.
  }

  if (typeof senha !== 'string' || !isCorrectPassword(senha)) {
    return NextResponse.redirect(new URL('/login?erro=1', request.url), 303)
  }

  const resposta = NextResponse.redirect(new URL('/', request.url), 303)
  resposta.cookies.set(COOKIE_SESSAO, criarTokenSessao(), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: DURACAO_SESSAO_MS / 1000,
  })
  return resposta
}
