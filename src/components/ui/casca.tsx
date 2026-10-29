'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { AlternarTema } from '@/components/tema/alternar-tema'
import { cx } from './cx'
import { NAVEGACAO, itemAtivo, type GrupoNavegacao } from './navegacao'

export type CascaProps = {
  /** Logo renderizado no servidor (next/image), passado pronto. */
  logo: ReactNode
  /** Logo menor para a barra do celular. */
  logoCompacto: ReactNode
  grupos?: GrupoNavegacao[]
}

function ListaNavegacao({
  grupos,
  pathname,
  aoNavegar,
}: {
  grupos: GrupoNavegacao[]
  pathname: string
  aoNavegar?: () => void
}) {
  const idBase = useId()
  return (
    <div className="space-y-6">
      {grupos.map((g, i) => {
        const idTitulo = `${idBase}-g${i}`
        return (
          <div key={g.titulo ?? i}>
            {g.titulo && (
              <p id={idTitulo} className="mb-1.5 px-3 text-[0.6875rem] font-semibold tracking-[0.16em] text-tinta-suave uppercase">
                {g.titulo}
              </p>
            )}
            <ul aria-labelledby={g.titulo ? idTitulo : undefined} className="space-y-0.5">
              {g.itens.map((item) => {
                if (!item.href) {
                  return (
                    <li key={item.rotulo}>
                      <span
                        aria-disabled="true"
                        className="flex cursor-not-allowed items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-tinta-suave"
                      >
                        <span>{item.rotulo}</span>
                        <span className="rounded-full border border-borda px-1.5 text-[0.625rem] leading-4 font-medium tracking-wide uppercase">
                          em breve
                        </span>
                      </span>
                    </li>
                  )
                }
                const ativo = itemAtivo(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={aoNavegar}
                      aria-current={ativo ? 'page' : undefined}
                      className={cx(
                        'relative flex items-center rounded-md px-3 py-2 text-sm transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-foco',
                        ativo
                          ? 'bg-acento-suave font-semibold text-tinta before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-full before:bg-acento'
                          : 'text-tinta-suave hover:bg-elevada hover:text-tinta',
                      )}
                    >
                      {item.rotulo}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

function Sair({ className }: { className?: string }) {
  return (
    <form method="post" action="/api/logout" className={className}>
      <button
        type="submit"
        className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm text-tinta-suave transition-colors hover:bg-elevada hover:text-tinta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11 13.5 8l-3-3M13.5 8H6" />
        </svg>
        Sair
      </button>
    </form>
  )
}

/**
 * Casca do painel: barra lateral fixa a partir de `lg`; abaixo disso, barra superior
 * com botão de menu que abre a mesma navegação.
 */
export function Casca({ logo, logoCompacto, grupos = NAVEGACAO }: CascaProps) {
  const pathname = usePathname()
  const [aberto, setAberto] = useState(false)
  const idMenu = useId()

  useEffect(() => {
    if (!aberto) return
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAberto(false)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [aberto])

  return (
    <>
      {/* Celular e tablet */}
      <header className="sticky top-0 z-30 border-b border-borda bg-superficie/95 backdrop-blur lg:hidden">
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Link href="/" className="min-w-0 rounded-sm" aria-label="Visão geral — Oliveira Guimarães">
            {logoCompacto}
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <AlternarTema />
            <button
              type="button"
              aria-expanded={aberto}
              aria-controls={idMenu}
              onClick={() => setAberto((a) => !a)}
              className="inline-flex size-9 items-center justify-center rounded-md border border-borda text-tinta transition-colors hover:bg-elevada focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco"
            >
              <span className="sr-only">{aberto ? 'Fechar menu' : 'Abrir menu'}</span>
              <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                {aberto ? <path d="M5 5l10 10M15 5 5 15" /> : <path d="M3 6h14M3 10h14M3 14h14" />}
              </svg>
            </button>
          </div>
        </div>
        <nav
          id={idMenu}
          aria-label="Módulos"
          hidden={!aberto}
          className="max-h-[calc(100dvh-3.5rem)] overflow-y-auto border-t border-borda px-3 pt-4 pb-3"
        >
          <ListaNavegacao grupos={grupos} pathname={pathname} aoNavegar={() => setAberto(false)} />
          <div className="mt-4 border-t border-borda pt-3">
            <Sair />
          </div>
        </nav>
      </header>

      {/* Desktop */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-borda bg-superficie lg:flex">
        <div className="px-6 pt-7 pb-6">
          <Link href="/" className="block rounded-sm" aria-label="Visão geral — Oliveira Guimarães">
            {logo}
          </Link>
          <p className="mt-4 text-[0.6875rem] font-medium tracking-[0.16em] text-tinta-suave uppercase">
            Painel de marketing
          </p>
        </div>
        <nav aria-label="Módulos" className="flex-1 overflow-y-auto px-3 pb-6">
          <ListaNavegacao grupos={grupos} pathname={pathname} />
        </nav>
        <div className="flex items-center justify-between gap-2 border-t border-borda px-3 py-3">
          <Sair />
          <AlternarTema />
        </div>
      </aside>
    </>
  )
}
