import Link from 'next/link'
import { cx } from '@/components/ui'
import type { Situacao } from '../situacao'

/** A distribuição só existe para artigo pronto ou depois (spec §3.4). */
const COM_DISTRIBUICAO: readonly Situacao[] = ['pronto', 'agendado', 'publicado']

const CLASSE = 'inline-flex h-8 items-center rounded px-3 text-sm'

/** Abas "Artigo" | "Distribuição" do editor: cada uma é uma rota, então são links com `aria-current`. */
export function AbasArtigo({ artigoId, situacao, atual }: { artigoId: number; situacao: Situacao; atual: 'artigo' | 'distribuicao' }) {
  const liberada = COM_DISTRIBUICAO.includes(situacao)
  const aba = (ativa: boolean) =>
    cx(CLASSE, ativa ? 'bg-acento-suave font-semibold text-tinta' : 'text-tinta-suave hover:text-tinta')
  return (
    <nav aria-label="Seções do artigo" className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="inline-flex rounded-md border border-borda bg-superficie p-0.5">
        <Link href={`/artigos/${artigoId}`} aria-current={atual === 'artigo' ? 'page' : undefined} className={aba(atual === 'artigo')}>
          Artigo
        </Link>
        {liberada ? (
          <Link
            href={`/artigos/${artigoId}/distribuicao`}
            aria-current={atual === 'distribuicao' ? 'page' : undefined}
            className={aba(atual === 'distribuicao')}
          >
            Distribuição
          </Link>
        ) : (
          <span aria-disabled="true" className={cx(CLASSE, 'cursor-not-allowed text-tinta-suave opacity-60')}>
            Distribuição
          </span>
        )}
      </div>
      {!liberada && <span className="text-xs text-tinta-suave">A distribuição fica disponível quando o artigo estiver pronto.</span>}
    </nav>
  )
}
