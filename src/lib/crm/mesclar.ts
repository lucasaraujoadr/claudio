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
  brevoId: string | null
}

export type Mescla = {
  estado: EstadoContato
  alterados: CampoContato[]
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
    brevoId: c.brevoId,
  }
}

function mesmaData(a: Date | null, b: Date | null): boolean {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null)
}

/** Diferenças campo a campo entre dois estados. */
export function diferencas(a: EstadoContato, b: EstadoContato): CampoContato[] {
  const campos: CampoContato[] = []
  for (const k of ['nome', 'telefone', 'escritorio', 'cidade', 'uf', 'baseLegal', 'status', 'notas', 'brevoId'] as const) {
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
    tags: normalizarTags(dados.tags),
    notas: textoOuNulo(dados.notas),
    brevoId: textoOuNulo(dados.brevoId),
  }
}

/**
 * Regras de mescla de `upsertContato` sobre um contato existente:
 * - campo informado e não vazio substitui; vazio/ausente nunca apaga;
 * - tags: união (as existentes primeiro, na ordem);
 * - notas: a nova é acrescentada se ainda não estiver contida;
 * - origem e email exibido: os do primeiro registro;
 * - base legal: só fortalece (ver `FORCA_BASE_LEGAL`), nunca rebaixa;
 * - status: `descadastrado` nunca sai daqui (só `reativarContato`); entrar nele pode.
 */
export function mesclarEstado(atual: EstadoContato, dados: DadosContato, agora: Date): Mescla {
  const novo: EstadoContato = { ...atual, tags: [...atual.tags] }
  const nome = textoOuNulo(dados.nome)
  if (nome) novo.nome = nome
  for (const k of ['telefone', 'escritorio', 'cidade', 'brevoId'] as const) {
    const v = textoOuNulo(dados[k])
    if (v) novo[k] = v
  }
  const uf = normalizarUf(dados.uf)
  if (uf) novo.uf = uf

  for (const t of normalizarTags(dados.tags)) if (!novo.tags.includes(t)) novo.tags.push(t)

  const notas = textoOuNulo(dados.notas)
  if (notas && !(novo.notas ?? '').includes(notas)) novo.notas = novo.notas ? `${novo.notas}\n\n${notas}` : notas

  if (dados.baseLegal && FORCA_BASE_LEGAL[dados.baseLegal] > FORCA_BASE_LEGAL[atual.baseLegal]) {
    novo.baseLegal = dados.baseLegal
  }
  if (novo.baseLegal === 'consentimento' && !novo.consentimentoEm) {
    novo.consentimentoEm = dados.consentimentoEm ?? agora
  }

  if (dados.status && atual.status !== 'descadastrado') novo.status = dados.status

  const alterados = diferencas(atual, novo)
  return {
    estado: novo,
    alterados,
    status: novo.status !== atual.status ? { de: atual.status, para: novo.status } : undefined,
    brevoMudou: brevoMudou(alterados),
  }
}
