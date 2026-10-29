import type { Contato } from '@/lib/db/schema'

export const ORIGENS = ['site', 'planilha', 'manual', 'brevo'] as const
export const BASES_LEGAIS = ['consentimento', 'legitimo_interesse', 'contrato'] as const
export const STATUS_CONTATO = ['lead', 'cliente', 'inativo', 'descadastrado'] as const

export type Origem = (typeof ORIGENS)[number]
export type BaseLegal = (typeof BASES_LEGAIS)[number]
export type StatusContato = (typeof STATUS_CONTATO)[number]

export const ROTULO_ORIGEM: Record<Origem, string> = {
  site: 'Site',
  planilha: 'Planilha',
  manual: 'Manual',
  brevo: 'Brevo',
}
export const ROTULO_BASE_LEGAL: Record<BaseLegal, string> = {
  consentimento: 'Consentimento',
  legitimo_interesse: 'Legítimo interesse',
  contrato: 'Contrato',
}
export const ROTULO_STATUS: Record<StatusContato, string> = {
  lead: 'Lead',
  cliente: 'Cliente',
  inativo: 'Inativo',
  descadastrado: 'Descadastrado',
}

/**
 * Força de cada base legal para email de marketing. Consentimento é a mais forte (opt-in
 * explícito); contrato cobre quem já é cliente; legítimo interesse é a mais frágil. Uma
 * base nunca é rebaixada implicitamente: só uma edição manual explícita troca para uma
 * mais fraca.
 */
export const FORCA_BASE_LEGAL: Record<BaseLegal, number> = {
  legitimo_interesse: 1,
  contrato: 2,
  consentimento: 3,
}

export function ehOrigem(v: unknown): v is Origem {
  return typeof v === 'string' && (ORIGENS as readonly string[]).includes(v)
}
export function ehBaseLegal(v: unknown): v is BaseLegal {
  return typeof v === 'string' && (BASES_LEGAIS as readonly string[]).includes(v)
}
export function ehStatus(v: unknown): v is StatusContato {
  return typeof v === 'string' && (STATUS_CONTATO as readonly string[]).includes(v)
}

/** Campos que o Brevo recebe: mudar qualquer um deixa o contato `pendente` de sincronização. */
export const CAMPOS_BREVO = ['nome', 'telefone', 'escritorio', 'cidade', 'uf', 'status', 'tags', 'baseLegal'] as const

export type CampoContato =
  | 'nome'
  | 'telefone'
  | 'escritorio'
  | 'cidade'
  | 'uf'
  | 'baseLegal'
  | 'consentimentoEm'
  | 'status'
  | 'tags'
  | 'notas'
  | 'resendContatoId'

export const ROTULO_CAMPO: Record<CampoContato, string> = {
  nome: 'Nome',
  telefone: 'Telefone',
  escritorio: 'Escritório',
  cidade: 'Cidade',
  uf: 'UF',
  baseLegal: 'Base legal',
  consentimentoEm: 'Consentimento',
  status: 'Status',
  tags: 'Tags',
  notas: 'Notas',
  resendContatoId: 'Id no Resend',
}

/** Entrada de `upsertContato`. Campo ausente, `null` ou só espaços = "não informado". */
export type DadosContato = {
  email: string
  nome?: string | null
  telefone?: string | null
  escritorio?: string | null
  cidade?: string | null
  uf?: string | null
  /** Obrigatória para criar; num contato existente só pode fortalecer a base. */
  baseLegal?: BaseLegal | null
  consentimentoEm?: Date | null
  /** Nunca tira um contato de `descadastrado`. */
  status?: StatusContato | null
  tags?: readonly string[] | null
  notas?: string | null
  resendContatoId?: string | null
}

const UFS = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA',
  'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
] as const

const UF_POR_NOME: Record<string, (typeof UFS)[number]> = {
  acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE',
  'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA',
  paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO',
}

export function semAcento(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '')
}

/** Sigla de UF válida ("sp", "São Paulo" → "SP"); qualquer outra coisa → `null`. */
export function normalizarUf(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  if (!t) return null
  const sigla = t.toUpperCase()
  if ((UFS as readonly string[]).includes(sigla)) return sigla
  return UF_POR_NOME[semAcento(t).toLowerCase().replace(/\s+/g, ' ')] ?? null
}

/** Texto aparado; vazio vira `null`. */
export function textoOuNulo(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t.length > 0 ? t : null
}

/** Tags: aparadas, espaços internos colapsados, minúsculas, até 50 caracteres, sem repetição. */
export function normalizarTags(tags: readonly string[] | null | undefined): string[] {
  const saida: string[] = []
  for (const bruta of tags ?? []) {
    const t = bruta.trim().replace(/\s+/g, ' ').toLowerCase().slice(0, 50)
    if (t && !saida.includes(t)) saida.push(t)
  }
  return saida
}

/** "a, b; c" → ["a","b","c"] (vírgula, ponto e vírgula ou barra vertical). */
export function separarTags(texto: string | null | undefined): string[] {
  return normalizarTags((texto ?? '').split(/[,;|]/))
}

export type { Contato }
