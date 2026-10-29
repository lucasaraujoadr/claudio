import { ehBaseLegal, ehStatus, normalizarUf, separarTags, type BaseLegal, type DadosContato, type StatusContato } from './campos'
import type { EdicaoContato } from './contatos'
import { normalizarEmail } from './email'
import { CAMPOS_IMPORTACAO, type Mapeamento } from './importacao'

/** Leitura dos formulários do CRM (FormData → dados validados). Puro. */

function texto(form: FormData, nome: string, max = 500): string {
  const v = form.get(nome)
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export type ErroFormulario = 'email' | 'base-legal' | 'uf' | 'status'

export function lerNovoContato(form: FormData): { ok: true; dados: DadosContato } | { ok: false; erro: ErroFormulario } {
  const email = texto(form, 'email', 254)
  if (!normalizarEmail(email)) return { ok: false, erro: 'email' }
  const baseLegal = texto(form, 'base_legal')
  if (!ehBaseLegal(baseLegal)) return { ok: false, erro: 'base-legal' }
  const uf = texto(form, 'uf')
  if (uf && !normalizarUf(uf)) return { ok: false, erro: 'uf' }
  const status = texto(form, 'status') || 'lead'
  // Pelo cadastro manual ninguém nasce descadastrado nem é "reativado".
  if (!ehStatus(status) || status === 'descadastrado') return { ok: false, erro: 'status' }
  return {
    ok: true,
    dados: {
      email,
      nome: texto(form, 'nome', 200),
      telefone: texto(form, 'telefone', 60),
      escritorio: texto(form, 'escritorio', 200),
      cidade: texto(form, 'cidade', 120),
      uf,
      baseLegal,
      status,
      tags: separarTags(texto(form, 'tags', 1000)),
      notas: texto(form, 'notas', 5000),
    },
  }
}

export function lerEdicao(form: FormData): { ok: true; edicao: EdicaoContato } | { ok: false; erro: ErroFormulario } {
  const baseLegal = texto(form, 'base_legal')
  if (!ehBaseLegal(baseLegal)) return { ok: false, erro: 'base-legal' }
  const uf = texto(form, 'uf')
  if (uf && !normalizarUf(uf)) return { ok: false, erro: 'uf' }
  return {
    ok: true,
    edicao: {
      nome: texto(form, 'nome', 200),
      telefone: texto(form, 'telefone', 60),
      escritorio: texto(form, 'escritorio', 200),
      cidade: texto(form, 'cidade', 120),
      uf,
      baseLegal,
      tags: separarTags(texto(form, 'tags', 1000)),
      notas: texto(form, 'notas', 5000),
    },
  }
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
