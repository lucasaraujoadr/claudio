import { Aviso } from '@/components/ui/aviso'
import type { ExplicacaoGsc } from './sincronizacao'

/** Aviso do estado do Search Console, com a causa e o que fazer. */
export function AvisoSearchConsole({ explicacao }: { explicacao: ExplicacaoGsc }) {
  return (
    <Aviso tipo={explicacao.tipo} titulo={explicacao.titulo}>
      <p>{explicacao.texto}</p>
      {explicacao.email && (
        <p className="mt-2">
          Conta a adicionar:{' '}
          <code className="rounded border border-borda bg-superficie px-1.5 py-0.5 font-mono text-[0.8125rem] break-all text-tinta select-all">
            {explicacao.email}
          </code>
        </p>
      )}
    </Aviso>
  )
}
