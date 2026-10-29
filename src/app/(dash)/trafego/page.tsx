import { connection } from 'next/server'
import { GraficoBarras } from '@/components/graficos/grafico-barras'
import { formatarDataIso, somarDias } from '@/components/graficos/serie'
import { Aviso, CabecalhoPagina, Cartao, CELULA_NUMERICA, EstadoVazio, Selo, Tabela } from '@/components/ui'
import { GraficoSessoes, IndicadoresTrafego, legendaPeriodo } from '../_compartilhado/bloco-trafego'
import { DESCRICAO_CANAL, ROTULO_CANAL, agruparPorCanal, topPaginas } from '../_compartilhado/canais'
import { carregarDiarioGa4, carregarPaginasGa4, carregarSincronizacoesSeguro, carregarTotaisGa4 } from '../_compartilhado/carregar'
import { emailContaServico, estadoFonte, linhaUltimaSincronizacao, ultimaSincronizacaoOk } from '../_compartilhado/sincronizacao'
import { resumirTrafego } from '../_compartilhado/trafego'

export const metadata = { title: 'Tráfego' }

const fmt = (n: number) => n.toLocaleString('pt-BR')
const pct = (f: number) => `${(f * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

type Resultado<T> = { ok: true; dados: T } | { ok: false }

async function carregar<T>(nome: string, fn: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return { ok: true, dados: await fn() }
  } catch (e) {
    console.error(`tráfego: bloco ${nome} falhou:`, e instanceof Error ? e.name : 'erro')
    return { ok: false }
  }
}

function Indisponivel({ oque }: { oque: string }) {
  return (
    <Aviso tipo="erro" titulo={`Não foi possível carregar ${oque} agora`}>
      A consulta ao banco falhou. Isso não significa que não haja dados; tente de novo em instantes.
    </Aviso>
  )
}

export default async function TrafegoPage() {
  await connection()
  const [diario, paginas, sinc, totais] = await Promise.all([
    carregar('série diária', () => carregarDiarioGa4()),
    carregar('páginas', carregarPaginasGa4),
    carregarSincronizacoesSeguro(),
    carregar('totais', carregarTotaisGa4),
  ])
  const registroGa4 = sinc?.ga4
  const estado = estadoFonte(registroGa4)
  const resumo = diario.ok ? resumirTrafego(diario.dados, ultimaSincronizacaoOk(registroGa4)) : null
  const canais = paginas.ok && paginas.dados ? agruparPorCanal(paginas.dados.linhas) : []
  const destinos = paginas.ok && paginas.dados ? topPaginas(paginas.dados.linhas, 10) : []
  const totalSessoesPaginas = canais.reduce((s, c) => s + c.sessoes, 0)
  const periodoPaginas =
    paginas.ok && paginas.dados
      ? `${formatarDataIso(somarDias(paginas.dados.snapshotDate, -28))} a ${formatarDataIso(somarDias(paginas.dados.snapshotDate, -1))}`
      : null
  const pago = canais.find((c) => c.canal === 'pago')

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="Dados"
        titulo="Tráfego"
        subtitulo="Visitas ao site segundo o Google Analytics: volume, engajamento, de onde vêm e onde entram."
        acoes={<p className="text-xs text-tinta-suave">{sinc ? linhaUltimaSincronizacao(registroGa4) : 'Última sincronização: não foi possível ler.'}</p>}
      />

      {estado === 'sem_permissao' && (
        <Aviso tipo="alerta" titulo="O Google Analytics recusou o acesso na última sincronização">
          <p>
            Um administrador da propriedade precisa dar a função Leitor à conta abaixo (Analytics → Administrador →
            Gerenciamento de acesso à propriedade → Adicionar usuário → Leitor). A rotina diária volta a sincronizar
            sozinha depois disso. Os números abaixo são da última sincronização que deu certo.
          </p>
          <p className="mt-2">
            Conta a adicionar:{' '}
            <code className="rounded border border-borda bg-superficie px-1.5 py-0.5 font-mono text-[0.8125rem] break-all text-tinta select-all">
              {emailContaServico()}
            </code>
          </p>
        </Aviso>
      )}
      {estado === 'erro' && (
        <Aviso tipo="erro" titulo="A última sincronização do Google Analytics falhou">
          A rotina diária tenta de novo automaticamente. Os números abaixo são da última sincronização que deu certo.
        </Aviso>
      )}
      {estado === 'nao_configurado' && (
        <Aviso tipo="info" titulo="Google Analytics não conectado neste ambiente">
          As credenciais do Google ou o ID da propriedade não estão configurados aqui.
        </Aviso>
      )}

      {!diario.ok ? (
        <Indisponivel oque="a série diária do Analytics" />
      ) : !resumo ? (
        <EstadoVazio
          titulo="Ainda não há dados do Google Analytics"
          explicacao="Os números aparecem depois da primeira sincronização da rotina diária. Não é zero visita: só não sabemos ainda."
        />
      ) : (
        <>
          <Cartao titulo="Últimos 28 dias" descricao={legendaPeriodo(resumo)}>
            <IndicadoresTrafego resumo={resumo} usuarios={totais.ok ? totais.dados : null} falhaUsuarios={!totais.ok} />
          </Cartao>
          <Cartao titulo="Sessões por dia" descricao="Últimos 90 dias. Passe o ponteiro ou use as setas para ver cada dia.">
            <GraficoSessoes dias={diario.dados} resumo={resumo} />
          </Cartao>
        </>
      )}

      {!paginas.ok ? (
        <Indisponivel oque="as origens e páginas de entrada" />
      ) : !paginas.dados || canais.length === 0 ? (
        <EstadoVazio
          titulo="Ainda não há origens nem páginas de entrada"
          explicacao="A tabela de páginas do Analytics é preenchida pela rotina diária. Não é zero visita: só não sabemos ainda."
        />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
          <Cartao
            titulo="De onde vêm as visitas"
            descricao={`Sessões por canal, ${periodoPaginas}.`}
            rodape={
              pago && pago.participacao >= 0.5
                ? `Tráfego pago responde por ${pct(pago.participacao)} das sessões: os números do site acompanham o investimento em anúncios.`
                : 'Canais agrupados a partir da origem/mídia do Analytics; abra cada um para ver os valores originais.'
            }
          >
            <GraficoBarras
              titulo={`Sessões por canal, ${periodoPaginas}`}
              rotuloCategoria="Canal"
              rotuloValor="Sessões"
              itens={canais.map((c) => ({
                chave: c.canal,
                rotulo: <span className="font-medium text-tinta">{ROTULO_CANAL[c.canal]}</span>,
                rotuloTexto: ROTULO_CANAL[c.canal],
                valor: c.sessoes,
                detalhe: `${pct(c.participacao)} das sessões`,
              }))}
            />
            <ul className="mt-4 divide-y divide-borda border-t border-borda">
              {canais.map((c) => (
                <li key={c.canal}>
                  <details className="group py-2">
                    <summary className="flex cursor-pointer items-center justify-between gap-3 rounded-sm text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span aria-hidden="true" className="text-tinta-suave transition-transform group-open:rotate-90">›</span>
                        <span className="font-medium text-tinta">{ROTULO_CANAL[c.canal]}</span>
                        <span className="truncate text-xs text-tinta-suave">{DESCRICAO_CANAL[c.canal]}</span>
                      </span>
                      <span className="shrink-0 text-xs text-tinta-suave tabular-nums">
                        {c.origens.length} {c.origens.length === 1 ? 'origem' : 'origens'}
                      </span>
                    </summary>
                    <Tabela legenda={`Origens do canal ${ROTULO_CANAL[c.canal]}`} compacta className="mt-2">
                      <thead>
                        <tr>
                          <th scope="col">Origem / mídia (valor do Analytics)</th>
                          <th scope="col" className={CELULA_NUMERICA}>Sessões</th>
                          <th scope="col" className={CELULA_NUMERICA}>Eventos-chave</th>
                        </tr>
                      </thead>
                      <tbody>
                        {c.origens.map((o) => (
                          <tr key={o.origemMidia}>
                            <td className="font-mono text-xs break-all">{o.origemMidia}</td>
                            <td className={CELULA_NUMERICA}>{fmt(o.sessoes)}</td>
                            <td className={CELULA_NUMERICA}>{fmt(o.eventosChave)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </Tabela>
                  </details>
                </li>
              ))}
            </ul>
          </Cartao>

          <Cartao
            titulo="Páginas de entrada"
            descricao={`As 10 com mais sessões, ${periodoPaginas}. Total: ${fmt(totalSessoesPaginas)} sessões.`}
            semPreenchimento
          >
            <Tabela legenda={`Páginas de entrada com mais sessões, ${periodoPaginas}`} className="rounded-none rounded-b-xl border-x-0 border-b-0">
              <thead>
                <tr>
                  <th scope="col">Página</th>
                  <th scope="col" className={CELULA_NUMERICA}>Sessões</th>
                  <th scope="col" className={CELULA_NUMERICA}>Participação</th>
                  <th scope="col">Canal principal</th>
                  <th scope="col" className={CELULA_NUMERICA}>Eventos-chave</th>
                </tr>
              </thead>
              <tbody>
                {destinos.map((p) => (
                  <tr key={p.pagina}>
                    <td className="max-w-[18rem] truncate font-medium text-tinta" title={p.pagina}>
                      {p.pagina === '(not set)' ? <span className="text-tinta-suave">(não identificada)</span> : p.pagina}
                    </td>
                    <td className={CELULA_NUMERICA}>{fmt(p.sessoes)}</td>
                    <td className={CELULA_NUMERICA}>{pct(p.participacao)}</td>
                    <td>
                      <span title={`${pct(p.participacaoCanalPrincipal)} das sessões desta página`}>
                        <Selo variante={p.canalPrincipal === 'pago' ? 'acento' : 'neutro'}>{ROTULO_CANAL[p.canalPrincipal]}</Selo>
                        <span className="ml-1.5 text-xs text-tinta-suave tabular-nums">{pct(p.participacaoCanalPrincipal)}</span>
                      </span>
                    </td>
                    <td className={CELULA_NUMERICA}>{fmt(p.eventosChave)}</td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </Cartao>
        </div>
      )}
    </div>
  )
}
