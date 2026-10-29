import { connection } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { auditIssues, auditPages, auditRuns } from '@/lib/db/schema'
import { BotaoRastrear } from './botao-rastrear'

export const metadata = { title: 'Auditoria técnica' }

type Severidade = 'critico' | 'aviso' | 'info'

const SEVERIDADES: { chave: Severidade; titulo: string; classe: string }[] = [
  { chave: 'critico', titulo: 'Críticos', classe: 'border-red-300 bg-red-50 text-red-900' },
  { chave: 'aviso', titulo: 'Avisos', classe: 'border-amber-300 bg-amber-50 text-amber-900' },
  { chave: 'info', titulo: 'Informativos', classe: 'border-blue-300 bg-blue-50 text-blue-900' },
]

const formatoData = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export default async function AuditoriaPage() {
  await connection()
  const db = getDb()

  const [ultimaRun] = await db.select().from(auditRuns).orderBy(desc(auditRuns.id)).limit(1)
  const [ultimaConcluida] = await db
    .select()
    .from(auditRuns)
    .where(eq(auditRuns.status, 'concluido'))
    .orderBy(desc(auditRuns.id))
    .limit(1)

  const problemas = ultimaConcluida
    ? await db
        .select({
          id: auditIssues.id,
          severidade: auditIssues.severidade,
          regra: auditIssues.regra,
          mensagem: auditIssues.mensagem,
          url: auditPages.url,
        })
        .from(auditIssues)
        .leftJoin(auditPages, eq(auditIssues.pageId, auditPages.id))
        .where(eq(auditIssues.runId, ultimaConcluida.id))
        .orderBy(auditIssues.regra, auditPages.url)
    : []

  const rodando = ultimaRun?.status === 'rodando'
  const interrompido = problemas.find((p) => p.regra === 'rastreamento-interrompido')
  const ultimaFalhou = ultimaRun?.status === 'falhou'

  return (
    <div className="max-w-4xl space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Auditoria técnica</h1>
          {ultimaConcluida ? (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Último rastreamento concluído em {formatoData.format(ultimaConcluida.finalizadoEm ?? ultimaConcluida.iniciadoEm)} ·{' '}
              {ultimaConcluida.paginasRastreadas} páginas rastreadas
            </p>
          ) : (
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Nenhum rastreamento concluído até agora.
            </p>
          )}
        </div>
        {!rodando && <BotaoRastrear rotulo="Rastrear agora" />}
      </header>

      {rodando && (
        <p role="status" className="rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">
          Há um rastreamento em andamento desde {formatoData.format(ultimaRun.iniciadoEm)}. Atualize a
          página em alguns minutos.
        </p>
      )}
      {interrompido && (
        <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {interrompido.mensagem}.
        </p>
      )}
      {ultimaFalhou && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          O último rastreamento ({formatoData.format(ultimaRun.iniciadoEm)}) falhou.
          {ultimaConcluida ? ' Os resultados abaixo são do rastreamento anterior.' : ''}
        </p>
      )}

      {!ultimaConcluida ? (
        <section className="rounded-lg border border-dashed border-gray-300 p-8 text-center">
          <h2 className="text-lg font-medium">O site ainda não foi rastreado</h2>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            Não sabemos se há problemas. Clique em &ldquo;Rastrear agora&rdquo; para fazer a primeira auditoria.
          </p>
        </section>
      ) : problemas.length === 0 ? (
        <section className="rounded-lg border border-green-300 bg-green-50 p-8 text-center text-green-900">
          <h2 className="text-lg font-medium">Nenhum problema encontrado</h2>
          <p className="mt-1 text-sm">
            O rastreamento analisou {ultimaConcluida.paginasRastreadas} páginas e nenhuma regra foi violada.
          </p>
        </section>
      ) : (
        SEVERIDADES.map(({ chave, titulo, classe }) => {
          const doGrupo = problemas.filter((p) => p.severidade === chave)
          return (
            <section key={chave} aria-labelledby={`sev-${chave}`}>
              <h2 id={`sev-${chave}`} className="mb-2 text-lg font-semibold">
                {titulo} ({doGrupo.length})
              </h2>
              {doGrupo.length === 0 ? (
                <p className="text-sm text-gray-600 dark:text-gray-400">Nenhum problema nesta categoria.</p>
              ) : (
                <ul className="space-y-2">
                  {doGrupo.map((p) => (
                    <li key={p.id} className={`rounded border p-3 text-sm ${classe}`}>
                      <span className="font-mono text-xs opacity-70">{p.regra}</span>
                      <p>{p.mensagem}</p>
                      <p className="break-all text-xs opacity-70">{p.url ?? 'Site inteiro'}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
