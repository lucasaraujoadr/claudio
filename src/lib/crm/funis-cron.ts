import type { ClienteBrevo } from '@/lib/brevo'
import { criarClienteBrevo } from '@/lib/brevo'
import { bancoPadrao, type BancoCrm } from './banco'
import {
  encerrarInscricoesDeDescadastrados,
  garantirFunis,
  inscreverProspeccao,
  inscreverReativacao,
  sincronizarInscricoes,
} from './funis'
import { sincronizarPendentes } from './sincronizar'

/** Fonte gravada em `sincronizacoes` pela etapa de funis da rotina diária. */
export const FONTE_FUNIS = 'funis'

export type ResultadoEtapaFunis = {
  linhas: number
  detalhes: Record<string, number | string>
  mensagem: string
}

/** Uma subetapa que falhou: o nome dela e a classe do erro (nunca a mensagem). */
export class FalhaEtapaFunis extends Error {
  /** Lida pela rotina diária e gravada em `sincronizacoes`: só nomes de subetapas. */
  readonly mensagemSegura: string
  constructor(readonly falhas: string[], readonly parcial: ResultadoEtapaFunis) {
    super(`falharam: ${falhas.join(', ')}`)
    this.name = 'FalhaEtapaFunis'
    this.mensagemSegura = `Falha em: ${falhas.join(', ')}. ${parcial.mensagem}`
  }
}

/**
 * Etapa diária dos funis: garante os quatro funis, tira descadastrados, inscreve na
 * reativação (até 50) e na prospecção fria (se ligada, no teto), e, com chave do Brevo,
 * envia os contatos pendentes e atualiza as listas. Cada subetapa é isolada: uma falha não
 * impede as seguintes; no fim, se alguma falhou, lança `FalhaEtapaFunis` (a rotina diária
 * registra `erro` sem a mensagem). Nenhum dado de contato vai para log.
 */
export async function executarEtapaFunis(opts: { db?: BancoCrm; cliente?: ClienteBrevo; agora?: Date } = {}): Promise<ResultadoEtapaFunis> {
  const db = opts.db ?? bancoPadrao()
  const cliente = opts.cliente ?? criarClienteBrevo()
  const agora = opts.agora ?? new Date()
  const detalhes: Record<string, number | string> = {}
  const falhas: string[] = []

  async function etapa(nome: string, f: () => Promise<void>) {
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
  await etapa('descadastrados', async () => {
    detalhes.encerradasDescadastro = await encerrarInscricoesDeDescadastrados({ db, agora })
  })
  await etapa('reativacao', async () => {
    detalhes.reativacao = (await inscreverReativacao({ db, agora })).inscritos.length
  })
  await etapa('prospeccao', async () => {
    detalhes.prospeccao = (await inscreverProspeccao({ db, agora })).inscritos.length
  })
  if (cliente.conectado) {
    await etapa('contatos', async () => {
      const r = await sincronizarPendentes({ db, cliente, limite: 200, agora })
      detalhes.contatosEnviados = r.conectado ? r.enviados : 0
    })
    await etapa('listas', async () => {
      const r = await sincronizarInscricoes({ db, cliente, limite: 500 })
      if (r.conectado) {
        detalhes.listasAdicionados = r.adicionados
        detalhes.listasRemovidos = r.removidos
        detalhes.listasErros = r.erros
        if (r.interrompido) throw Object.assign(new Error('interrompido'), { name: 'BrevoInterrompido' })
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
    cliente.conectado
      ? `listas do Brevo: +${detalhes.listasAdicionados ?? 0} / −${detalhes.listasRemovidos ?? 0}`
      : 'Brevo não conectado (inscrições guardadas como pendentes)',
  ].join('; ') + '.'
  const resultado = { linhas, detalhes, mensagem }
  if (falhas.length > 0) throw new FalhaEtapaFunis(falhas, resultado)
  return resultado
}
