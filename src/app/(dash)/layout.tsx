import { Casca } from '@/components/ui/casca'
import { Logo } from '@/components/ui/logo'

export default function DashLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a
        href="#conteudo"
        className="sr-only z-50 rounded-md bg-acento px-3 py-2 text-sm font-medium text-sobre-acento focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Pular para o conteúdo
      </a>
      <Casca logo={<Logo largura={200} />} logoCompacto={<Logo largura={148} />} />
      <main id="conteudo" tabIndex={-1} className="min-w-0 px-4 py-6 outline-none sm:px-6 lg:px-10 lg:py-10">
        {children}
      </main>
    </div>
  )
}
