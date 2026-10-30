import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Aviso, CabecalhoPagina, Selo } from '@/components/ui'
import { acessoPublicoOk } from '@/lib/acesso-publico'
import { iaConfigurada } from '@/lib/ai/cliente'
import { obterArtigo } from '@/lib/artigos/repositorio'
import { idDaRota, keywordDoTema } from '@/lib/artigos/visao'
import { carregarArtigoParaPecas } from '@/lib/distribuicao/gerar'
import { contarDestinatariosNewsletter, montarNewsletter, ultimoEnvioDaPeca } from '@/lib/distribuicao/newsletter'
import { pecasDoArtigo } from '@/lib/distribuicao/repositorio'
import { LIMITES, newsletterEstrito } from '@/lib/distribuicao/schemas'
import { configResend } from '@/lib/resend'
import { siteUrl } from '@/lib/site'
import { SELO_SITUACAO } from '../../situacao'
import { AbasArtigo } from '../abas-artigo'
import { AbaDistribuicao } from './aba-distribuicao'
import { envioParaTela, pecaParaTela, type NewsletterTela } from './tipos'

export const metadata = { title: 'Distribuição do artigo' }

/** Mesmo link que `criarRascunhoNewsletter` usa: o do WordPress ou o do slug no site. */
function linkDoArtigo(a: { wpLink: string | null; slug: string | null }): string {
  const slug = a.slug?.trim()
  return a.wpLink?.trim() || (slug ? `${siteUrl()}/${slug}/` : `${siteUrl()}/`)
}

/** HTML do email a partir da peça salva, para a prévia em iframe sandbox. Null se a peça está incompleta. */
function previaDaNewsletter(conteudo: unknown, artigo: { wpLink: string | null; slug: string | null }): string | null {
  const p = newsletterEstrito.safeParse(conteudo)
  if (!p.success) return null
  try {
    return montarNewsletter(p.data, { link: linkDoArtigo(artigo), slug: artigo.slug?.trim() || 'newsletter' }).html
  } catch {
    return null
  }
}

/** Tudo o que a aba precisa, já no formato da tela. Null se o artigo não existe. */
async function carregarTela(id: number) {
  const artigo = await obterArtigo(id)
  if (!artigo) return null
  const [keyword, pecas, carregado] = await Promise.all([keywordDoTema(artigo.topicId), pecasDoArtigo(id), carregarArtigoParaPecas(id)])
  const pecaNews = pecas.find((p) => p.tipo === 'newsletter')
  const [envio, destinatarios, acessoPublico] = await Promise.all([
    pecaNews ? ultimoEnvioDaPeca(pecaNews.id) : Promise.resolve(null),
    contarDestinatariosNewsletter(),
    acessoPublicoOk().catch(() => false),
  ])
  const newsletter: NewsletterTela = {
    envio: envio ? envioParaTela(envio) : null,
    destinatarios,
    previaHtml: pecaNews ? previaDaNewsletter(pecaNews.conteudo, artigo) : null,
    resendConfigurado: configResend() !== null,
    acessoPublico,
  }
  return {
    artigo,
    keyword,
    pecas: pecas.map(pecaParaTela),
    bloqueio: carregado.tipo === 'recusado' ? carregado.mensagem : null,
    newsletter,
  }
}

export default async function DistribuicaoArtigoPage({ params }: { params: Promise<{ id: string }> }) {
  await connection()
  const id = idDaRota((await params).id)
  if (!id) notFound()

  const secao = (
    <Link href="/artigos" className="hover:underline">
      SEO · Artigos
    </Link>
  )

  let dados: Awaited<ReturnType<typeof carregarTela>>
  try {
    dados = await carregarTela(id)
  } catch (e) {
    console.error('distribuicao: leitura da tela falhou:', e instanceof Error ? e.name : 'erro')
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <CabecalhoPagina secao={secao} titulo="Distribuição" />
        <Aviso tipo="erro" titulo="Não foi possível ler as peças">
          O banco não respondeu. Recarregue a página.
        </Aviso>
      </div>
    )
  }

  if (!dados) notFound()
  const { artigo, keyword } = dados
  const selo = SELO_SITUACAO[artigo.situacao]
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <CabecalhoPagina
        secao={secao}
        titulo={artigo.titulo?.trim() || 'Artigo'}
        subtitulo={
          <span className="flex flex-wrap items-center gap-2">
            <Selo variante={selo.variante}>{selo.rotulo}</Selo>
            {keyword && <span>Palavra-chave: {keyword}</span>}
          </span>
        }
      />
      <AbasArtigo artigoId={artigo.id} situacao={artigo.situacao} atual="distribuicao" />
      <AbaDistribuicao
        artigoId={artigo.id}
        pecas={dados.pecas}
        bloqueio={dados.bloqueio}
        iaConfigurada={iaConfigurada()}
        limites={LIMITES}
        newsletter={dados.newsletter}
      />
    </div>
  )
}
