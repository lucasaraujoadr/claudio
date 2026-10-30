import { acessoPublicoOk } from '@/lib/acesso-publico'
import { configResend, criarClienteResend, type ClienteResend } from '@/lib/resend'
import { bancoPadrao, type BancoCrm } from './banco'
import { executarEnviosFunil } from './envios-funil'
import {
  encerrarInscricoesDeDescadastrados,
  garantirFunis,
  inscreverProspeccao,
  inscreverReativacao,
  INTERROMPIDO_POR_TEMPO,
} from './funis'
import { apagarLotesVencidos } from './importacao'
import { sincronizarPendentes } from './sincronizar'

/** Fonte gravada em `sincronizacoes` pela etapa de funis da rotina diária. */
export const FONTE_FUNIS = 'funis'

/**
 * Prazo interno da etapa: a função da rotina tem `maxDuration = 120` s. Passado este tempo,
 * a etapa não começa subetapa nem lote novo e termina registrando "Interrompido por tempo"
 * (o que ficou pendente segue na próxima execução), em vez de ser cortada pela Vercel e
 * deixar na tela o "ok" da execução anterior.
 */
export const PRAZO_ETAPA_FUNIS_MS = 90_000

export type ResultadoEtapaFunis = {
  linhas: number
  detalhes: Record<string, number | string>
  mensagem: string
}

/**
 * Uma subetapa que falhou (o nome dela e a classe do erro, nunca a mensagem), ou a etapa
 * parou por tempo (`semTempo`: subetapas que não chegaram a rodar).
 */
export class FalhaEtapaFunis extends Error {
  /** Lida pela rotina diária e gravada em `sincronizacoes`: só nomes de subetapas. */
  readonly mensagemSegura: string
  constructor(
    readonly falhas: string[],
    readonly parcial: ResultadoEtapaFunis,
    readonly semTempo: { naoRodaram: string[] } | null = null,
  ) {
    super(semTempo ? INTERROMPIDO_POR_TEMPO : `falharam: ${falhas.join(', ')}`)
    this.name = 'FalhaEtapaFunis'
    const partes: string[] = []
    if (semTempo) {
      const n = semTempo.naoRodaram
      partes.push(`Interrompido por tempo (${PRAZO_ETAPA_FUNIS_MS / 1000} s)${n.length > 0 ? `; não rodaram: ${n.join(', ')}` : ''}; o restante segue na próxima execução.`)
    }
    if (falhas.length > 0) partes.push(`Falha em: ${falhas.join(', ')}.`)
    this.mensagemSegura = `${partes.join(' ')} ${parcial.mensagem}`
  }
}

/**
 * Etapa diária dos funis: garante os quatro funis, apaga lotes de planilha vencidos, tira
 * descadastrados, inscreve na reativação (até 50) e na prospecção fria (se ligada, no teto),
 * envia pelo Resend as etapas devidas (até `RESEND_LIMITE_DIARIO`; a sequência conclui depois
 * da última etapa) e, antes disso, sincroniza com o Resend os contatos pendentes (segmento da
 * newsletter).
 * Cada subetapa é isolada: uma falha não impede as seguintes; no fim, se alguma falhou, lança
 * `FalhaEtapaFunis` (a rotina diária registra `erro` sem a mensagem). Nenhum dado de contato
 * vai para log.
 *
 * `resend`: cliente do Resend (padrão: `configResend()`); `null` = sem chave, nada é enviado.
 * `acessoPublico`: checagem do acesso público (padrão: `acessoPublicoOk`), feita uma vez por execução.
 */
