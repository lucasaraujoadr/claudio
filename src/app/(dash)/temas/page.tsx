import { connection } from 'next/server'
import { asc, desc } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { clusters, topics, type Topic } from '@/lib/db/schema'
import { padraoUrlPublicada, siteUrl } from '@/lib/site'
import { Aviso as CaixaAviso, BotaoEnviar, CabecalhoPagina, Cartao, EstadoVazio, Selo, classesBotao, cx, type TipoAviso, type VarianteSelo } from '@/components/ui'
import { classesCampo } from '@/components/ui/campo'

export const metadata = { title: 'Temas' }

type Aviso = { texto: string; classe: TipoAviso; role: 'status' | 'alert' }
const VERDE: TipoAviso = 'sucesso'
const AZUL: TipoAviso = 'info'
const VERMELHO: TipoAviso = 'erro'

const AVISOS: Record<string, Record<string, Aviso>> = {
  pesquisa: {
    ok: { texto: 'Pesquisa concluída. Novos clusters e temas foram adicionados.', classe: VERDE, role: 'status' },
    vazio: { texto: 'A pesquisa não trouxe temas novos: todos já existiam.', classe: AZUL, role: 'status' },
    'sem-chave': { texto: 'Chave de IA não configurada (OPENROUTER_API_KEY). Defina a chave nas variáveis de ambiente para pesquisar temas.', classe: VERMELHO, role: 'alert' },
    erro: { texto: 'Não foi possível pesquisar temas. Nada foi gravado; tente novamente.', classe: VERMELHO, role: 'alert' },
  },
  briefing: {
    'sem-chave': { texto: 'Chave de IA não configurada (OPENROUTER_API_KEY). Defina a chave nas variáveis de ambiente para gerar briefings.', classe: VERMELHO, role: 'alert' },
    'ja-briefado': { texto: 'Este tema já tinha briefing. Nada novo foi gravado.', classe: AZUL, role: 'status' },
    'nao-escolhido': { texto: 'Só temas escolhidos podem receber briefing.', classe: VERMELHO, role: 'alert' },
    erro: { texto: 'Não foi possível gerar o briefing. Nada foi gravado; tente novamente.', classe: VERMELHO, role: 'alert' },
  },
  status: {
    escolhido: { texto: 'Tema marcado como escolhido.', classe: VERDE, role: 'status' },
    publicado: { texto: 'Tema marcado como publicado.', classe: VERDE, role: 'status' },
    'url-invalida': { texto: `URL inválida. Informe uma URL ${siteUrl()}/...`, classe: VERMELHO, role: 'alert' },
    erro: { texto: 'Não foi possível mudar o status do tema.', classe: VERMELHO, role: 'alert' },
  },
}


const STATUS = ['ideia', 'escolhido', 'briefado', 'publicado'] as const
type Status = (typeof STATUS)[number]
const ROTULO_STATUS: Record<Status, string> = { ideia: 'Ideia', escolhido: 'Escolhido', briefado: 'Briefado', publicado: 'Publicado' }
const ROTULO_INTENCAO: Record<string, string> = {
  informacional: 'Informacional', comercial: 'Comercial', transacional: 'Transacional', navegacional: 'Navegacional',
}
const ROTULO_PRIORIDADE: Record<string, string> = { alta: 'Alta', media: 'Média', baixa: 'Baixa' }
/** Estágio do tema: identidade pelo texto; em andamento em dourado, publicado com o tom de concluído. */
const SELO_STATUS: Record<Status, VarianteSelo> = { ideia: 'neutro', escolhido: 'acento', briefado: 'acento', publicado: 'sucesso' }

function ehStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUS as readonly string[]).includes(v)
}

function Acao({ t }: { t: Topic }) {
  if (t.status === 'ideia') {
    return (
      <form method="POST" action="/api/temas/status">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="para" value="escolhido" />
        <button type="submit" className={classesBotao('secundario', 'sm')}>
          Escolher
        </button>
      </form>
    )
  }
  if (t.status === 'escolhido') {
    return (
      <form method="POST" action="/api/briefings/gerar" className="text-right">
        <input type="hidden" name="id" value={t.id} />
        <BotaoEnviar rotuloEnviando="Gerando…" variante="primario" tamanho="sm">
          Gerar briefing
        </BotaoEnviar>
        <p className="mt-1 max-w-56 text-xs text-tinta-suave">
          Pode levar até 2 minutos (mais, se o modelo precisar de uma segunda tentativa).
        </p>
      </form>
    )
  }
  if (t.status === 'briefado') {
    return (
      <div className="space-y-2">
        <a href={`/briefings?tema=${t.id}`} className="text-sm font-medium text-acento-texto underline-offset-2 hover:underline">Ver briefing</a>
      <form method="POST" action="/api/temas/status" className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={t.id} />
        <input type="hidden" name="para" value="publicado" />
        <label className="sr-only" htmlFor={`url-${t.id}`}>URL publicada</label>
        <input
          id={`url-${t.id}`}
          name="url"
          type="url"
          required
          pattern={padraoUrlPublicada()}
          placeholder={`${siteUrl()}/...`}
          className={classesCampo('h-8 w-64 py-1')}
        />
        <button type="submit" className={classesBotao('secundario', 'sm')}>
          Marcar como publicado
        </button>
      </form>
      </div>
    )
  }
  if (t.status === 'publicado' && t.urlPublicada) {
    return (
      <div className="flex flex-col items-end gap-1.5 text-right">
        <a href={t.urlPublicada} target="_blank" rel="noopener noreferrer" className="text-sm font-medium break-all text-acento-texto underline-offset-2 hover:underline">
          Ver página
        </a>
        {/* Nutrição com o blog (E9): leva à tela do rascunho; nada é enviado. */}
        <a href={`/temas/${t.id}/campanha`} className={classesBotao('secundario', 'sm')}>
          Criar rascunho de campanha no Brevo
        </a>
      </div>
    )
  }
  return null
}

