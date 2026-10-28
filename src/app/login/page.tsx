export const metadata = { title: 'Entrar' }

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string }>
}) {
  const { erro } = await searchParams

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <form
        method="post"
        action="/api/login"
        className="w-full max-w-sm space-y-4 rounded-lg border border-gray-200 p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold">Painel de SEO</h1>
        <label className="block text-sm font-medium" htmlFor="senha">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          required
          autoFocus
          autoComplete="current-password"
          className="w-full rounded border border-gray-300 px-3 py-2"
        />
        {erro && (
          <p role="alert" className="text-sm text-red-600">
            Senha incorreta. Tente novamente.
          </p>
        )}
        <button
          type="submit"
          className="w-full rounded bg-black px-3 py-2 text-white hover:bg-gray-800"
        >
          Entrar
        </button>
      </form>
    </main>
  )
}
