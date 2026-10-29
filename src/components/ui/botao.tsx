import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'

export type VarianteBotao = 'primario' | 'secundario' | 'fantasma' | 'perigo'
export type TamanhoBotao = 'md' | 'sm'

export type BotaoProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: VarianteBotao
  tamanho?: TamanhoBotao
}

const VARIANTES: Record<VarianteBotao, string> = {
  primario: 'border-transparent bg-acento text-sobre-acento shadow-cartao hover:bg-acento-forte',
  secundario: 'border-borda-forte bg-superficie text-tinta hover:bg-elevada',
  fantasma: 'border-transparent bg-transparent text-tinta-suave hover:bg-elevada hover:text-tinta',
  perigo: 'border-critico-borda bg-critico-fundo text-critico hover:border-critico',
}

const TAMANHOS: Record<TamanhoBotao, string> = {
  md: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
}

/**
 * Classes de botão, para aplicar também em `<Link>` ou `<a>` que devam parecer botão.
 * Estado desabilitado/ocupado: opaco e sem hover, cursor de espera quando `aria-busy`.
 */
export function classesBotao(variante: VarianteBotao = 'primario', tamanho: TamanhoBotao = 'md', extra?: string): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap transition-colors select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foco',
    'disabled:pointer-events-none disabled:opacity-60 aria-busy:cursor-wait',
    VARIANTES[variante],
    TAMANHOS[tamanho],
    extra,
  )
}

/** Botão comum. Padrão `type="button"` — para enviar formulário use `BotaoEnviar`. */
export function Botao({ variante, tamanho, className, type = 'button', ...resto }: BotaoProps) {
  return <button type={type} className={classesBotao(variante, tamanho, className)} {...resto} />
}
