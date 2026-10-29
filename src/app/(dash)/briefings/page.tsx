import { connection } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { briefingParaMarkdown } from '@/lib/ai/briefing'
import { briefingSchema } from '@/lib/ai/schemas'
import { getDb } from '@/lib/db'
import { briefings, topics } from '@/lib/db/schema'
import { CopiarMarkdown } from './copiar-markdown'

export const metadata = { title: 'Briefings' }

const formatoData = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })

export default async function BriefingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const sp = await searchParams

  const lista = await getDb()
    .select({ id: briefings.id, topicId: briefings.topicId, title: briefings.title, criadoEm: briefings.criadoEm, tema: topics.titulo })
    .from(briefings)
    .innerJoin(topics, eq(briefings.topicId, topics.id))
    .orderBy(desc(briefings.criadoEm), desc(briefings.id))

  if (lista.length === 0) {
    return (
      <div className="max-w-4xl space-y-6">
        <h1 className="text-2xl font-semibold">Briefings</h1>
        <section className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <h2 className="text-lg font-medium">Nenhum briefing gerado ainda</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Escolha um tema em <a href="/temas" className="underline">Temas</a> e use &ldquo;Gerar briefing&rdquo;.
          </p>
        </section>
      </div>
    )
  }

  const pedido = typeof sp.id === 'string' ? Number(sp.id) : NaN
  const doTema = typeof sp.tema === 'string' ? Number(sp.tema) : NaN
  // A lista vem do mais novo para o mais antigo: o primeiro do tema é o mais recente.
  const selecionado =
    lista.find((b) => b.id === pedido) ?? lista.find((b) => b.topicId === doTema) ?? lista[0]
  const [linha] = await getDb().select().from(briefings).where(eq(briefings.id, selecionado.id)).limit(1)
  const parsed = briefingSchema.safeParse({
    title: linha.title,
    metaDescription: linha.metaDescription,
    outline: linha.outline,
    faq: linha.faq,
    linksInternos: linha.linksInternos,
    keywordsSecundarias: linha.keywordsSecundarias,
  })
  const b = parsed.success ? parsed.data : null

  return (
    <div className="max-w-6xl space-y-6">
      <h1 className="text-2xl font-semibold">Briefings</h1>
      {sp.gerado === 'ok' && (
        <p role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          Briefing gerado. O tema agora está como briefado.
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-[18rem_1fr]">
        <nav aria-label="Briefings gerados">
          <ul className="space-y-1">
            {lista.map((i) => (
              <li key={i.id}>
                <a
                  href={`/briefings?id=${i.id}`}
                  aria-current={i.id === selecionado.id ? 'page' : undefined}
                  className={`block rounded border p-2 text-sm ${i.id === selecionado.id ? 'border-gray-900' : 'border-gray-300'}`}
                >
                  <span className="block font-medium">{i.tema}</span>
                  <span className="block text-xs text-gray-600 dark:text-gray-400">{formatoData.format(i.criadoEm)}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {b ? (
          <article className="space-y-5">
            <CopiarMarkdown markdown={briefingParaMarkdown(b)} />
            <header>
              <h2 className="text-xl font-semibold">{b.title}</h2>
              <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{b.metaDescription}</p>
            </header>
            <section>
              <h3 className="font-medium">Estrutura</h3>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {b.outline.map((s, i) => (
                  <li key={i}>
                    {s.h2}
                    {s.h3.length > 0 && (
                      <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300">
                        {s.h3.map((h, j) => <li key={j}>{h}</li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <h3 className="font-medium">FAQ</h3>
              <dl className="mt-1 space-y-2">
                {b.faq.map((f, i) => (
                  <div key={i}>
                    <dt className="font-medium">{f.pergunta}</dt>
                    <dd className="text-sm text-gray-700 dark:text-gray-300">{f.resposta}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3 className="font-medium">Links internos</h3>
              {b.linksInternos.length > 0 ? (
                <ul className="mt-1 list-disc pl-5 text-sm">
                  {b.linksInternos.map((l, i) => (
                    <li key={i}>{l.ancora}: <span className="break-all">{l.url}</span></li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-600 dark:text-gray-400">Nenhum link interno sugerido.</p>
              )}
            </section>
            <section>
              <h3 className="font-medium">Keywords secundárias</h3>
              <p className="text-sm">{b.keywordsSecundarias.join(', ') || 'Nenhuma.'}</p>
            </section>
          </article>
        ) : (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
            Este briefing está em um formato que não pôde ser lido.
          </p>
        )}
      </div>
    </div>
  )
}
