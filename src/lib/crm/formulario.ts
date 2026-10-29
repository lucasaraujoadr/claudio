import { ehBaseLegal, ehStatus, normalizarUf, separarTags, type BaseLegal, type DadosContato, type StatusContato } from './campos'
import type { EdicaoContato } from './contatos'
import { normalizarEmail } from './email'
import { CAMPOS_IMPORTACAO, type Mapeamento } from './importacao'
import { LIMITE_NOTAS, LIMITE_TAGS } from './mesclar'

/** Leitura dos formulários do CRM (FormData → dados validados). Puro. */

function texto(form: FormData, nome: string, max = 500): string {
  const v = form.get(nome)
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export type ErroFormulario = 'email' | 'base-legal' | 'uf' | 'status' | 'longo'

/** Limite de caracteres de cada campo livre dos formulários de contato. */
export const LIMITES_CAMPOS = { nome: 200, telefone: 60, escritorio: 200, cidade: 120, tags: 1000, notas: LIMITE_NOTAS } as const
type CampoLivre = keyof typeof LIMITES_CAMPOS

/**
 * Campos livres lidos sem cortar: o que passa do limite (ou mais de `LIMITE_TAGS` tags)
 * é recusado com o nome do campo, para a tela dizer o que encurtar. Nada é truncado calado.
 */
function camposLivres(form: FormData): { ok: true; v: Record<CampoLivre, string> } | { ok: false; campo: CampoLivre } {
  const v = {} as Record<CampoLivre, string>
  for (const campo of Object.keys(LIMITES_CAMPOS) as CampoLivre[]) {
    const bruto = form.get(campo)
    const t = typeof bruto === 'string' ? bruto.trim() : ''
    if (t.length > LIMITES_CAMPOS[campo]) return { ok: false, campo }
    v[campo] = t
  }
  if (separarTags(v.tags).length > LIMITE_TAGS) return { ok: false, campo: 'tags' }
  return { ok: true, v }
}

export type NovoContatoLido = {
  dados: DadosContato
  /**
   * Status escolhido explicitamente no formulário; `null` = o padrão (lead para contato
   * novo, nada muda num contato que já existia).
   */
  statusEscolhido: Exclude<StatusContato, 'descadastrado'> | null
}

export function lerNovoContato(
  form: FormData,
): ({ ok: true } & NovoContatoLido) | { ok: false; erro: ErroFormulario; campo?: CampoLivre } {
  const email = texto(form, 'email', 300)
  if (!normalizarEmail(email)) return { ok: false, erro: 'email' }
  const baseLegal = texto(form, 'base_legal')
  if (!ehBaseLegal(baseLegal)) return { ok: false, erro: 'base-legal' }
  const uf = texto(form, 'uf')
  if (uf && !normalizarUf(uf)) return { ok: false, erro: 'uf' }
  const status = texto(form, 'status')
  // Pelo cadastro manual ninguém nasce descadastrado nem é "reativado".
  if (status && (!ehStatus(status) || status === 'descadastrado')) return { ok: false, erro: 'status' }
  const livres = camposLivres(form)
  if (!livres.ok) return { ok: false, erro: 'longo', campo: livres.campo }
  const v = livres.v
  const statusEscolhido = status && ehStatus(status) && status !== 'descadastrado' ? status : null
  return {
    ok: true,
    statusEscolhido,
    dados: {
      email,
      nome: v.nome,
      telefone: v.telefone,
      escritorio: v.escritorio,
      cidade: v.cidade,
      uf,
      baseLegal,
      // Só vale na criação: o upsert não muda o status de quem já existe.
      status: statusEscolhido ?? 'lead',
      tags: separarTags(v.tags),
      notas: v.notas,
    },
  }
}

export function lerEdicao(
  form: FormData,
): { ok: true; edicao: EdicaoContato } | { ok: false; erro: ErroFormulario; campo?: CampoLivre } {
  const baseLegal = texto(form, 'base_legal')
  if (!ehBaseLegal(baseLegal)) return { ok: false, erro: 'base-legal' }
  const uf = texto(form, 'uf')
  if (uf && !normalizarUf(uf)) return { ok: false, erro: 'uf' }
  const livres = camposLivres(form)
  if (!livres.ok) return { ok: false, erro: 'longo', campo: livres.campo }
  const v = livres.v
  return {
    ok: true,
    edicao: {
      nome: v.nome,
      telefone: v.telefone,
      escritorio: v.escritorio,
      cidade: v.cidade,
      uf,
      baseLegal,
      tags: separarTags(v.tags),
      notas: v.notas,
    },
  }
}

export const ROTULO_CAMPO_LIVRE: Record<CampoLivre, string> = {
  nome: 'Nome',
  telefone: 'Telefone',
  escritorio: 'Escritório',
  cidade: 'Cidade',
  tags: 'Tags',
  notas: 'Notas',
}

/** Mensagem de campo longo demais, para as telas. */
export function mensagemCampoLongo(campo: string | undefined): string {
  const c = campo && campo in LIMITES_CAMPOS ? (campo as CampoLivre) : null
  if (!c) return 'Um dos campos passa do limite de tamanho. Nada foi salvo.'
  if (c === 'tags') return `Tags demais: até ${LIMITE_TAGS} tags e ${LIMITES_CAMPOS.tags.toLocaleString('pt-BR')} caracteres. Nada foi salvo.`
  return `${ROTULO_CAMPO_LIVRE[c]} passa do limite de ${LIMITES_CAMPOS[c].toLocaleString('pt-BR')} caracteres. Encurte e salve de novo; nada foi salvo.`
}

export function lerStatus(form: FormData): StatusContato | null {
  const s = texto(form, 'para')
  return ehStatus(s) ? s : null
}

/** Mapeamento enviado na confirmação: `col_<campo>` = índice da coluna ou vazio. */
export function lerMapeamento(form: FormData): Mapeamento | null {
  const mapa = {} as Mapeamento
  for (const campo of CAMPOS_IMPORTACAO) {
    const v = texto(form, `col_${campo}`)
    if (v === '') {
      mapa[campo] = null
      continue
    }
    if (!/^\d{1,4}$/.test(v)) return null
    mapa[campo] = Number(v)
  }
  return mapa
}

export function lerBaseLegal(form: FormData): BaseLegal | null {
  const b = texto(form, 'base_legal')
  return ehBaseLegal(b) ? b : null
}

export function lerTags(form: FormData): string[] {
  return separarTags(texto(form, 'tags', 1000))
}

/** Id numérico de rota (`/crm/contatos/12`). */
export function lerId(bruto: string): number | null {
  if (!/^\d{1,9}$/.test(bruto)) return null
  const n = Number(bruto)
  return n > 0 ? n : null
}
