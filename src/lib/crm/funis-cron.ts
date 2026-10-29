import type { ClienteBrevo } from '@/lib/brevo'
import { criarClienteBrevo } from '@/lib/brevo'
import { bancoPadrao, type BancoCrm } from './banco'
import {
  concluirSequencias,
  encerrarInscricoesDeDescadastrados,
  garantirFunis,
  inscreverProspeccao,
  inscreverReativacao,
  INTERROMPIDO_POR_TEMPO,
  sincronizarInscricoes,
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
 * descadastrados, conclui as
 * sequências que terminaram, inscreve na
 * reativação (até 50) e na prospecção fria (se ligada, no teto), e, com chave do Brevo,
 * envia os contatos pendentes e atualiza as listas. Cada subetapa é isolada: uma falha não
 * impede as seguintes; no fim, se alguma falhou, lança `FalhaEtapaFunis` (a rotina diária
 * registra `erro` sem a mensagem). Nenhum dado de contato vai para log.
 */
export async function executarEtapaFunis(
  opts: { db?: BancoCrm; cliente?: ClienteBrevo; agora?: Date; relogio?: () => number; prazoMs?: number } = {},
): Promise<ResultadoEtapaFunis> {
  const db = opts.db ?? bancoPadrao()
  const cliente = opts.cliente ?? criarClienteBrevo()
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
  await etapa('concluir', async () => {
    detalhes.concluidas = await concluirSequencias({ db, agora })
  })
  await etapa('reativacao', async () => {
    detalhes.reativacao = (await inscreverReativacao({ db, agora })).inscritos.length
  })
  await etapa('prospeccao', async () => {
    detalhes.prospeccao = (await inscreverProspeccao({ db, agora })).inscritos.length
  })
  if (cliente.conectado) {
    await etapa('contatos', async () => {
      const r = await sincronizarPendentes({ db, cliente, limite: 200, agora, deveParar: semTempo })
      detalhes.contatosEnviados = r.conectado ? r.enviados : 0
      if (r.conectado && r.interrompido === INTERROMPIDO_POR_TEMPO) parouPorTempo = true
    })
    await etapa('listas', async () => {
      const r = await sincronizarInscricoes({ db, cliente, limite: 500, agora, deveParar: semTempo })
      if (r.conectado) {
        detalhes.listasAdicionados = r.adicionados
        detalhes.listasRemovidos = r.removidos
        detalhes.listasErros = r.erros
        if (r.interrompido === INTERROMPIDO_POR_TEMPO) parouPorTempo = true
        else if (r.interrompido) throw Object.assign(new Error('interrompido'), { name: 'BrevoInterrompido' })
      }
    })
  } else {
    detalhes.brevo = 'não conectado'
  }

  const linhas = Number(detalhes.reativacao ?? 0) + Number(detalhes.prospeccao ?? 0)
  const mensagem = [
    `Reativação: ${detalhes.reativacao ?? '—'}`,
    `prospecção fria: ${detalhes.prospeccao ?? '—'}`,
    `saídas por descadastro: ${detalhes.encerradasDescadastro ?? '—'}`,
    `sequências concluídas: ${detalhes.concluidas ?? '—'}`,
    cliente.conectado
      ? `listas do Brevo: +${detalhes.listasAdicionados ?? 0} / −${detalhes.listasRemovidos ?? 0}`
      : 'Brevo não conectado (inscrições guardadas como pendentes)',
  ].join('; ') + '.'
  const resultado = { linhas, detalhes, mensagem }
  if (parouPorTempo) throw new FalhaEtapaFunis(falhas, resultado, { naoRodaram })
  if (falhas.length > 0) throw new FalhaEtapaFunis(falhas, resultado)
  return resultado
}
