import type { ReactNode } from 'react'
import { cx } from './cx'
import { IconeTom, type Tom } from './icones'

export type TipoAviso = 'info' | 'alerta' | 'erro' | 'sucesso'

export type AvisoProps = {
  tipo?: TipoAviso
  titulo?: ReactNode
  children?: ReactNode
  /** Botão ou link de ação, à direita (abaixo em telas estreitas). */
  acao?: ReactNode
  /**
   * Papel ARIA. Padrão: `alert` para erro (anunciado na hora), `status` para os demais.
   * Use `null` para um aviso estático que não deve ser anunciado.
   */
  role?: 'alert' | 'status' | null
  className?: string
}

const TOM: Record<TipoAviso, Tom> = { info: 'info', alerta: 'aviso', erro: 'critico', sucesso: 'sucesso' }

const CLASSES: Record<Tom, string> = {
  critico: 'border-critico-borda bg-critico-fundo [&_[data-icone]]:text-critico',
  aviso: 'border-aviso-borda bg-aviso-fundo [&_[data-icone]]:text-aviso',
  info: 'border-info-borda bg-info-fundo [&_[data-icone]]:text-info',
  sucesso: 'border-sucesso-borda bg-sucesso-fundo [&_[data-icone]]:text-sucesso',
}

/** Caixa de mensagem. O texto fica na tinta do tema; a cor do status vai no ícone e na borda. */
export function Aviso({ tipo = 'info', titulo, children, acao, role, className }: AvisoProps) {
  const tom = TOM[tipo]
  const papel = role === undefined ? (tipo === 'erro' ? 'alert' : 'status') : (role ?? undefined)
  return (
    <div
      role={papel}
      className={cx('flex flex-col gap-3 rounded-lg border p-4 text-sm text-tinta sm:flex-row sm:items-start', CLASSES[tom], className)}
    >
      <div className="flex min-w-0 flex-1 gap-3">
        <span data-icone className="mt-0.5 shrink-0">
          <IconeTom tom={tom} className="size-[18px]" />
        </span>
        <div className="min-w-0">
          {titulo != null && <p className="font-semibold">{titulo}</p>}
          {children != null && <div className={cx(titulo != null && 'mt-0.5', 'text-tinta [&_a]:underline')}>{children}</div>}
        </div>
      </div>
      {acao != null && <div className="flex shrink-0 gap-2 sm:ml-auto">{acao}</div>}
    </div>
  )
}
