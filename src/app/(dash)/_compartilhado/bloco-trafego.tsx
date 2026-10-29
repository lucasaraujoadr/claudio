import { GraficoLinha } from '@/components/graficos/grafico-linha'
import { GraficoSemDado } from '@/components/graficos/grafico-sem-dado'
import { contarComDado, formatarDataIso } from '@/components/graficos/serie'
import { Indicador } from '@/components/ui/indicador'
import {
  METRICAS_GA4,
  indicadorUsuarios,
  semEventosChave,
  serieTrafego,
  type DiaGa4,
  type ResumoTrafego,
  type TotaisUsuariosGa4,
} from './trafego'

function periodo(j: { inicio: string; fim: string }): string {
  return `${formatarDataIso(j.inicio)} a ${formatarDataIso(j.fim)}`
}

/**
 * Os quatro números dos últimos 28 dias com variação contra os 28 anteriores. Sessões,
 * sessões engajadas e eventos-chave somam a série diária; usuários vêm só dos totais
 * deduplicados (`usuarios`): sem eles, "sem dado", nunca a soma diária.
 */
export function IndicadoresTrafego({
  resumo,
  usuarios,
  falhaUsuarios = false,
}: {
  resumo: ResumoTrafego
  usuarios: TotaisUsuariosGa4 | null
  /** A leitura dos totais falhou (diferente de "ainda não há linha"). */
  falhaUsuarios?: boolean
}) {
  const comparacao = resumo.comparacao
  const u = indicadorUsuarios(usuarios)
  const indicador = (m: (typeof METRICAS_GA4)[number]) => (
    <Indicador
      key={m.chave}
      rotulo={m.rotulo}
      valor={resumo.totais[m.chave]}
      variacao={comparacao ? comparacao.variacoes[m.chave] : null}
      comparacao={comparacao ? 'vs. 28 dias antes' : undefined}
      detalhe={
        m.chave === 'eventosChave' && semEventosChave(resumo)
          ? 'Nenhum evento-chave no período: parece que nenhum evento está marcado como chave no GA4 (ex.: clique no WhatsApp, envio de formulário).'
          : undefined
      }
    />
  )
  const [sessoes, engajadas, eventos] = METRICAS_GA4
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
      {indicador(sessoes)}
      <Indicador
        rotulo="Usuários"
        valor={u?.valor ?? null}
        textoSemDado={falhaUsuarios ? 'não foi possível carregar' : 'sem dado'}
        variacao={u ? u.variacao : undefined}
        comparacao={u ? 'vs. 28 dias antes' : undefined}
        detalhe={
          u
            ? `Usuários únicos de ${periodo(u.periodo)}.`
            : falhaUsuarios
              ? undefined
              : 'O total de usuários únicos aparece depois da próxima sincronização do Analytics.'
        }
      />
      {indicador(engajadas)}
      {indicador(eventos)}
    </div>
  )
}

/** Legenda de período/cobertura que acompanha os indicadores. */
export function legendaPeriodo(resumo: ResumoTrafego): string {
  const n = resumo.diasSemSessao
  const semSessao = n > 0 ? ` ${n} ${n === 1 ? 'dia sem nenhuma sessão' : 'dias sem nenhuma sessão'} (zero no Analytics).` : ''
  const comp = resumo.comparacao
    ? ` Comparação com ${periodo(resumo.anterior)}.`
    : ' Sem comparação: o histórico sincronizado não cobre os 28 dias anteriores.'
  return `Últimos 28 dias: ${periodo(resumo.atual)}.${comp}${semSessao}`
}

/** Sessões por dia nos últimos 90 dias (sessões engajadas como segunda série, mesma unidade). */
export function GraficoSessoes({
  dias,
  resumo,
  altura = 240,
  comEngajadas = true,
}: {
  dias: DiaGa4[]
  resumo: ResumoTrafego | null
  altura?: number
  comEngajadas?: boolean
}) {
  if (!resumo) {
    return (
      <GraficoSemDado
        titulo="Sessões por dia"
        motivo="O Google Analytics ainda não tem dias gravados: não há sessões para desenhar."
        altura={altura}
      />
    )
  }
  const sessoes = serieTrafego(dias, 'sessoes', resumo)
  const engajadas = serieTrafego(dias, 'sessoesEngajadas', resumo)
  const datas = sessoes.map((p) => p.data)
  const valores = sessoes.map((p) => p.valor)
  const comDado = contarComDado(valores)
  let pico = { v: -1, d: '' }
  for (const p of sessoes) if (p.valor !== null && p.valor > pico.v) pico = { v: p.valor, d: p.data }
  const total = valores.reduce<number>((s, v) => s + (v ?? 0), 0)
  const semDado = datas.length - comDado
  const resumoTexto =
    `${formatarDataIso(datas[0])} a ${formatarDataIso(datas[datas.length - 1])}: ${total.toLocaleString('pt-BR')} sessões; ` +
    `pico de ${pico.v.toLocaleString('pt-BR')} em ${formatarDataIso(pico.d)}.` +
    ' Dia sem sessão no Analytics aparece como zero.' +
    (semDado > 0 ? ` ${semDado} ${semDado === 1 ? 'dia anterior à sincronização aparece' : 'dias anteriores à sincronização aparecem'} como lacuna (sem dado).` : '')
  return (
    <GraficoLinha
      titulo="Sessões por dia, últimos 90 dias (Google Analytics)"
      resumo={resumoTexto}
      datas={datas}
      series={[
        { id: 'sessoes', rotulo: 'Sessões', cor: 1, valores },
        ...(comEngajadas
          ? [{ id: 'engajadas', rotulo: 'Sessões engajadas', cor: 2 as const, valores: engajadas.map((p) => p.valor) }]
          : []),
      ]}
      unidade="sessões"
      altura={altura}
    />
  )
}
