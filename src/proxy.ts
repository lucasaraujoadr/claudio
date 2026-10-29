import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_SESSAO, tokenSessaoValido } from '@/lib/auth'

const ROTAS_LIVRES = ['/login', '/api/login']

function estaLiberada(pathname: string): boolean {
  return (
    ROTAS_LIVRES.includes(pathname) ||
    pathname === '/api/cron' ||
    pathname.startsWith('/api/cron/') ||
    // Webhooks (Brevo, formulário do site): quem chama não tem cookie; cada rota exige token.
    pathname === '/api/webhooks' ||
    pathname.startsWith('/api/webhooks/') ||
    // Descadastro público e checagem de acesso: quem chama não tem cookie; o token vai na URL.
    pathname === '/descadastro' ||
    pathname.startsWith('/api/publico/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  )
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl
  if (estaLiberada(pathname)) return NextResponse.next()

  if (tokenSessaoValido(request.cookies.get(COOKIE_SESSAO)?.value)) {
    return NextResponse.next()
  }
  return NextResponse.redirect(new URL('/login', request.url))
}
