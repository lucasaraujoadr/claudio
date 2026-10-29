import Link from 'next/link'
import { connection } from 'next/server'
import { Aviso, CabecalhoPagina, cx, type TipoAviso } from '@/components/ui'
import { listarArtigos } from '@/lib/artigos/repositorio'
import { ListaArtigos, type LinhaArtigo } from './lista-artigos'
import { SELO_SITUACAO, SITUACOES, ehSituacao } from './situacao'

export const metadata = { title: 'Artigos' }

const AVISOS_GERAR: Record<string, { texto: string; tipo: TipoAviso }> = {
  erro: { texto: 'Não foi possível iniciar a geração do artigo. Tente de novo.', tipo: 'erro' },
  'sem-chave': { texto: 'Chave de IA não configurada (OPENROUTER_API_KEY). Defina a chave nas variáveis de ambiente para gerar artigos.', tipo: 'erro' },
}

export default async function ArtigosPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const sp = await searchParams
  const aviso = typeof sp.gerar === 'string' ? AVISOS_GERAR[sp.gerar] : undefined
  const filtro = ehSituacao(sp.situacao) ? sp.situacao : undefined

  let artigos: LinhaArtigo[] | null = null
  try {
    artigos = await listarArtigos(filtro ? { situacao: filtro } : {})
  } catch (e) {
    console.error('artigos: leitura da lista falhou:', e instanceof Error ? e.name : 'erro')
  }

  const pilula = (ativo: boolean) =>
    cx(
      'inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors',
      ativo ? 'border-acento bg-acento-suave font-semibold text-tinta' : 'border-borda bg-superficie text-tinta-suave hover:bg-elevada hover:text-tinta',
    )

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="SEO"
        titulo="Artigos"
        subtitulo="Artigos escritos por IA a partir das teses e dos temas: revise no painel e envie ao WordPress."
      />

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <nav aria-label="Filtro por situação" className="flex flex-wrap gap-2">
        <Link href="/artigos" aria-current={!filtro ? 'page' : undefined} className={pilula(!filtro)}>
          Todos
        </Link>
        {SITUACOES.map((s) => (
          <Link key={s} href={`/artigos?situacao=${s}`} aria-current={filtro === s ? 'page' : undefined} className={pilula(filtro === s)}>
            {SELO_SITUACAO[s].rotulo}
          </Link>
        ))}
      </nav>

      {artigos === null ? (
        <Aviso tipo="erro" titulo="Não foi possível ler os artigos">
          O banco não respondeu. Recarregue a página.
        </Aviso>
      ) : (
        <ListaArtigos artigos={artigos} filtro={filtro} />
      )}
    </div>
  )
}
