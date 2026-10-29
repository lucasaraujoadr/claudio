import type { BaseLegal, Origem, StatusContato } from './campos'

/**
 * Regras de entrada nos funis, sem banco: quem pode entrar em qual funil, por qual caminho.
 * `funis.ts` lê os dados e aplica estas funções; os testes cobrem cada regra aqui.
 *
 * Regra de LGPD acima de todas: contato `descadastrado` nunca entra em funil nenhum, por
 * nenhum caminho (e sai de todos quando se descadastra).
 */

export const SLUGS_FUNIS = ['boas-vindas', 'nutricao-blog', 'reativacao', 'prospeccao-fria'] as const
export type SlugFunil = (typeof SLUGS_FUNIS)[number]

export function ehSlugFunil(v: unknown): v is SlugFunil {
  return typeof v === 'string' && (SLUGS_FUNIS as readonly string[]).includes(v)
}

/** Caminho da inscrição: formulário do site, tela (manual ou por tag de importação) ou rotina diária. */
export type CaminhoInscricao = 'site' | 'manual' | 'cron'

/** Dias sem nenhum evento na linha do tempo para um cliente entrar na reativação. */
export const DIAS_SEM_INTERACAO_REATIVACAO = 180
/** Máximo de inscrições na reativação por execução diária. */
export const MAX_REATIVACAO_POR_DIA = 50
/** Teto diário da prospecção fria: o usuário escolhe entre 1 e este valor. */
export const TETO_MAXIMO_PROSPECCAO = 200

export type FunilParaRegra = {
  slug: SlugFunil
  ativo: boolean
  tetoDiario: number | null
  exigeBaseLegal: BaseLegal | null
  checklistLgpdEm: Date | null
}

export type ContatoParaRegra = {
  status: StatusContato
  baseLegal: BaseLegal
  origem: Origem
  /** Último evento da linha do tempo (ou a criação do contato, se não houver evento). */
  ultimaInteracaoEm: Date
}

export type MotivoRecusa =
  | 'descadastrado'
  | 'funil_inativo'
  | 'caminho_nao_permitido'
  | 'status'
  | 'base_legal'
  | 'sem_interacao_recente_exigida'
  | 'checklist_lgpd'
  | 'teto_diario'

export const ROTULO_RECUSA: Record<MotivoRecusa, string> = {
  descadastrado: 'descadastrado',
  funil_inativo: 'funil desligado',
  caminho_nao_permitido: 'entrada não permitida por este caminho',
  status: 'status do contato não aceito neste funil',
  base_legal: 'base legal não aceita neste funil',
  sem_interacao_recente_exigida: `teve interação nos últimos ${DIAS_SEM_INTERACAO_REATIVACAO} dias`,
  checklist_lgpd: 'checklist de LGPD ou teto diário não confirmados',
  teto_diario: 'teto diário atingido',
}

export type Decisao = { ok: true } | { ok: false; motivo: MotivoRecusa }

const DIA_MS = 24 * 60 * 60 * 1000

/** Caminhos aceitos por funil (a tela é sempre aceita, com as mesmas regras de contato). */
const CAMINHOS: Record<SlugFunil, readonly CaminhoInscricao[]> = {
  'boas-vindas': ['site', 'manual'],
  'nutricao-blog': ['manual'],
  reativacao: ['cron', 'manual'],
  'prospeccao-fria': ['cron', 'manual'],
}

/** Prospecção fria só pode ficar ligada com checklist confirmado e teto definido. */
export function prospeccaoLiberada(f: Pick<FunilParaRegra, 'checklistLgpdEm' | 'tetoDiario'>): boolean {
  return f.checklistLgpdEm !== null && f.tetoDiario !== null && f.tetoDiario > 0
}

/**
 * Decide se um contato pode entrar num funil. `inscritosHoje` é quantas inscrições o funil
 * já recebeu hoje (fuso de Brasília), para o teto diário.
 */