function ListaTemas({ itens }: { itens: Topic[] }) {
  return (
    <ul className="divide-y divide-borda">
      {itens.map((t) => (
        <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 font-medium text-tinta">
              {t.titulo}
              <Selo variante={SELO_STATUS[t.status]}>{ROTULO_STATUS[t.status]}</Selo>
            </p>
            <p className="mt-0.5 text-sm text-tinta-suave">
              {t.keyword} · {ROTULO_INTENCAO[t.intencao]} · Prioridade {ROTULO_PRIORIDADE[t.prioridade].toLowerCase()}
            </p>
          </div>
          <Acao t={t} />
        </li>
      ))}
    </ul>
  )
}

export default async function TemasPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const sp = await searchParams
  let aviso: Aviso | undefined =
    typeof sp.pesquisa === 'string'
      ? AVISOS.pesquisa[sp.pesquisa]
      : typeof sp.status === 'string'
        ? AVISOS.status[sp.status]
        : typeof sp.briefing === 'string'
          ? AVISOS.briefing[sp.briefing]
          : undefined
  if (sp.pesquisa === 'ok') {
    const novos = typeof sp.novos === 'string' ? Number.parseInt(sp.novos, 10) : NaN
    if (Number.isInteger(novos) && novos > 0) {
      aviso = {
        ...AVISOS.pesquisa.ok,
        texto: `Pesquisa concluída: ${novos} ${novos === 1 ? 'tema novo foi adicionado' : 'temas novos foram adicionados'}.`,
      }
    }
  }
  const filtro = ehStatus(sp.filtro) ? sp.filtro : undefined

  const db = getDb()
  const todosClusters = await db.select().from(clusters).orderBy(desc(clusters.criadoEm), asc(clusters.id))
  const todosTemas = await db.select().from(topics).orderBy(asc(topics.id))
  const visiveis = filtro ? todosTemas.filter((t) => t.status === filtro) : todosTemas

  const grupos = todosClusters
    .map((c) => ({ cluster: c, itens: visiveis.filter((t) => t.clusterId === c.id) }))
    .filter((g) => g.itens.length > 0)
  const semCluster = visiveis.filter((t) => t.clusterId === null)

  const pilula = (ativo: boolean) =>
    cx(
      'inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors',
      ativo ? 'border-acento bg-acento-suave font-semibold text-tinta' : 'border-borda bg-superficie text-tinta-suave hover:bg-elevada hover:text-tinta',
    )

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="SEO"
        titulo="Temas"
        subtitulo="Clusters de conteúdo e temas, do primeiro rascunho até a publicação."
        acoes={
          <form method="POST" action="/api/temas/pesquisar" className="sm:text-right">
            <BotaoEnviar rotuloEnviando="Gerando…">Pesquisar temas</BotaoEnviar>
            <p className="mt-1 text-xs text-tinta-suave">A pesquisa pode levar até 2 minutos.</p>
          </form>
        }
      />

      {aviso && (
        <CaixaAviso tipo={aviso.classe} role={aviso.role}>
          {aviso.texto}
        </CaixaAviso>
      )}

      {todosTemas.length === 0 ? (
        <EstadoVazio
          titulo="Nenhum tema ainda"
          explicacao={<>Use &ldquo;Pesquisar temas&rdquo; para gerar clusters com IA ou crie temas a partir das oportunidades.</>}
        />
      ) : (
        <>
          <nav aria-label="Filtro por status" className="flex flex-wrap gap-2">
            <a href="/temas" aria-current={!filtro ? 'page' : undefined} className={pilula(!filtro)}>
              Todos
            </a>
            {STATUS.map((s) => (
              <a key={s} href={`/temas?filtro=${s}`} aria-current={filtro === s ? 'page' : undefined} className={pilula(filtro === s)}>
                {ROTULO_STATUS[s]}
              </a>
            ))}
          </nav>

          {visiveis.length === 0 ? (
            <EstadoVazio titulo="Nenhum tema com esse status" explicacao="Escolha outro filtro para ver os demais temas." />
          ) : (
            <div className="space-y-6">
              {grupos.map(({ cluster, itens }) => (
                <Cartao
                  key={cluster.id}
                  titulo={cluster.nome}
                  descricao={`Pilar: ${cluster.keywordPilar} · ${ROTULO_INTENCAO[cluster.intencao]} · Prioridade ${ROTULO_PRIORIDADE[cluster.prioridade].toLowerCase()}`}
                  semPreenchimento
                >
                  <ListaTemas itens={itens} />
                </Cartao>
              ))}
              {semCluster.length > 0 && (
                <Cartao titulo="Sem cluster" descricao="Temas criados a partir de oportunidades do Search Console." semPreenchimento>
                  <ListaTemas itens={semCluster} />
                </Cartao>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
