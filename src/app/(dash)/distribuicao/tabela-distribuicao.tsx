import Link from 'next/link'
import { EstadoVazio, Selo, Tabela } from '@/components/ui'
import type { TipoPeca } from '@/lib/distribuicao/schemas'
import { ORDEM_TIPOS, ROTULO_TIPO, SELO_PECA, type SituacaoPeca } from '../artigos/[id]/distribuicao/tipos'

export type LinhaDistribuicao = {
  artigoId: number
  titulo: string | null
  keyword: string
  situacoes: Partial<Record<TipoPeca, SituacaoPeca>>
}

/** Cada artigo com o estado das 4 peças; o título leva à aba Distribuição do artigo. */
export function TabelaDistribuicao({ linhas }: { linhas: LinhaDistribuicao[] }) {
  if (linhas.length === 0) {
    return (
      <EstadoVazio
        titulo="Nenhum artigo pronto ainda"
        explicacao={
          <>
            As peças saem de um artigo pronto, agendado ou publicado. Revise um em <Link href="/artigos">Artigos</Link> e abra a aba
            &ldquo;Distribuição&rdquo;.
          </>
        }
      />
    )
  }
  return (
    <Tabela legenda="Distribuição por artigo">
      <thead>
        <tr>
          <th scope="col">Artigo</th>
          {ORDEM_TIPOS.map((t) => (
            <th key={t} scope="col">
              {ROTULO_TIPO[t]}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.artigoId}>
            <td className="min-w-56">
              <Link
                href={`/artigos/${l.artigoId}/distribuicao`}
                className="font-medium text-tinta underline-offset-2 hover:text-acento-texto hover:underline"
              >
                {l.titulo?.trim() || `Artigo ${l.artigoId}`}
              </Link>
              {l.keyword && <p className="text-xs text-tinta-suave">{l.keyword}</p>}
            </td>
            {ORDEM_TIPOS.map((t) => {
              const s = l.situacoes[t]
              return (
                <td key={t} className="whitespace-nowrap">
                  {s ? <Selo variante={SELO_PECA[s].variante}>{SELO_PECA[s].rotulo}</Selo> : <span className="text-sm text-tinta-suave">Não gerada</span>}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </Tabela>
  )
}
