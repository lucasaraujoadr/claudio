import { cx } from '@/components/ui'

/** Contador de caracteres: fica em tom de aviso fora da faixa ideal (`min`–`max`). */
export function Contador({ valor, min = 0, max, id }: { valor: number; min?: number; max: number; id?: string }) {
  const fora = valor < min || valor > max
  return (
    <span
      id={id}
      data-estado={fora ? 'aviso' : 'ok'}
      className={cx('text-xs tabular-nums', fora ? 'font-semibold text-aviso' : 'text-tinta-suave')}
    >
      {valor}/{max}
    </span>
  )
}
