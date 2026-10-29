import { connection } from 'next/server'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { auditIssues, auditPages, auditRuns } from '@/lib/db/schema'
import { REGRA_INTERROMPIDO, runTravada } from '@/lib/auditoria'
import { GraficoBarras } from '@/components/graficos/grafico-barras'
import { Aviso, CabecalhoPagina, Cartao, EstadoVazio, Indicador, SELO_SEVERIDADE, Selo, Tabela } from '@/components/ui'
import { BotaoRastrear } from './botao-rastrear'

export const metadata = { title: 'Auditoria técnica' }

type Severidade = 'critico' | 'aviso' | 'info'

const SEVERIDADES: { chave: Severidade; titulo: string }[] = [
  { chave: 'critico', titulo: 'Críticos' },
  { chave: 'aviso', titulo: 'Avisos' },
  { chave: 'info', titulo: 'Informativos' },
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

  // Uma run `rodando` velha demais morreu sem registrar o fim: não pode esconder o botão
  // para sempre. A rota a marca como `falhou` ao iniciar o próximo rastreamento.
  const travada = ultimaRun ? runTravada(ultimaRun, new Date()) : false
  const rodando = ultimaRun?.status === 'rodando' && !travada
  const interrompido = problemas.find((p) => p.regra === REGRA_INTERROMPIDO)
  const ultimaFalhou = ultimaRun?.status === 'falhou'

  const contagem = Object.fromEntries(
    SEVERIDADES.map(({ chave }) => [chave, problemas.filter((p) => p.severidade === chave).length]),
  ) as Record<Severidade, number>

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="SEO"
        titulo="Auditoria técnica"
        subtitulo={
          ultimaConcluida
            ? `Último rastreamento concluído em ${formatoData.format(ultimaConcluida.finalizadoEm ?? ultimaConcluida.iniciadoEm)} · ${ultimaConcluida.paginasRastreadas} páginas rastreadas`
            : 'Nenhum rastreamento concluído até agora.'
        }
        acoes={!rodando && <BotaoRastrear rotulo="Rastrear agora" />}
      />

      {rodando && (
        <Aviso tipo="info" role="status">
          Há um rastreamento em andamento desde {formatoData.format(ultimaRun.iniciadoEm)}. Atualize a
          página em alguns minutos.
        </Aviso>
      )}
      {travada && (
        <Aviso tipo="alerta" role="alert">
          O último rastreamento ({formatoData.format(ultimaRun.iniciadoEm)}) parece ter travado. Você pode
          iniciar outro.
        </Aviso>
      )}
      {interrompido && (
        <Aviso tipo="alerta" role="alert">
          {interrompido.mensagem}.
        </Aviso>
      )}
      {ultimaFalhou && (
        <Aviso tipo="erro" role="alert">
          O último rastreamento ({formatoData.format(ultimaRun.iniciadoEm)}) falhou.
          {ultimaConcluida ? ' Os resultados abaixo são do rastreamento anterior.' : ''}
        </Aviso>
      )}

      {!ultimaConcluida ? (
        <EstadoVazio
          titulo="O site ainda não foi rastreado"
          explicacao={<>Não sabemos se há problemas. Clique em &ldquo;Rastrear agora&rdquo; para fazer a primeira auditoria.</>}
        />
      ) : problemas.length === 0 ? (
        <Aviso tipo="sucesso" titulo="Nenhum problema encontrado" role="status">
          O rastreamento analisou {ultimaConcluida.paginasRastreadas} páginas e nenhuma regra foi violada.
        </Aviso>
      ) : (
        <>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <Cartao titulo="Resumo">
              <div className="grid grid-cols-2 gap-x-6 gap-y-5">
                <Indicador rotulo="Páginas rastreadas" valor={ultimaConcluida.paginasRastreadas} />
                <Indicador rotulo="Problemas encontrados" valor={problemas.length} />
                <Indicador rotulo="Críticos" valor={contagem.critico} />
                <Indicador rotulo="Avisos" valor={contagem.aviso} />
              </div>
            </Cartao>
            <Cartao titulo="Problemas por severidade" descricao="Último rastreamento concluído. Cada barra é uma contagem; a severidade está no rótulo.">
              <GraficoBarras
                titulo="Problemas por severidade no último rastreamento concluído"
                rotuloCategoria="Severidade"
                rotuloValor="Problemas"
                itens={SEVERIDADES.map(({ chave, titulo }) => ({
                  chave,
                  rotulo: <Selo variante={SELO_SEVERIDADE[chave].variante}>{titulo}</Selo>,
                  rotuloTexto: titulo,
                  valor: contagem[chave],
                  detalhe: `${((contagem[chave] / problemas.length) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% dos problemas`,
                }))}
              />
            </Cartao>
          </div>

          {SEVERIDADES.map(({ chave, titulo }) => {
            const doGrupo = problemas.filter((p) => p.severidade === chave)
            return (
              <section key={chave} aria-labelledby={`sev-${chave}`} className="space-y-3">
                <h2 id={`sev-${chave}`} className="flex items-center gap-3 font-titulo text-xl font-semibold text-tinta">
                  {titulo} ({doGrupo.length})
                  <Selo variante={SELO_SEVERIDADE[chave].variante}>{SELO_SEVERIDADE[chave].rotulo}</Selo>
                </h2>
                {doGrupo.length === 0 ? (
                  <p className="text-sm text-tinta-suave">Nenhum problema nesta categoria.</p>
                ) : (
                  <Tabela legenda={`Problemas: ${titulo.toLowerCase()}`} compacta>
                    <thead>
                      <tr>
                        <th scope="col">Regra</th>
                        <th scope="col">Problema</th>
                        <th scope="col">Página</th>
                      </tr>
                    </thead>
                    <tbody>
                      {doGrupo.map((p) => (
                        <tr key={p.id}>
                          <td className="font-mono text-xs whitespace-nowrap text-tinta-suave">{p.regra}</td>
                          <td className="min-w-[16rem] text-tinta">{p.mensagem}</td>
                          <td className="max-w-[20rem] text-xs break-all text-tinta-suave">{p.url ?? 'Site inteiro'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabela>
                )}
              </section>
            )
          })}
        </>
      )}
    </div>
  )
}
