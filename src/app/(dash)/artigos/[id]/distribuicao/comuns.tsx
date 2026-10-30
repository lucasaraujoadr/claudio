'use client'

import { useId, useState } from 'react'
import { Botao, cx } from '@/components/ui'
import { classesCampo } from '@/components/ui/campo'
import type { EstadoSalvo } from './usar-salvar-peca'

/** Copia para a área de transferência; se o navegador negar, mostra o texto para copiar à mão. */
export function BotaoCopiar({ texto, rotulo = 'Copiar' }: { texto: string; rotulo?: string }) {
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null)
  const id = useId()

  async function copiar() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('indisponível')
      await navigator.clipboard.writeText(texto)
      setMsg({ texto: 'Copiado.', erro: false })
    } catch {
      setMsg({ texto: 'Não foi possível copiar automaticamente. Selecione o texto abaixo e copie.', erro: true })
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Botao variante="secundario" tamanho="sm" onClick={() => void copiar()}>
          {rotulo}
        </Botao>
        <span role={msg?.erro ? 'alert' : 'status'} className={cx('text-xs', msg?.erro ? 'text-critico' : 'text-sucesso')}>
          {msg?.texto}
        </span>
      </div>
      {msg?.erro && (
        <>
          <label htmlFor={id} className="sr-only">
            Texto para copiar
          </label>
          <textarea id={id} readOnly value={texto} rows={8} className={classesCampo('mt-2 text-xs')} />
        </>
      )}
    </div>
  )
}

const ROTULO_SALVO: Record<EstadoSalvo, string> = {
  salvo: 'salvo',
  pendente: 'alterações não salvas',
  salvando: 'salvando…',
  erro: 'erro ao salvar',
  recusado: 'não salvo',
}

export function IndicadorSalvo({ estado, mensagem, aoTentar }: { estado: EstadoSalvo; mensagem: string | null; aoTentar: () => void }) {
  const problema = estado === 'erro' || estado === 'recusado'
  return (
    <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-xs">
      <span className={cx(problema ? 'font-semibold text-critico' : estado === 'salvo' ? 'text-sucesso' : 'text-tinta-suave')}>
        {ROTULO_SALVO[estado]}
      </span>
      {problema && mensagem && <span className="text-tinta">{mensagem}</span>}
      {estado === 'erro' && (
        <Botao tamanho="sm" variante="secundario" onClick={aoTentar}>
          Tentar salvar de novo
        </Botao>
      )}
    </div>
  )
}

/** Linhas de um textarea "um item por linha"; o vazio só sai no envio, para o Enter não sumir. */
export const linhas = (texto: string) => texto.split('\n')
export const semVazios = (itens: string[]) => itens.map((i) => i.trim()).filter(Boolean)
