'use client'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useFormStatus } from 'react-dom'
import { classesBotao, type TamanhoBotao, type VarianteBotao } from './botao'

/**
 * Estado "enviando" de um botão de submit.
 *
 * useFormStatus só fica `pending` quando a action do formulário é uma função; os
 * formulários do painel postam para rotas (action="/api/..."), então o envio nativo
 * é observado também pelo evento `submit` do formulário pai. Só dispara depois da
 * validação nativa: um campo inválido não trava o botão. Voltar pelo histórico
 * (bfcache) restaura o botão.
 */
export function useEnvioPendente(): { ref: RefObject<HTMLButtonElement | null>; ocupado: boolean } {
  const { pending } = useFormStatus()
  const [enviado, setEnviado] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const form = ref.current?.form
    if (!form) return
    const aoEnviar = () => setEnviado(true)
    const aoMostrar = (e: PageTransitionEvent) => {
      if (e.persisted) setEnviado(false)
    }
    form.addEventListener('submit', aoEnviar)
    window.addEventListener('pageshow', aoMostrar)
    return () => {
      form.removeEventListener('submit', aoEnviar)
      window.removeEventListener('pageshow', aoMostrar)
    }
  }, [])

  return { ref, ocupado: pending || enviado }
}

export type BotaoEnviarProps = {
  children: ReactNode
  /** Rótulo enquanto envia, ex.: "Gerando…". */
  rotuloEnviando: string
  variante?: VarianteBotao
  tamanho?: TamanhoBotao
  className?: string
  /** Nome/valor enviados com o formulário, quando o botão os carrega. */
  name?: string
  value?: string
}

/**
 * Botão de envio que se desabilita assim que o formulário é enviado, para que um
 * segundo clique não dispare outra chamada paga à IA.
 */
export function BotaoEnviar({
  children,
  rotuloEnviando,
  variante = 'primario',
  tamanho = 'md',
  className,
  name,
  value,
}: BotaoEnviarProps) {
  const { ref, ocupado } = useEnvioPendente()
  return (
    <button
      ref={ref}
      type="submit"
      name={name}
      value={value}
      disabled={ocupado}
      aria-busy={ocupado}
      className={classesBotao(variante, tamanho, className)}
    >
      {ocupado && (
        <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 animate-spin" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
          <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      )}
      {ocupado ? rotuloEnviando : children}
    </button>
  )
}
