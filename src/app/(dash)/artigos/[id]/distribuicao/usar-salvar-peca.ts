'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ehPeca, erroDe, lerJson, pecaParaTela, type PecaTela } from './tipos'

/**
 * Salvamento automático de uma peça, no mesmo padrão do editor do artigo: espera 1,5 s sem
 * digitação, manda o conteúdo inteiro no PUT e, ao sair da tela com edição pendente, grava com
 * `keepalive`. Conteúdo recusado pela rota (vazio, acima do limite, lâmina que não cabe) não é
 * reenviado sozinho: a próxima edição tenta de novo.
 */

export type EstadoSalvo = 'salvo' | 'pendente' | 'salvando' | 'erro' | 'recusado'

const ESPERA_SALVAR_MS = 1500

export function useSalvarPeca(pecaId: number, aoSalvo: (p: PecaTela) => void) {
  const [estado, setEstado] = useState<EstadoSalvo>('salvo')
  /** Mensagem do último salvamento recusado ou com erro. */
  const [mensagem, setMensagem] = useState<string | null>(null)
  /** Lâminas (1-based) que o servidor disse que não cabem na arte (422). */
  const [laminasLongas, setLaminasLongas] = useState<number[]>([])
  const pendente = useRef<{ conteudo: unknown } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emVoo = useRef<Promise<boolean> | null>(null)
  const aoSalvoRef = useRef(aoSalvo)
  useEffect(() => {
    aoSalvoRef.current = aoSalvo
  }, [aoSalvo])

  const salvar = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    while (emVoo.current) await emVoo.current
    const item = pendente.current
    if (!item) return true
    pendente.current = null
    setEstado('salvando')
    const p = (async (): Promise<boolean> => {
      try {
        const r = await fetch(`/api/distribuicao/pecas/${pecaId}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ conteudo: item.conteudo }),
        })
        const json = await lerJson(r)
        if (r.ok && ehPeca(json)) {
          setLaminasLongas([])
          setMensagem(null)
          aoSalvoRef.current(pecaParaTela(json))
          return true
        }
        if (r.status === 422 || r.status === 400 || r.status === 409) {
          const laminas = (json as { laminas?: unknown } | null)?.laminas
          const lista = Array.isArray(laminas) ? laminas.filter((n): n is number => typeof n === 'number') : []
          setLaminasLongas(lista)
          setMensagem(
            r.status === 422
              ? `Não salvo: o texto não cabe na arte (${lista.length === 1 ? 'lâmina' : 'lâminas'} ${lista.join(', ')}). Encurte e o salvamento volta sozinho.`
              : r.status === 409
                ? `Não salvo: ${erroDe(json, 'a peça está sendo gerada')}.`
                : 'Não salvo: há campo vazio ou acima do limite. Confira os contadores.',
          )
          setEstado('recusado')
          return false
        }
        throw new Error('falha')
      } catch {
        pendente.current = pendente.current ?? item
        setMensagem('Não foi possível salvar agora.')
        setEstado('erro')
        return false
      } finally {
        emVoo.current = null
      }
    })()
    emVoo.current = p
    const ok = await p
    if (ok) setEstado(pendente.current ? 'pendente' : 'salvo')
    return ok
  }, [pecaId])

  const alterar = useCallback(
    (conteudo: unknown) => {
      pendente.current = { conteudo }
      setEstado('pendente')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void salvar(), ESPERA_SALVAR_MS)
    },
    [salvar],
  )

  /** Esquece a edição pendente (antes de regerar, que substitui o conteúdo). */
  const descartar = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pendente.current = null
    setEstado('salvo')
    setMensagem(null)
    setLaminasLongas([])
  }, [])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      const item = pendente.current
      if (!item) return
      pendente.current = null
      void fetch(`/api/distribuicao/pecas/${pecaId}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ conteudo: item.conteudo }),
        keepalive: true,
      }).catch(() => {})
    },
    [pecaId],
  )

  // Sair da página com alteração não salva: o navegador pergunta (nada de confirm()).
  useEffect(() => {
    if (estado === 'salvo') return
    const antes = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', antes)
    return () => window.removeEventListener('beforeunload', antes)
  }, [estado])

  return { estado, mensagem, laminasLongas, alterar, salvar, descartar }
}
