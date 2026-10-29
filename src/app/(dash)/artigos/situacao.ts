import type { VarianteSelo } from '@/components/ui'
import type { Artigo } from '@/lib/db/schema'

export type Situacao = Artigo['situacao']

export const SITUACOES = ['gerando', 'erro_geracao', 'rascunho', 'pronto', 'agendado', 'publicado'] as const satisfies readonly Situacao[]

/** Situação do artigo no painel → texto e tom do selo. */
export const SELO_SITUACAO: Record<Situacao, { rotulo: string; variante: VarianteSelo }> = {
  gerando: { rotulo: 'Gerando', variante: 'info' },
  erro_geracao: { rotulo: 'Erro na geração', variante: 'critico' },
  rascunho: { rotulo: 'Rascunho', variante: 'neutro' },
  pronto: { rotulo: 'Pronto', variante: 'acento' },
  agendado: { rotulo: 'Agendado', variante: 'info' },
  publicado: { rotulo: 'Publicado', variante: 'sucesso' },
}

export function ehSituacao(v: unknown): v is Situacao {
  return typeof v === 'string' && (SITUACOES as readonly string[]).includes(v)
}

/** Status do post no WordPress (o que o WP devolveu no último envio). */
export const ROTULO_WP: Record<string, string> = {
  draft: 'Rascunho no WordPress',
  future: 'Agendado no WordPress',
  publish: 'Publicado no site',
}

/** Só http(s) vira link: a tela não confia em dado de fora. */
export function linkSeguro(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}
