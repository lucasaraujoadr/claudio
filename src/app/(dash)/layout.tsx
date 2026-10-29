import Link from 'next/link'

const MODULOS = [
  { href: '/', rotulo: 'Visão geral' },
  { href: '/auditoria', rotulo: 'Auditoria técnica' },
  { href: '/oportunidades', rotulo: 'Oportunidades' },
  { href: '/temas', rotulo: 'Temas' },
  { href: '/briefings', rotulo: 'Briefings' },
]

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="Módulos"
        className="w-56 shrink-0 border-r border-gray-200 p-4 dark:border-gray-800"
      >
        <p className="mb-4 px-2 text-sm font-semibold">Painel de SEO</p>
        <ul className="space-y-1">
          {MODULOS.map((m) => (
            <li key={m.href}>
              <Link
                href={m.href}
                className="block rounded px-2 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                {m.rotulo}
              </Link>
            </li>
          ))}
        </ul>
        <form method="post" action="/api/logout" className="mt-8 px-2">
          <button type="submit" className="text-sm text-gray-500 hover:underline">
            Sair
          </button>
        </form>
      </nav>
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