export function podeEntrar(
  funil: FunilParaRegra,
  contato: ContatoParaRegra,
  ctx: { caminho: CaminhoInscricao; agora: Date; inscritosHoje: number },
): Decisao {
  if (contato.status === 'descadastrado') return { ok: false, motivo: 'descadastrado' }
  if (!funil.ativo) return { ok: false, motivo: 'funil_inativo' }
  if (!CAMINHOS[funil.slug].includes(ctx.caminho)) return { ok: false, motivo: 'caminho_nao_permitido' }
  if (funil.exigeBaseLegal && contato.baseLegal !== funil.exigeBaseLegal) return { ok: false, motivo: 'base_legal' }

  switch (funil.slug) {
    case 'boas-vindas':
      // Lead que chegou pelo formulário do site (que grava consentimento). Um cliente que
      // preenche o formulário de novo não recebe "boas-vindas".
      if (contato.origem !== 'site' && ctx.caminho !== 'site') return { ok: false, motivo: 'caminho_nao_permitido' }
      if (contato.status !== 'lead') return { ok: false, motivo: 'status' }
      break
    case 'nutricao-blog':
      if (contato.status !== 'lead' && contato.status !== 'cliente') return { ok: false, motivo: 'status' }
      if (contato.baseLegal !== 'consentimento' && contato.baseLegal !== 'contrato') return { ok: false, motivo: 'base_legal' }
      break
    case 'reativacao':
      if (contato.status !== 'cliente') return { ok: false, motivo: 'status' }
      if (ctx.caminho === 'cron' && !semInteracaoHa(contato.ultimaInteracaoEm, ctx.agora, DIAS_SEM_INTERACAO_REATIVACAO)) {
        return { ok: false, motivo: 'sem_interacao_recente_exigida' }
      }
      if (ctx.caminho === 'cron' && ctx.inscritosHoje >= MAX_REATIVACAO_POR_DIA) return { ok: false, motivo: 'teto_diario' }
      break
    case 'prospeccao-fria':
      if (contato.baseLegal !== 'legitimo_interesse') return { ok: false, motivo: 'base_legal' }
      if (contato.status !== 'lead') return { ok: false, motivo: 'status' }
      if (!prospeccaoLiberada(funil)) return { ok: false, motivo: 'checklist_lgpd' }
      break
  }

  if (funil.tetoDiario !== null && ctx.inscritosHoje >= funil.tetoDiario) return { ok: false, motivo: 'teto_diario' }
  return { ok: true }
}

export function semInteracaoHa(ultima: Date, agora: Date, dias: number): boolean {
  return agora.getTime() - ultima.getTime() >= dias * DIA_MS
}

/** Limite para a consulta da reativação: última interação até este instante. */
export function limiteReativacao(agora: Date): Date {
  return new Date(agora.getTime() - DIAS_SEM_INTERACAO_REATIVACAO * DIA_MS)
}

/**
 * Início do dia corrente em Brasília (UTC−3; o Brasil não tem horário de verão desde 2019),
 * para os tetos diários.
 */
export function inicioDoDiaBrasilia(agora: Date): Date {
  const deslocamento = 3 * 60 * 60 * 1000
  const local = new Date(agora.getTime() - deslocamento)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + deslocamento)
}

/** Quantos ainda cabem hoje, dado o teto (null = sem teto) e quantos já entraram. */
export function vagasHoje(teto: number | null, inscritosHoje: number): number {
  if (teto === null) return Number.POSITIVE_INFINITY
  return Math.max(0, teto - inscritosHoje)
}

export type ChecklistLgpd = {
  avaliacaoLegitimoInteresse: boolean
  descadastroEmTodoEmail: boolean
  volumeBaixoAquecido: boolean
}

/** Valida o pedido de ligar a prospecção fria: os três itens marcados e teto entre 1 e o máximo. */
export function validarLigarProspeccao(
  checklist: ChecklistLgpd,
  teto: number | null,
): { ok: true; teto: number } | { ok: false; motivo: 'checklist' | 'teto' } {
  if (!checklist.avaliacaoLegitimoInteresse || !checklist.descadastroEmTodoEmail || !checklist.volumeBaixoAquecido) {
    return { ok: false, motivo: 'checklist' }
  }
  if (teto === null || !Number.isInteger(teto) || teto < 1 || teto > TETO_MAXIMO_PROSPECCAO) return { ok: false, motivo: 'teto' }
  return { ok: true, teto }
}
