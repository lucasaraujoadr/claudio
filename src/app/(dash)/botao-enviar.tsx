'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

/**
 * Botão de envio que se desabilita assim que o formulário é enviado, para que um
 * segundo clique não dispare outra chamada paga à IA.
 *
 * useFormStatus só fica `pending` quando a action do formulário é uma função; os
 * formulários do painel postam para rotas (action="/api/..."), então o envio nativo
 * é observado também pelo evento `submit` do formulário pai.
 */
export function BotaoEnviar({
  children,
  rotuloEnviando,
  className,
}: {
  children: ReactNode
  rotuloEnviando: string
  className?: string
}) {
  const { pending } = useFormStatus()
  const [enviado, setEnviado] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const form = ref.current?.form
    if (!form) return
    // Só dispara depois da validação nativa: um campo inválido não trava o botão.
    const aoEnviar = () => setEnviado(true)
    // Voltar pelo histórico pode restaurar a página com o botão ainda desabilitado.
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

  const ocupado = pending || enviado
  return (
    <button ref={ref} type="submit" disabled={ocupado} aria-busy={ocupado} className={className}>
      {ocupado ? rotuloEnviando : children}
    </button>
  )
}
