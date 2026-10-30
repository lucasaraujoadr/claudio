import type { VarianteSelo } from '@/components/ui'
import type { NewsletterEnvio, PecaDistribuicao } from '@/lib/db/schema'
import type { LIMITES, TipoPeca } from '@/lib/distribuicao/schemas'

/**
 * Tipos e rótulos da aba Distribuição que o navegador pode importar: só `import type` de
 * `schemas.ts` (que puxa o cliente de IA) e do schema do banco. Os limites chegam por prop.
 */

export type Limites = typeof LIMITES
export type SituacaoPeca = PecaDistribuicao['situacao']

/** A ordem dos cartões na tela (mesma de `TIPOS_PECA`). */
export const ORDEM_TIPOS: readonly TipoPeca[] = ['linkedin_artigo', 'linkedin_post', 'carrossel', 'newsletter']

export const ROTULO_TIPO: Record<TipoPeca, string> = {
  linkedin_artigo: 'LinkedIn — artigo',
  linkedin_post: 'LinkedIn — post',
  carrossel: 'Carrossel',
  newsletter: 'Newsletter',
}

export const SELO_PECA: Record<SituacaoPeca, { rotulo: string; variante: VarianteSelo }> = {
  gerando: { rotulo: 'Gerando', variante: 'info' },
  rascunho: { rotulo: 'Rascunho', variante: 'neutro' },
  erro: { rotulo: 'Erro na geração', variante: 'critico' },
  publicado: { rotulo: 'Publicado', variante: 'sucesso' },
}

/** A peça como a tela usa: datas em ISO, sem `modelo` nem `criadoEm`. */
export type PecaTela = {
  id: number
  tipo: TipoPeca
  situacao: SituacaoPeca
  conteudo: unknown
  variacao: 'escura' | 'clara' | null
  erro: string | null
  publicadoEm: string | null
  urlPublicada: string | null
  atualizadoEm: string
}

/** O último envio da newsletter do artigo, sem o id do broadcast. */
export type EnvioTela = {
  id: number
  situacao: NewsletterEnvio['situacao']
  destinatarios: number | null
  enviadoEm: string | null
  erro: string | null
  /** Já existe broadcast no Resend (o rascunho foi criado de fato). */
  temBroadcast: boolean
  /** Quando o conteúdo do broadcast foi gravado no Resend (não muda com a volta a rascunho). */
  conteudoEm: string
}

export type NewsletterTela = {
  envio: EnvioTela | null
  /** Contatos elegíveis e sincronizados: o N de "Confirmar envio para N contatos". */
  destinatarios: number
  /** HTML do email montado no servidor a partir da última versão salva; vai num iframe sandbox. */
  previaHtml: string | null
  resendConfigurado: boolean
  acessoPublico: boolean
}

type ComDatas = { [K in keyof PecaTela]: K extends 'publicadoEm' | 'atualizadoEm' ? Date | string | null : PecaTela[K] }
const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString())

/** Normaliza a peça do servidor (linha do banco ou JSON das rotas) para a tela. */
export function pecaParaTela(p: Omit<ComDatas, 'variacao' | 'atualizadoEm'> & { variacao: string | null; atualizadoEm: Date | string }): PecaTela {
  return {
    id: p.id,
    tipo: p.tipo,
    situacao: p.situacao,
    conteudo: p.conteudo ?? null,
    variacao: p.variacao === 'clara' || p.variacao === 'escura' ? p.variacao : null,
    erro: p.erro,
    publicadoEm: iso(p.publicadoEm),
    urlPublicada: p.urlPublicada,
    atualizadoEm: iso(p.atualizadoEm) ?? new Date(0).toISOString(),
  }
}

export function envioParaTela(e: NewsletterEnvio): EnvioTela {
  return {
    id: e.id,
    situacao: e.situacao,
    destinatarios: e.destinatarios,
    enviadoEm: iso(e.enviadoEm),
    erro: e.erro,
    temBroadcast: Boolean(e.resendBroadcastId),
    conteudoEm: iso(e.conteudoEm ?? e.criadoEm) ?? new Date(0).toISOString(),
  }
}

export async function lerJson(r: Response): Promise<unknown> {
  try {
    return await r.json()
  } catch {
    return null
  }
}

/** Mensagem de erro de uma rota (`{ erro }`), ou a padrão. */
export function erroDe(json: unknown, padrao: string): string {
  const e = (json as { erro?: unknown } | null)?.erro
  return typeof e === 'string' && e.trim() ? e : padrao
}

export function ehPeca(v: unknown): v is Parameters<typeof pecaParaTela>[0] {
  return typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'number' && typeof (v as { tipo?: unknown }).tipo === 'string'
}
