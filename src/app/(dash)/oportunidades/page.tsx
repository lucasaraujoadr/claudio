import { connection } from 'next/server'
import { diasDesde } from '@/lib/oportunidades'
import { carregarOportunidadesDoSnapshot } from '@/lib/oportunidades-snapshot'
import { Aviso, CabecalhoPagina, Cartao, CELULA_NUMERICA, EstadoVazio, Selo, Tabela, classesBotao, type TipoAviso } from '@/components/ui'
import { AvisoSearchConsole } from '../_compartilhado/aviso-search-console'
import { carregarSincronizacoesSeguro, carregarTotaisGsc } from '../_compartilhado/carregar'
import { GraficosSearchConsole } from '../_compartilhado/graficos-search-console'
import { seriesSearchConsole } from '../_compartilhado/search-console'
import { emailContaServico, explicarSearchConsole } from '../_compartilhado/sincronizacao'

export const metadata = { title: 'Oportunidades' }

const DIAS_ATE_DESATUALIZADO = 2

const AVISOS: Record<string, { texto: string; tipo: TipoAviso; role: 'status' | 'alert' }> = {
  criado: { texto: 'Tema criado.', tipo: 'sucesso', role: 'status' },
  existia: { texto: 'Tema já existia.', tipo: 'info', role: 'status' },
  erro: {
    texto: 'Não foi possível criar o tema. Verifique o termo e tente novamente.',
    tipo: 'erro',
    role: 'alert',
  },
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

/** Totais por dia para o gráfico; `undefined` se a leitura falhar (não derruba a página). */
async function carregarSeriesGsc() {
  try {
    return seriesSearchConsole(await carregarTotaisGsc())
  } catch (e) {
    console.error('oportunidades: totais do gsc falharam:', e instanceof Error ? e.name : 'erro')
    return undefined
  }
}

export default async function OportunidadesPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const { tema } = await searchParams
  const aviso = typeof tema === 'string' ? AVISOS[tema] : undefined

  const [ultimo, sinc, series] = await Promise.all([
    carregarOportunidadesDoSnapshot(),
    carregarSincronizacoesSeguro(),
    carregarSeriesGsc(),
  ])
  const oportunidades = ultimo?.todas ?? []
  const dias = ultimo ? diasDesde(ultimo.data) : 0
  const desatualizado = dias > DIAS_ATE_DESATUALIZADO
  const explicacao = sinc ? explicarSearchConsole(sinc.gsc, ultimo !== null, emailContaServico()) : null

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="SEO"
        titulo="Oportunidades"
        subtitulo={
          ultimo
            ? `Dados do Search Console de ${formatarData(ultimo.data)} (janela de 28 dias). Termos nas posições 5 a 20, ordenados pelo ganho estimado.`
            : 'Termos nas posições 5 a 20 do Search Console, ordenados pelo ganho estimado.'
        }
      />

      {aviso && (
        <Aviso tipo={aviso.tipo} role={aviso.role}>
          {aviso.texto}
        </Aviso>
      )}

      {explicacao && <AvisoSearchConsole explicacao={explicacao} />}

      {ultimo && desatualizado && (
        <Aviso tipo="alerta" role="alert">
          Atenção: os dados são de {formatarData(ultimo.data)}, há {dias} dias. Não representam a situação atual.
        </Aviso>
      )}

      <Cartao titulo="Cliques e impressões por dia" descricao="Search Console, total da janela de 28 dias a cada sincronização.">
        <GraficosSearchConsole series={series} explicacao={ultimo ? null : explicacao} />
      </Cartao>

      {!ultimo ? (
        <EstadoVazio
          titulo="O Search Console ainda não foi sincronizado"
          explicacao={
            explicacao?.tipo === 'alerta'
              ? 'Falta liberar o acesso da conta de serviço no Search Console (veja o aviso acima). Até lá, não sabemos quais termos são oportunidades.'
              : 'Ainda não há dados para analisar. Não sabemos quais termos são oportunidades até a primeira sincronização.'
          }
        />
      ) : oportunidades.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum termo entre as posições 5 e 20"
          explicacao={`O Search Console foi sincronizado (${formatarData(ultimo.data)}), mas nenhum termo ranqueia nessa faixa.`}
        />
      ) : (
        <Tabela legenda="Oportunidades: termos nas posições 5 a 20, pelo ganho estimado">
          <thead>
            <tr>
              <th scope="col">Termo</th>
              <th scope="col">URL que já ranqueia</th>
              <th scope="col" className={CELULA_NUMERICA}>Impressões</th>
              <th scope="col" className={CELULA_NUMERICA}>Posição</th>
              <th scope="col" className={CELULA_NUMERICA}>CTR</th>
              <th scope="col" className={CELULA_NUMERICA}>Ganho estimado (cliques/28 dias)</th>
              <th scope="col"><span className="sr-only">Ação</span></th>
            </tr>
          </thead>
          <tbody>
            {oportunidades.map((o) => (
              <tr key={`${o.query}|${o.page}`}>
                <td className="font-medium text-tinta">{o.query}</td>
                <td className="max-w-xs break-all">
                  <a href={o.page} target="_blank" rel="noopener noreferrer" className="text-acento-texto underline-offset-2 hover:underline">
                    {o.page}
                  </a>
                </td>
                <td className={CELULA_NUMERICA}>{o.impressions.toLocaleString('pt-BR')}</td>
                <td className={CELULA_NUMERICA}>
                  {o.position.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                </td>
                <td className={CELULA_NUMERICA}>
                  {(o.ctr * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                </td>
                <td className={`${CELULA_NUMERICA} font-semibold text-tinta`}>{Math.round(o.ganho).toLocaleString('pt-BR')}</td>
                <td>
                  {o.coberta ? (
                    <Selo variante="neutro">Tema já criado</Selo>
                  ) : (
                    <form method="POST" action="/api/temas/criar-de-query">
                      <input type="hidden" name="query" value={o.query} />
                      <button type="submit" className={classesBotao('secundario', 'sm')}>
                        Criar tema
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </div>
  )
}
