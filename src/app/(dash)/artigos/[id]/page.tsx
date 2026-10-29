import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, Selo } from '@/components/ui'
import { iaConfigurada } from '@/lib/ai/cliente'
import { obterArtigo } from '@/lib/artigos/repositorio'
import { idDaRota, keywordDoTema, montarVisao } from '@/lib/artigos/visao'
import { brevoConfigurado } from '@/lib/brevo'
import { configWp, criarClienteWp } from '@/lib/wordpress'
import { SELO_SITUACAO } from '../situacao'
import { EditorArtigo } from './editor-artigo'
import { paraTela } from './tipos'

export const metadata = { title: 'Artigo' }

/** Mesmo limite do repositório: `gerando` parado além disso pode ser reivindicado de novo. */
const MINUTOS_GERANDO_PRESO = 10

function TentarDeNovo({ topicId }: { topicId: number }) {
  return (
    <form method="POST" action="/api/artigos/gerar" className="space-y-1">
      <input type="hidden" name="topicId" value={topicId} />
      <BotaoEnviar rotuloEnviando="Gerando…">Tentar de novo</BotaoEnviar>
      <p className="text-xs text-tinta-suave">Gera o artigo outra vez; leva cerca de 2 minutos.</p>
    </form>
  )
}

export default async function ArtigoPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const id = idDaRota((await params).id)
  if (!id) notFound()

  let artigo: Awaited<ReturnType<typeof obterArtigo>> = null
  let keyword = ''
  try {
    artigo = await obterArtigo(id)
    if (artigo) keyword = await keywordDoTema(artigo.topicId)
  } catch (e) {
    console.error('artigos: leitura do artigo falhou:', e instanceof Error ? e.name : 'erro')
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <CabecalhoPagina secao={<Link href="/artigos" className="hover:underline">SEO · Artigos</Link>} titulo="Artigo" />
        <Aviso tipo="erro" titulo="Não foi possível ler o artigo">O banco não respondeu. Recarregue a página.</Aviso>
      </div>
    )
  }
  if (!artigo) notFound()

  const selo = SELO_SITUACAO[artigo.situacao]
  const cabecalho = (
    <CabecalhoPagina
      secao={<Link href="/artigos" className="hover:underline">SEO · Artigos</Link>}
      titulo={artigo.titulo?.trim() || 'Artigo'}
      subtitulo={
        <span className="flex flex-wrap items-center gap-2">
          <Selo variante={selo.variante}>{selo.rotulo}</Selo>
          {keyword && <span>Palavra-chave: {keyword}</span>}
        </span>
      }
    />
  )

  if (artigo.situacao === 'gerando') {
    const agora = new Date()
    const preso = agora.getTime() - artigo.atualizadoEm.getTime() > MINUTOS_GERANDO_PRESO * 60_000
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {!preso && <meta httpEquiv="refresh" content="10" />}
        {cabecalho}
        {preso ? (
          <Cartao titulo="A geração parece ter travado">
            <div className="space-y-4">
              <p className="text-sm text-tinta-suave">Faz mais de {MINUTOS_GERANDO_PRESO} minutos que o artigo começou a ser gerado, sem resposta.</p>
              <TentarDeNovo topicId={artigo.topicId} />
            </div>
          </Cartao>
        ) : (
          <Cartao titulo="Gerando o artigo… (leva cerca de 2 minutos)">
            <p className="text-sm text-tinta-suave" role="status">
              A IA está pesquisando as fontes e escrevendo o texto. Esta página se atualiza sozinha a cada 10 segundos; pode sair e voltar depois.
            </p>
          </Cartao>
        )}
      </div>
    )
  }

  if (artigo.situacao === 'erro_geracao') {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        {cabecalho}
        <Aviso tipo="erro" titulo="A geração do artigo falhou">
          {artigo.erro || 'O modelo não devolveu um artigo válido.'}
        </Aviso>
        <TentarDeNovo topicId={artigo.topicId} />
      </div>
    )
  }

  const cfg = configWp()
  let categorias: { id: number; nome: string }[] = []
  let avisoCategorias: string | null = null
  if (cfg) {
    try {
      categorias = await criarClienteWp(cfg).listarCategorias()
    } catch (e) {
      console.error('artigos: categorias do WP falharam:', e instanceof Error ? e.name : 'erro')
      avisoCategorias = 'Não foi possível carregar as categorias do WordPress agora.'
    }
  } else {
    avisoCategorias = 'As categorias vêm do WordPress, que não está configurado.'
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      {cabecalho}
      <EditorArtigo
        inicial={paraTela(montarVisao(artigo, keyword))}
        wpConfigurado={cfg !== null}
        iaConfigurada={iaConfigurada()}
        brevoConfigurado={brevoConfigurado()}
        categorias={categorias}
        avisoCategorias={avisoCategorias}
      />
    </div>
  )
}
