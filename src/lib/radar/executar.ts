import { coletarTendencias, type BuscarComFontes, type RelatorioColeta, type TendenciaValida } from './coleta'
import { gerarTeses, type ContextoTeses, type TendenciaParaPrompt, type TeseValida } from './teses'
import type { TermosEmAlta } from './termos-em-alta'
import { generateText } from 'ai'
import { gerarObjetoComBuscaEFontes, gerarObjetoPadrao, type GerarObjeto } from '@/lib/ai/cliente'

export const FONTE_RADAR = 'tendencias'
export const DIAS_TENDENCIAS_PARA_TESES = 14

export type UltimaExecucao = { status: string; executadoEm: Date; ultimoOkEm: Date | null; mensagem: string | null }

export type RegistroRadar = {
  fonte: typeof FONTE_RADAR
  status: 'ok' | 'erro'
  mensagem: string
  executadoEm: Date
  linhas: number
}

/** Resultado da reivindicação atômica da execução. */
export type Reivindicacao = 'reivindicado' | 'em_execucao' | 'ja_rodou'

/** Tudo o que o radar lê e grava; os testes trocam por uma versão em memória. */
export interface RepositorioRadar {
  /**
   * Atômico (um INSERT ... ON CONFLICT DO UPDATE ... WHERE): marca a fonte como `rodando` só se
   * ninguém a está executando (rodando há menos de 6 min) e, sem `forcar`, se não houve sucesso
   * hoje (dia de Brasília, por `ultimo_ok_em`). Quem não reivindica não gasta nada.
   */
  reivindicar(agora: Date, forcar: boolean): Promise<Reivindicacao>
  ultimaExecucao(): Promise<UltimaExecucao | null>
  gravarTendencias(itens: TendenciaValida[], agora: Date): Promise<number>
  tendenciasRecentes(dias: number, agora: Date): Promise<TendenciaParaPrompt[]>
  termosEmAlta(): Promise<TermosEmAlta>
  keywordsExistentes(): Promise<string[]>
  gravarTeses(itens: TeseValida[]): Promise<number>
  /** Grava o desfecho; `ultimo_ok_em` só avança em `ok`, nunca recua em `erro`. */
  registrar(r: RegistroRadar): Promise<void>
}

export type ResultadoRadar = {
  /** Nenhuma chamada paga foi feita: outra execução está em curso ou já houve sucesso hoje. */
  pulado: boolean
  motivoPulo?: 'em_execucao' | 'ja_rodou'
  coleta?: RelatorioColeta & { gravadas: number }
  teses?: { chamouModelo: boolean; geradas: number; gravadas: number; rejeitadas: number }
  termos?: TermosEmAlta['estado']
  /** Só a classe do erro de cada etapa, nunca a mensagem original. */
  erros: { etapa: 'coleta' | 'teses'; erro: string }[]
}

const MSG_ERRO = 'falha ao atualizar o radar; veja os logs do servidor'

/** Orçamento de tempo (maxDuration = 300 s): busca 100 + retry 100 + teses 100. */
export const PRAZO_RETRY_BUSCA_S = 120
export const PRAZO_TESES_S = 190

export class PrazoEsgotadoError extends Error {
  constructor() {
    super('Orçamento de tempo da execução esgotado')
    this.name = 'PrazoEsgotadoError'
  }
}

const formatoDia = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' })
/** Dia civil em Brasília (AAAA-MM-DD): o "hoje" do escritório, não o do servidor em UTC. */
export function diaEmBrasilia(d: Date): string {
  return formatoDia.format(d)
}

/** Só o último SUCESSO fecha o dia: um erro depois de um ok não reabre a trava. */
export function jaRodouHoje(u: UltimaExecucao | null, agora: Date): boolean {
  return u !== null && u.ultimoOkEm !== null && diaEmBrasilia(u.ultimoOkEm) === diaEmBrasilia(agora)
}

export type DepsRadar = {
  agora: Date
  /** Ignora a trava de custo do dia (decisão consciente de quem clica ou chama). */
  forcar?: boolean
  repo: RepositorioRadar
  buscar?: BuscarComFontes
  gerar?: GerarObjeto
  /** Relógio em ms (injetável nos testes). */
  relogio?: () => number
}

/**
 * Busca com prazo: a nova tentativa do cliente (JSON fora do formato) só acontece se ainda houver
 * orçamento; senão a chamada falha com PrazoEsgotadoError em vez de gastar mais 100 s.
 */
export function criarBuscaComPrazo(o: {
  relogio: () => number
  inicio: number
  gerarTexto?: typeof generateText
  env?: Record<string, string | undefined>
}): BuscarComFontes {
  return (opts) => {
    let chamadas = 0
    return gerarObjetoComBuscaEFontes(opts, {
      env: o.env,
      gerar: (async (args: Parameters<typeof generateText>[0]) => {
        if (chamadas++ > 0 && (o.relogio() - o.inicio) / 1000 > PRAZO_RETRY_BUSCA_S) throw new PrazoEsgotadoError()
        return (o.gerarTexto ?? generateText)(args)
      }) as unknown as typeof generateText,
    })
  }
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
 * Teto de custo: no máximo uma busca e uma geração de teses por execução (a busca pode ser
 * repetida uma vez pelo cliente se houver prazo). A execução é reivindicada de forma atômica
 * antes de gastar; o desfecho é sempre registrado (finally).
 */
export async function executarRadar(d: DepsRadar): Promise<ResultadoRadar> {
  const relogio = d.relogio ?? Date.now
  const inicio = relogio()
  const decorrido = () => (relogio() - inicio) / 1000

  const reivindicacao = await d.repo.reivindicar(d.agora, d.forcar === true)
  if (reivindicacao !== 'reivindicado') return { pulado: true, motivoPulo: reivindicacao, erros: [] }

  const r: ResultadoRadar = { pulado: false, erros: [] }
  try {
    try {
      const buscar = d.buscar ?? criarBuscaComPrazo({ relogio, inicio })
      const { validas, relatorio } = await coletarTendencias(d.agora, buscar)
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
      if (decorrido() > PRAZO_TESES_S) throw new PrazoEsgotadoError()
      const [tendencias, termos, existentes] = await Promise.all([
        d.repo.tendenciasRecentes(DIAS_TENDENCIAS_PARA_TESES, d.agora),
        d.repo.termosEmAlta(),
        d.repo.keywordsExistentes(),
      ])
      r.termos = termos.estado
      // Coleta falhou e não há fato dos últimos 14 dias: não vale gastar a geração só com termos.
      const semBase = r.erros.some((x) => x.etapa === 'coleta') && tendencias.length === 0
      const ctx: ContextoTeses = { tendencias, termosEmAlta: semBase ? [] : termos.termos, existentes }
      const t = await gerarTeses(ctx, d.gerar ?? gerarObjetoPadrao)
      const gravadas = await d.repo.gravarTeses(t.validas)
      r.teses = { chamouModelo: t.chamou, geradas: t.validas.length, gravadas, rejeitadas: t.rejeitadas }
    } catch (e) {
      console.error('radar: teses falharam:', e instanceof Error ? `${e.name}: ${e.message}` : 'erro')
      r.erros.push({ etapa: 'teses', erro: nomeDoErro(e) })
    }
  } finally {
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
  }
  return r
}
