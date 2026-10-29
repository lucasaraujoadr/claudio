import { AlternarTema } from '@/components/tema/alternar-tema'
import { classesBotao } from '@/components/ui/botao'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import { IconeTom } from '@/components/ui/icones'
import { Logo } from '@/components/ui/logo'

export const metadata = { title: 'Entrar' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>
}) {
  const { erro } = await searchParams

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-12">
      {/* Halo dourado discreto atrás do cartão. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(60%_100%_at_50%_0%,var(--og-acento-suave),transparent)]"
      />
      <div className="absolute top-4 right-4">
        <AlternarTema />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="mb-10 flex justify-center">
          <Logo largura={280} prioridade className="max-w-full" />
        </div>

        <form
          method="post"
          action="/api/login"
          aria-labelledby="titulo-login"
          className="space-y-5 rounded-xl border border-borda bg-superficie p-6 shadow-cartao sm:p-8"
        >
          <div>
            <h1 id="titulo-login" className="font-titulo text-2xl font-semibold text-tinta">
              Painel de marketing
            </h1>
            <p className="mt-1 text-sm text-tinta-suave">Acesso restrito à equipe.</p>
          </div>

          <div className="space-y-1.5">
            <label className={CLASSES_ROTULO} htmlFor="senha">
              Senha
            </label>
            <input
              id="senha"
              name="senha"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              aria-invalid={erro ? true : undefined}
              aria-describedby={erro ? 'erro-senha' : undefined}
              className={classesCampo('h-11')}
            />
            {erro && (
              <p id="erro-senha" role="alert" className="flex items-center gap-1.5 pt-1 text-sm text-critico">
                <IconeTom tom="critico" className="size-4 shrink-0" />
                Senha incorreta. Tente novamente.
              </p>
            )}
          </div>

          <button type="submit" className={classesBotao('primario', 'md', 'h-11 w-full')}>
            Entrar
          </button>
        </form>

        <p className="mt-8 text-center text-xs text-tinta-suave">
          Oliveira Guimarães · cálculos e perícias
        </p>
      </div>
    </main>
  )
}
