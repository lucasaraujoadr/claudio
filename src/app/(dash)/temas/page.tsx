import { connection } from 'next/server'
import { asc, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { clusters, topics, type Topic } from '@/lib/db/schema'

export const metadata = { title: 'Temas' }

type Aviso = { texto: string; classe: string; role: 'status' | 'alert' }
const VERDE = 'border-green-300 bg-green-50 text-green-900'
const AZUL = 'border-blue-300 bg-blue-50 text-blue-900'
const VERMELHO = 'border-red-300 bg-red-50 text-red-900'

const AVISOS: Record<string, Record<string, Aviso>> = {
  pesquisa: {
    ok: { texto: 'Pesquisa concluída. Novos clusters e temas foram adicionados.', classe: VERDE, role: 'status' },
    vazio: { texto: 'A pesquisa não trouxe temas novos: todos já existiam.', classe: AZUL, role: 'status' },
    'sem-chave': { texto: 'OPENAI_API_KEY não configurada. Defina a chave nas variáveis de ambiente para pesquisar temas.', classe: VERMELHO, role: 'alert' },
    erro: { texto: 'Não foi possível pesquisar temas. Nada foi gravado; tente novamente.', classe: VERMELHO, role: 'alert' },
  },
  status: {
    escolhido: { texto: 'Tema marcado como escolhido.', classe: VERDE, role: 'status' },
    publicado: { texto: 'Tema marcado como publicado.', classe: VERDE, role: 'status' },
    'url-invalida': { texto: 'URL inválida. Informe uma URL https://ogpericiacontabil.com.br/...', classe: VERMELHO, role: 'alert' },
    erro: { texto: 'Não foi possível mudar o status do tema.', classe: VERMELHO, role: 'alert' },
  },
}

const STATUS = ['ideia', 'escolhido', 'briefado', 'publicado'] as const
type Status = (typeof STATUS)[number]
const ROTULO_STATUS: Record<Status, string> = { ideia: 'Ideia', escolhido: 'Escolhido', briefado: 'Briefado', publicado: 'Publicado' }
const ROTULO_INTENCAO: Record<string, string> = {
  informacional: 'Informacional', comercial: 'Comercial', transacional: 'Transacional', navegacional: 'Navegacional',
}
const ROTULO_PRIORIDADE: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }

function ehStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUS as readonly string[]).includes(v)
}

function Acao({ t }: { t: Topic }) {
  if (t.status === 'ideia') {
    return (
      <form method="POST" action="/api/temas/status">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="para" value="escolhido" />
        <button type="submit" className="rounded border border-gray-400 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          Escolher
        </button>
      </form>
    )
  }
  if (t.status === 'briefado') {
    return (
      <form method="POST" action="/api/temas/status" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="para" value="publicado" />
        <label className="sr-only" htmlFor={`url-${t.id}`}>URL publicada</label>
        <input
          id={`url-${t.id}`}
          name="url"
          type="url"
          required
          pattern="https://ogpericiacontabil\.com\.br/.*"
          placeholder="https://ogpericiacontabil.com.br/..."
          className="w-64 rounded border border-gray-400 px-2 py-1"
        />
        <button type="submit" className="rounded border border-gray-400 px-2 py-1 hover:bg-gray-100 dark:hover:bg-gray-800">
          Marcar como publicado
        </button>
      </form>
    )
  }
  if (t.status === 'publicado' && t.urlPublicada) {
    return (
      <a href={t.urlPublicada} target="_blank" rel="noopener noreferrer" className="break-all text-blue-700 underline">
        Ver página
      </a>
    )
  }
  return null
}

function ListaTemas({ itens }: { itens: Topic[] }) {
  return (
    <ul className="divide-y divide-gray-200">
      {itens.map((t) => (
        <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 py-2">
          <div className="min-w-0">
            <p className="font-medium">{t.titulo}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t.keyword} · {ROTULO_INTENCAO[t.intencao]} · Prioridade {ROTULO_PRIORIDADE[t.prioridade].toLowerCase()} ·{' '}
              {ROTULO_STATUS[t.status]}
            </p>
          </div>
          <Acao t={t} />
        </li>
      ))}
    </ul>
  )
}

