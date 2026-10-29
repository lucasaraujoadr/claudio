import type { Contato } from '@/lib/db/schema'
import {
  CAMPOS_BREVO,
  FORCA_BASE_LEGAL,
  normalizarTags,
  normalizarUf,
  textoOuNulo,
  type BaseLegal,
  type CampoContato,
  type DadosContato,
  type Origem,
  type StatusContato,
} from './campos'

/** O que o banco guarda de um contato, sem id e carimbos. */
export type EstadoContato = {
  nome: string
  email: string
  emailNormalizado: string
  telefone: string | null
  escritorio: string | null
  cidade: string | null
  uf: string | null
  origem: Origem
  baseLegal: BaseLegal
  consentimentoEm: Date | null
  status: StatusContato
  tags: string[]
  notas: string | null
  resendContatoId: string | null
}

export type Mescla = {
  estado: EstadoContato
  alterados: CampoContato[]
  /** Campos com valor novo recusado porque a origem não pode sobrescrevê-los (ou por limite). */
  mantidos: CampoContato[]
  /** Presente quando o status mudou. */
  status?: { de: StatusContato; para: StatusContato }
  /** Algum campo que vai para o Brevo mudou. */
  brevoMudou: boolean
}

export function estadoDe(c: Contato): EstadoContato {
  return {
    nome: c.nome,
    email: c.email,
    emailNormalizado: c.emailNormalizado,
    telefone: c.telefone,
    escritorio: c.escritorio,
    cidade: c.cidade,
    uf: c.uf,
    origem: c.origem,
    baseLegal: c.baseLegal,
    consentimentoEm: c.consentimentoEm,
    status: c.status,
    tags: [...c.tags],
    notas: c.notas,
    resendContatoId: c.resendContatoId,
  }
}

function mesmaData(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null)
}

/** Diferenças campo a campo entre dois estados. */
export function diferencas(a: EstadoContato, b: EstadoContato): CampoContato[] {
  const campos: CampoContato[] = []
  for (const k of ['nome', 'telefone', 'escritorio', 'cidade', 'uf', 'baseLegal', 'status', 'notas', 'resendContatoId'] as const) {
    if (a[k] !== b[k]) campos.push(k)
  }
  if (!mesmaData(a.consentimentoEm, b.consentimentoEm)) campos.push('consentimentoEm')
  if (a.tags.length !== b.tags.length || a.tags.some((t, i) => t !== b.tags[i])) campos.push('tags')
  return campos
}

export function brevoMudou(campos: readonly CampoContato[]): boolean {
  return campos.some((c) => (CAMPOS_BREVO as readonly string[]).includes(c))
}

/**
 * Novo contato a partir dos dados. `null` quando falta a base legal (obrigatória para
 * criar). `emailNormalizado` já validado por quem chama.
 */
export function criarEstado(dados: DadosContato, emailNormalizado: string, origem: Origem, agora: Date): EstadoContato | null {
  if (!dados.baseLegal) return null
  const status = dados.status ?? 'lead'
  return {
    nome: textoOuNulo(dados.nome) ?? '',
    email: dados.email.trim(),
    emailNormalizado,
    telefone: textoOuNulo(dados.telefone),
    escritorio: textoOuNulo(dados.escritorio),
    cidade: textoOuNulo(dados.cidade),
    uf: normalizarUf(dados.uf),
    origem,
    baseLegal: dados.baseLegal,
    consentimentoEm: dados.baseLegal === 'consentimento' ? (dados.consentimentoEm ?? agora) : null,
    status,
    tags: normalizarTags(dados.tags).slice(0, LIMITE_TAGS),
    notas: textoOuNulo(dados.notas)?.slice(0, LIMITE_NOTAS) ?? null,
    resendContatoId: textoOuNulo(dados.resendContatoId),
  }
}

export const LIMITE_NOTAS = 5000
export const LIMITE_TAGS = 50

/** Campos de dados que cada origem pode sobrescrever quando já estão preenchidos. */
const CAMPOS_DADOS = ['nome', 'telefone', 'escritorio', 'cidade', 'uf'] as const
type CampoDado = (typeof CAMPOS_DADOS)[number]
const SOBRESCREVE: Record<Origem, readonly CampoDado[]> = {
  // Cadastro manual: a pessoa do escritório digitou agora, vale o que ela digitou.
  manual: CAMPOS_DADOS,
  // Formulário do site: o próprio contato informou nome, telefone e escritório.
  site: ['nome', 'telefone', 'escritorio'],
  // Planilha antiga e Brevo: só preenchem o que está vazio.
  planilha: [],
  brevo: [],
}

/**
 * Regras de mescla de `upsertContato` sobre um contato existente:
 * - campos de dados conforme a confiança da origem (`SOBRESCREVE`): o que a origem não
 *   pode sobrescrever só é preenchido se estiver vazio, e o valor diferente recusado vai
 *   para `mantidos`; vazio/ausente nunca apaga;
 * - tags: união (as existentes primeiro), até `LIMITE_TAGS`;
 * - notas: a nova é acrescentada se ainda não estiver contida, até `LIMITE_NOTAS`;
 * - origem e email exibido: os do primeiro registro;
 * - base legal: só fortalece (ver `FORCA_BASE_LEGAL`), nunca rebaixa;
 * - status: o upsert implícito nunca muda status, exceto para entrar em `descadastrado`
 *   (e nunca sai dele). Mudança de status é ação explícita (`mudarStatus`).
 */
export function mesclarEstado(atual: EstadoContato, dados: DadosContato, origem: Origem, agora: Date): Mescla {
  const novo: EstadoContato = { ...atual, tags: [...atual.tags] }
  const mantidos: CampoContato[] = []
  for (const k of CAMPOS_DADOS) {
    const v = k === 'uf' ? normalizarUf(dados.uf) : textoOuNulo(dados[k])
    if (!v || v === atual[k]) continue
    if (!atual[k] || SOBRESCREVE[origem].includes(k)) novo[k] = v
    else mantidos.push(k)
  }
  const resendContatoId = textoOuNulo(dados.resendContatoId)
  if (resendContatoId) novo.resendContatoId = resendContatoId

  for (const t of normalizarTags(dados.tags)) {
    if (novo.tags.includes(t)) continue
    if (novo.tags.length >= LIMITE_TAGS) {
      if (!mantidos.includes('tags')) mantidos.push('tags')
      continue
    }
    novo.tags.push(t)
  }

  const notas = textoOuNulo(dados.notas)
  if (notas && !(novo.notas ?? '').includes(notas)) {
    const juntas = novo.notas ? `${novo.notas}\n\n${notas}` : notas
    if (juntas.length <= LIMITE_NOTAS) novo.notas = juntas
    else mantidos.push('notas')
  }

  if (dados.baseLegal && FORCA_BASE_LEGAL[dados.baseLegal] > FORCA_BASE_LEGAL[atual.baseLegal]) {
    novo.baseLegal = dados.baseLegal
  }
  if (novo.baseLegal === 'consentimento' && !novo.consentimentoEm) {
    novo.consentimentoEm = dados.consentimentoEm ?? agora
  }

  if (dados.status === 'descadastrado') novo.status = 'descadastrado'

  const alterados = diferencas(atual, novo)
  return {
    estado: novo,
    alterados,
    mantidos,
    status: novo.status !== atual.status ? { de: atual.status, para: novo.status } : undefined,
    brevoMudou: brevoMudou(alterados),
  }
}
