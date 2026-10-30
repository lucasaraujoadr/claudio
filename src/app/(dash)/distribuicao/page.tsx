import { connection } from 'next/server'
import { Aviso, CabecalhoPagina } from '@/components/ui'
import { listarArtigos } from '@/lib/artigos/repositorio'
import { listarDistribuicao } from '@/lib/distribuicao/repositorio'
import { TabelaDistribuicao, type LinhaDistribuicao } from './tabela-distribuicao'

export const metadata = { title: 'Distribuição' }

const PRONTOS = new Set(['pronto', 'agendado', 'publicado'])

/** Artigos prontos (ou que já têm peças), do mais recente para o mais antigo, com a situação de cada peça. */
async function montarLinhas(): Promise<LinhaDistribuicao[]> {
  const [artigos, pecas] = await Promise.all([listarArtigos(), listarDistribuicao()])
  const porArtigo = new Map<number, LinhaDistribuicao['situacoes']>()
  for (const p of pecas) {
    const s = porArtigo.get(p.artigoId) ?? {}
    s[p.tipo] = p.situacao
    porArtigo.set(p.artigoId, s)
  }
  return artigos
    .filter((a) => PRONTOS.has(a.situacao) || porArtigo.has(a.id))
    .map((a) => ({ artigoId: a.id, titulo: a.titulo, keyword: a.keyword, situacoes: porArtigo.get(a.id) ?? {} }))
}

export default async function DistribuicaoPage() {
  await connection()
  let linhas: LinhaDistribuicao[] | null = null
  try {
    linhas = await montarLinhas()
  } catch (e) {
    console.error('distribuicao: leitura da lista falhou:', e instanceof Error ? e.name : 'erro')
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="SEO"
        titulo="Distribuição"
        subtitulo="As peças de cada artigo: LinkedIn (artigo e post), carrossel e newsletter. Abra um artigo para revisar, copiar, baixar e enviar."
      />
      {linhas === null ? (
        <Aviso tipo="erro" titulo="Não foi possível ler a distribuição">
          O banco não respondeu. Recarregue a página.
        </Aviso>
      ) : (
        <TabelaDistribuicao linhas={linhas} />
      )}
    </div>
  )
}