export default async function TemasPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const sp = await searchParams
  const aviso =
    typeof sp.pesquisa === 'string'
      ? AVISOS.pesquisa[sp.pesquisa]
      : typeof sp.status === 'string'
        ? AVISOS.status[sp.status]
        : undefined
  const filtro = ehStatus(sp.filtro) ? sp.filtro : undefined

  const db = getDb()
  const todosClusters = await db.select().from(clusters).orderBy(desc(clusters.criadoEm), asc(clusters.id))
  const todosTemas = await db.select().from(topics).orderBy(asc(topics.id))
  const visiveis = filtro ? todosTemas.filter((t) => t.status === filtro) : todosTemas

  const grupos = todosClusters
    .map((c) => ({ cluster: c, itens: visiveis.filter((t) => t.clusterId === c.id) }))
    .filter((g) => g.itens.length > 0)
  const semCluster = visiveis.filter((t) => t.clusterId === null)

  return (
    <div className="max-w-6xl space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Temas</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Clusters de conteúdo e temas, do primeiro rascunho até a publicação.
          </p>
        </div>
        <form method="POST" action="/api/temas/pesquisar" className="text-right">
          <button type="submit" className="rounded border border-gray-400 px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-800">
            Pesquisar temas
          </button>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">A pesquisa leva alguns segundos.</p>
        </form>
      </header>

      {aviso && (
        <p role={aviso.role} className={`rounded border p-3 text-sm ${aviso.classe}`}>
          {aviso.texto}
        </p>
      )}

      {todosTemas.length === 0 ? (
        <section className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <h2 className="text-lg font-medium">Nenhum tema ainda</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Use &ldquo;Pesquisar temas&rdquo; para gerar clusters com IA ou crie temas a partir das oportunidades.
          </p>
        </section>
      ) : (
        <>
          <nav aria-label="Filtro por status" className="flex flex-wrap gap-2 text-sm">
            <a href="/temas" aria-current={!filtro ? 'page' : undefined} className={`rounded border px-2 py-1 ${!filtro ? 'border-gray-900 font-semibold' : 'border-gray-300'}`}>
              Todos
            </a>
            {STATUS.map((s) => (
              <a key={s} href={`/temas?filtro=${s}`} aria-current={filtro === s ? 'page' : undefined} className={`rounded border px-2 py-1 ${filtro === s ? 'border-gray-900 font-semibold' : 'border-gray-300'}`}>
                {ROTULO_STATUS[s]}
              </a>
            ))}
          </nav>

          {visiveis.length === 0 ? (
            <section className="rounded-lg border border-gray-300 p-8 text-center">
              <h2 className="text-lg font-medium">Nenhum tema com esse status</h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">Escolha outro filtro para ver os demais temas.</p>
            </section>
          ) : (
            <div className="space-y-6">
              {grupos.map(({ cluster, itens }) => (
                <section key={cluster.id} className="rounded-lg border border-gray-300 p-4">
                  <h2 className="text-lg font-medium">{cluster.nome}</h2>
                  <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">
                    Pilar: {cluster.keywordPilar} · {ROTULO_INTENCAO[cluster.intencao]} · Prioridade{' '}
                    {ROTULO_PRIORIDADE[cluster.prioridade].toLowerCase()}
                  </p>
                  <ListaTemas itens={itens} />
                </section>
              ))}
              {semCluster.length > 0 && (
                <section className="rounded-lg border border-gray-300 p-4">
                  <h2 className="text-lg font-medium">Sem cluster</h2>
                  <p className="mb-2 text-sm text-gray-600 dark:text-gray-400">Temas criados a partir de oportunidades do Search Console.</p>
                  <ListaTemas itens={semCluster} />
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
