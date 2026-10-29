import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans, Source_Serif_4 } from 'next/font/google'
import { cookies } from 'next/headers'
import { NOME_COOKIE_TEMA, SCRIPT_TEMA, normalizarTema } from '@/components/tema/tema'
import './globals.css'

// Texto e números: humanista técnica, muito legível em tamanhos pequenos, com algarismos
// tabulares (usados nas tabelas).
const plexSans = IBM_Plex_Sans({
  variable: '--font-plex-sans',
  subsets: ['latin', 'latin-ext'],
  display: 'swap',
})

// Títulos: serifa de texto com eixo óptico — sóbria, de escritório técnico.
const sourceSerif = Source_Serif_4({
  variable: '--font-source-serif',
  subsets: ['latin', 'latin-ext'],
  axes: ['opsz'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Painel de marketing', template: '%s · Oliveira Guimarães' },
  description: 'Painel interno de marketing — Oliveira Guimarães, cálculos e perícias',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f5f3ee' },
    { media: '(prefers-color-scheme: dark)', color: '#0e0f11' },
  ],
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  // Com cookie, o servidor já entrega o tema certo; sem cookie, o script do <head>
  // decide (localStorage → sistema) antes da primeira pintura.
  const tema = normalizarTema((await cookies()).get(NOME_COOKIE_TEMA)?.value)

  return (
    <html
      lang="pt-BR"
      data-theme={tema ?? undefined}
      // O script pode acrescentar data-theme antes da hidratação quando não há cookie.
      suppressHydrationWarning
      className={`${plexSans.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body className="flex min-h-full flex-col bg-fundo font-sans text-tinta">{children}</body>
    </html>
  )
}
