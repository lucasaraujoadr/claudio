import { cx } from './cx'

/**
 * Classes de `<input>`, `<select>` e `<textarea>` no padrão do painel. O contorno usa
 * `borda-campo`, com contraste ≥ 3:1 contra o fundo nos dois temas (WCAG 1.4.11).
 */
export function classesCampo(extra?: string): string {
  return cx(
    'block w-full rounded-md border border-borda-campo bg-superficie px-3 py-2 text-sm text-tinta shadow-cartao',
    'placeholder:text-tinta-suave focus-visible:border-foco focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-foco',
    'aria-invalid:border-critico disabled:opacity-60',
    extra,
  )
}

/** Classes de `<label>`. */
export const CLASSES_ROTULO = 'block text-sm font-medium text-tinta'
