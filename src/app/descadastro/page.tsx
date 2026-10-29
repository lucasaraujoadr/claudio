import { classesBotao } from '@/components/ui/botao'
import { Logo } from '@/components/ui/logo'
import { lerTokenDescadastro } from '@/lib/descadastro'

export const metadata = { title: 'Descadastro', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

// GET só mostra o texto: quem descadastra é o POST do botão (leitores de link de antivírus abrem URLs).
export default async function DescadastroPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const { t } = await searchParams
  const token = typeof t === 'string' ? t : ''
  const valido = token !== '' && lerTokenDescadastro(token, new Date()) !== null

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex justify-center">
          <Logo largura={240} className="max-w-full" />
        </div>
        <div className="space-y-5 rounded-xl border border-borda bg-superficie p-6 shadow-cartao sm:p-8">
          {valido ? (
            <form method="post" action={`/api/publico/descadastro?t=${encodeURIComponent(token)}`} className="space-y-5">
              <div>
                <h1 className="font-titulo text-2xl font-semibold text-tinta">Descadastrar</h1>
                <p className="mt-2 text-sm text-tinta-suave">
                  Confirme para deixar de receber nossos emails. Se foi um engano, é só fechar esta página.
                </p>
              </div>
              <button type="submit" className={classesBotao('primario', 'md', 'h-11 w-full')}>
                Confirmar descadastro
              </button>
            </form>
          ) : (
            <div>
              <h1 className="font-titulo text-2xl font-semibold text-tinta">Link inválido ou expirado</h1>
              <p className="mt-2 text-sm text-tinta-suave">
                Este link de descadastro não é válido ou já expirou. Use o link do email mais recente.
              </p>
            </div>
          )}
        </div>
        <p className="mt-8 text-center text-xs text-tinta-suave">Oliveira Guimarães · cálculos e perícias</p>
      </div>
    </main>
  )
}