export async function executarEtapaFunis(
  opts: {
    db?: BancoCrm
    resend?: ClienteResend | null
    acessoPublico?: () => Promise<boolean>
    agora?: Date
    relogio?: () => number
    prazoMs?: number
  } = {},
): Promise<ResultadoEtapaFunis> {
  const db = opts.db ?? bancoPadrao()
  const resend = opts.resend !== undefined ? opts.resend : (() => {
    const cfg = configResend()
    return cfg ? criarClienteResend(cfg) : null
  })()
  const agora = opts.agora ?? new Date()
  const relogio = opts.relogio ?? Date.now
  const prazo = opts.prazoMs ?? PRAZO_ETAPA_FUNIS_MS
  const inicio = relogio()
  const semTempo = () => relogio() - inicio >= prazo
  const detalhes: Record<string, number | string> = {}
  const falhas: string[] = []
  const naoRodaram: string[] = []
  let parouPorTempo = false

  async function etapa(nome: string, f: () => Promise<void>) {
    if (semTempo()) {
      parouPorTempo = true
      naoRodaram.push(nome)
      return
    }
    try {
      await f()
    } catch (e) {
      falhas.push(nome)
      console.error(`cron diario: funis/${nome} falhou:`, e instanceof Error ? e.name : 'erro')
    }
  }

  await etapa('garantir', async () => {
    await garantirFunis({ db })
  })
  // Dados mínimos: planilha abandonada (CSV inteiro) não espera o próximo upload para sumir.
  await etapa('importacoes', async () => {
    detalhes.lotesApagados = await apagarLotesVencidos({ db, agora })
  })
  await etapa('descadastrados', async () => {
    detalhes.encerradasDescadastro = await encerrarInscricoesDeDescadastrados({ db, agora })
  })
  await etapa('reativacao', async () => {
    detalhes.reativacao = (await inscreverReativacao({ db, agora })).inscritos.length
  })
  await etapa('prospeccao', async () => {
    detalhes.prospeccao = (await inscreverProspeccao({ db, agora })).inscritos.length
  })
  // Contatos antes dos envios: o segmento da newsletter e o `unsubscribed` já estão em dia.
  if (resend) {
    await etapa('contatos', async () => {
      const r = await sincronizarPendentes({ db, cliente: resend, limite: 200, agora, deveParar: semTempo })
      detalhes.contatosEnviados = r.conectado ? r.enviados : 0
      if (r.conectado) {
        detalhes.contatosErros = r.erros
        if (r.interrompido === INTERROMPIDO_POR_TEMPO) parouPorTempo = true
        else if (r.interrompido) detalhes.contatosInterrompido = r.interrompido
      }
    })
  }
  // Envios por último: as inscrições de hoje (reativação, prospecção) já entram na fila.
  if (resend) {
    await etapa('envios', async () => {
      const acesso = await (opts.acessoPublico ?? (() => acessoPublicoOk()))()
      if (!acesso) detalhes.acessoPublico = 'não'
      const r = await executarEnviosFunil({ db, cliente: resend, agora, acessoPublico: acesso, deveParar: semTempo })
      detalhes.enviados = r.enviados
      detalhes.envioPulados = r.pulados
      detalhes.envioErros = r.erros
      detalhes.envioIncertos = r.incertos
      detalhes.envioRestantes = r.restantes
      if (acesso && r.restantes > 0 && semTempo()) parouPorTempo = true
    })
  } else {
    detalhes.resend = 'não configurado'
  }

  const linhas = Number(detalhes.reativacao ?? 0) + Number(detalhes.prospeccao ?? 0)
  const mensagem = [
    `Reativação: ${detalhes.reativacao ?? '—'}`,
    `prospecção fria: ${detalhes.prospeccao ?? '—'}`,
    `saídas por descadastro: ${detalhes.encerradasDescadastro ?? '—'}`,
    !resend
      ? 'Resend não configurado (nenhum email de funil enviado)'
      : detalhes.acessoPublico === 'não'
        ? `painel sem acesso público: nenhum email enviado (${detalhes.envioRestantes ?? 0} na fila)`
        : `emails enviados: ${detalhes.enviados ?? '—'}, erros: ${detalhes.envioErros ?? '—'}, incertos (conferir no Resend; não são repetidos): ${detalhes.envioIncertos ?? '—'}, para amanhã: ${detalhes.envioRestantes ?? '—'}`,
    ...(resend ? [`contatos sincronizados: ${detalhes.contatosEnviados ?? '—'}`] : []),
  ].join('; ') + '.'
  const resultado = { linhas, detalhes, mensagem }
  if (parouPorTempo) throw new FalhaEtapaFunis(falhas, resultado, { naoRodaram })
  if (falhas.length > 0) throw new FalhaEtapaFunis(falhas, resultado)
  return resultado
}
