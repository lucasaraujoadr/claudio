import { connection } from 'next/server'
import { diasDesde } from '@/lib/oportunidades'
import { carregarOportunidadesDoSnapshot } from '@/lib/oportunidades-snapshot'

export const metadata = { title: 'Oportunidades' }

const DIAS_ATE_DESATUALIZADO = 2

const AVISOS: Record<string, { texto: string; classe: string; role: 'status' | 'alert' }> = {
  criado: { texto: 'Tema criado.', classe: 'border-green-300 bg-green-50 text-green-900', role: 'status' },
  existia: { texto: 'Tema já existia.', classe: 'border-blue-300 bg-blue-50 text-blue-900', role: 'status' },
  erro: {
    texto: 'Não foi possível criar o tema. Verifique o termo e tente novamente.',
    classe: 'border-red-300 bg-red-50 text-red-900',
    role: 'alert',
  },
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export default async function OportunidadesPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const { tema } = await searchParams
  const aviso = typeof tema === 'string' ? AVISOS[tema] : undefined

  const ultimo = await carregarOportunidadesDoSnapshot()
  const oportunidades = ultimo?.todas ?? []
  const dias = ultimo ? diasDesde(ultimo.data) : 0
  const desatualizado = dias > DIAS_ATE_DESATUALIZADO

  return (
    <div className="max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Oportunidades</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          {ultimo
            ? `Dados do Search Console de ${formatarData(ultimo.data)} (janela de 28 dias). Termos nas posições 5 a 20, ordenados pelo ganho estimado.`
            : 'Termos nas posições 5 a 20 do Search Console, ordenados pelo ganho estimado.'}
        </p>
      </header>

      {aviso && (
        <p role={aviso.role} className={`rounded border p-3 text-sm ${aviso.classe}`}>
          {aviso.texto}
        </p>
      )}

      {ultimo && desatualizado && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Atenção: os dados são de {formatarData(ultimo.data)}, há {dias} dias. Não representam a situação atual.
        </p>
      )}

      {!ultimo ? (
        <section className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <h2 className="text-lg font-medium">O Search Console ainda não foi sincronizado</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Ainda não há dados para analisar. Não sabemos quais termos são oportunidades até a primeira sincronização.
          </p>
        </section>
      ) : oportunidades.length === 0 ? (
        <section className="rounded-lg border border-gray-300 p-8 text-center">
          <h2 className="text-lg font-medium">Nenhum termo entre as posições 5 e 20</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            O Search Console foi sincronizado ({formatarData(ultimo.data)}), mas nenhum termo ranqueia nessa faixa.
          </p>
        </section>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-300 text-left">
                <th scope="col" className="py-2 pr-4">Termo</th>
                <th scope="col" className="py-2 pr-4">URL que já ranqueia</th>
                <th scope="col" className="py-2 pr-4 text-right">Impressões</th>
                <th scope="col" className="py-2 pr-4 text-right">Posição</th>
                <th scope="col" className="py-2 pr-4 text-right">CTR</th>
                <th scope="col" className="py-2 pr-4 text-right">Ganho estimado (cliques/28 dias)</th>
                <th scope="col" className="py-2"><span className="sr-only">Ação</span></th>
              </tr>
            </thead>
            <tbody>
              {oportunidades.map((o) => (
                <tr key={`${o.query}|${o.page}`} className="border-b border-gray-200 align-top">
                  <td className="py-2 pr-4 font-medium">{o.query}</td>
                  <td className="max-w-xs break-all py-2 pr-4">
                    <a href={o.page} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                      {o.page}
                    </a>
                  </td>
                  <td className="py-2 pr-4 text-right">{o.impressions.toLocaleString('pt-BR')}</td>
                  <td className="py-2 pr-4 text-right">
                    {o.position.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </td>
                  <td className="py-2 pr-4 text-right">
                    {(o.ctr * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                  </td>
                  <td className="py-2 pr-4 text-right">{Math.round(o.ganho).toLocaleString('pt-BR')}</td>
                  <td className="py-2">
                    {o.coberta ? (
                      <span className="text-gray-600 dark:text-gray-400">Tema já criado</span>
                    ) : (
                      <form method="POST" action="/api/temas/criar-de-query">
                        <input type="hidden" name="query" value={o.query} />
                        <button type="submit" className="rounded border border-gray-400 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800">
                          Criar tema
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
