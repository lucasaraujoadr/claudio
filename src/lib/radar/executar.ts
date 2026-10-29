import { coletarTendencias, type BuscarComFontes, type RelatorioColeta, type TendenciaValida } from './coleta'
import { gerarTeses, type ContextoTeses, type TendenciaParaPrompt, type TeseValida } from './teses'
import type { TermosEmAlta } from './termos-em-alta'
import { gerarObjetoComBuscaEFontes, gerarObjetoPadrao, type GerarObjeto } from '@/lib/ai/cliente'

export const FONTE_RADAR = 'tendencias'
export const DIAS_TENDENCIAS_PARA_TESES = 14

export type UltimaExecucao = { status: string; executadoEm: Date }

export type RegistroRadar = {
  fonte: typeof FONTE_RADAR
  status: 'ok' | 'erro'
  mensagem: string
  executadoEm: Date
  linhas: number
}

/** Tudo o que o radar lê e grava; os testes trocam por uma versão em memória. */
export interface RepositorioRadar {
  ultimaExecucao(): Promise<UltimaExecucao | null>
  gravarTendencias(itens: TendenciaValida[], agora: Date): Promise<number>
  tendenciasRecentes(dias: number, agora: Date): Promise<TendenciaParaPrompt[]>
  termosEmAlta(): Promise<TermosEmAlta>
  keywordsExistentes(): Promise<string[]>
  gravarTeses(itens: TeseValida[]): Promise<number>
  registrar(r: RegistroRadar): Promise<void>
}

export type ResultadoRadar = {
  /** Já rodou com sucesso hoje e não veio `forcar`: nenhuma chamada paga foi feita. */
  pulado: boolean
  coleta?: RelatorioColeta & { gravadas: number }
  teses?: { chamouModelo: boolean; geradas: number; gravadas: number; rejeitadas: number }
  termos?: TermosEmAlta['estado']
  /** Só a classe do erro de cada etapa, nunca a mensagem original. */
  erros: { etapa: 'coleta' | 'teses'; erro: string }[]
}

const MSG_ERRO = 'falha ao atualizar o radar; veja os logs do servidor'

const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' })
/** Dia civil em Brasília (AAAA-MM-DD): o "hoje" do escritório, não o do servidor em UTC. */
export function diaEmBrasilia(d: Date): string {
  return formatoDia.format(d)
}

export function jaRodouHoje(u: UltimaExecucao | null, agora: Date): boolean {
  return u !== null && u.status === 'ok' && diaEmBrasilia(u.executadoEm) === diaEmBrasilia(agora)
}

export type DepsRadar = {
  agora: Date
  /** Ignora a trava de custo do dia (decisão consciente de quem clica ou chama). */
  forcar?: boolean
  repo: RepositorioRadar
  buscar?: BuscarComFontes
  gerar?: GerarObjeto
}

function nomeDoErro(e: unknown): string {
  return e instanceof Error ? e.name : 'erro'
}

function mensagemResumo(r: ResultadoRadar): string {
  const partes: string[] = []
  if (r.coleta) {
    const rej = r.coleta.retornadas - r.coleta.gravadas
    partes.push(`${r.coleta.retornadas} tendências retornadas, ${r.coleta.gravadas} gravadas, ${rej} descartadas`)
  }
  if (r.teses) partes.push(`${r.teses.gravadas} teses novas`)
  return partes.join('; ')
}

/**
 * Teto de custo: no máximo uma busca e uma geração de teses por execução. A busca pode ser
 * repetida uma vez pelo cliente se o JSON vier fora do formato (gerarJsonPorPrompt). Se a rotina
 * já terminou com sucesso hoje (dia de Brasília), nada roda sem `forcar`.
 */
export async function executarRadar(d: DepsRadar): Promise<ResultadoRadar> {
  if (!d.forcar && jaRodouHoje(await d.repo.ultimaExecucao(), d.agora)) return { pulado: true, erros: [] }

  const r: ResultadoRadar = { pulado: false, erros: [] }

  try {
    const { validas, relatorio } = await coletarTendencias(d.agora, d.buscar ?? gerarObjetoComBuscaEFontes)
    const gravadas = await d.repo.gravarTendencias(validas, d.agora)
    // Conflito de hash com o que já estava no banco: a mesma fonte de outro dia.
    const jaColetadas = validas.length - gravadas
    if (jaColetadas > 0) relatorio.rejeitadas.ja_coletada = jaColetadas
    r.coleta = { ...relatorio, gravadas }
  } catch (e) {
    console.error('radar: coleta falhou:', e instanceof Error ? `${e.name}: ${e.message}` : 'erro')
    r.erros.push({ etapa: 'coleta', erro: nomeDoErro(e) })
  }

  try {
    const [tendencias, termos, existentes] = await Promise.all([
      d.repo.tendenciasRecentes(DIAS_TENDENCIAS_PARA_TESES, d.agora),
      d.repo.termosEmAlta(),
      d.repo.keywordsExistentes(),
    ])
    r.termos = termos.estado
    const ctx: ContextoTeses = { tendencias, termosEmAlta: termos.termos, existentes }
    const t = await gerarTeses(ctx, d.gerar ?? gerarObjetoPadrao)
    const gravadas = await d.repo.gravarTeses(t.validas)
    r.teses = { chamouModelo: t.chamou, geradas: t.validas.length, gravadas, rejeitadas: t.rejeitadas }
  } catch (e) {
    console.error('radar: teses falharam:', e instanceof Error ? `${e.name}: ${e.message}` : 'erro')
    r.erros.push({ etapa: 'teses', erro: nomeDoErro(e) })
  }

  const ok = r.erros.length === 0
  try {
    await d.repo.registrar({
      fonte: FONTE_RADAR,
      status: ok ? 'ok' : 'erro',
      mensagem: ok ? mensagemResumo(r) : MSG_ERRO,
      executadoEm: d.agora,
      linhas: (r.coleta?.gravadas ?? 0) + (r.teses?.gravadas ?? 0),
    })
  } catch (e) {
    console.error('radar: falha ao registrar a execução:', nomeDoErro(e))
  }
  return r
}
