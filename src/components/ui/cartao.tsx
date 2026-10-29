import { useId, type ReactNode } from 'react'
import { cx } from './cx'

export type CartaoProps = {
  /** Título do cartão (h2). Quando presente, rotula a seção para leitores de tela. */
  titulo?: ReactNode
  /** Linha curta abaixo do título. */
  descricao?: ReactNode
  /** Ações no canto do cabeçalho (link "Abrir", botão…). */
  acoes?: ReactNode
  /** Rodapé com borda superior: fonte do dado, data de atualização. */
  rodape?: ReactNode
  /** Nível do título; padrão h2. */
  nivelTitulo?: 2 | 3
  /** Sem padding interno no corpo — para tabelas de borda a borda. */
  semPreenchimento?: boolean
  as?: 'section' | 'article' | 'div'
  className?: string
  children?: ReactNode
}

export function Cartao({
  titulo,
  descricao,
  acoes,
  rodape,
  nivelTitulo = 2,
  semPreenchimento = false,
  as: Tag = 'section',
  className,
  children,
}: CartaoProps) {
  const id = useId()
  const Titulo = nivelTitulo === 2 ? 'h2' : 'h3'
  const temCabecalho = titulo != null || acoes != null
  return (
    <Tag
      aria-labelledby={titulo != null && Tag !== 'div' ? id : undefined}
      className={cx(
        'min-w-0 rounded-xl border border-borda bg-superficie shadow-cartao',
        className,
      )}
    >
      {temCabecalho && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4">
          <div className="min-w-0">
            {titulo != null && (
              <Titulo id={id} className="font-titulo text-lg font-semibold leading-snug text-tinta">
                {titulo}
              </Titulo>
            )}
            {descricao != null && <p className="mt-0.5 text-sm text-tinta-suave">{descricao}</p>}
          </div>
          {acoes != null && <div className="flex shrink-0 items-center gap-2">{acoes}</div>}
        </header>
      )}
      {children != null && (
        <div className={cx(semPreenchimento ? (temCabecalho ? 'pt-3' : '') : 'p-5', temCabecalho && !semPreenchimento && 'pt-3')}>
          {children}
        </div>
      )}
      {rodape != null && (
        <footer className="border-t border-borda px-5 py-3 text-xs text-tinta-suave">{rodape}</footer>
      )}
    </Tag>
  )
}
