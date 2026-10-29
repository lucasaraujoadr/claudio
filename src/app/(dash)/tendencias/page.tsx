import { connection } from 'next/server'
import { desc, gte } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { tendencias, tesesSugeridas, type Tendencia, type TeseSugerida } from '@/lib/db/schema'
import { jaRodouHoje } from '@/lib/radar/executar'
import { carregarTermosEmAlta } from '@/lib/radar/repositorio'
import { MENSAGEM_SEM_GSC, MENSAGEM_SEM_JANELA, type TermosEmAlta } from '@/lib/radar/termos-em-alta'
import { Aviso as CaixaAviso, BotaoEnviar, CabecalhoPagina, Cartao, EstadoVazio, Selo, classesBotao, type TipoAviso, type VarianteSelo } from '@/components/ui'
import { carregarSincronizacoesSeguro } from '../_compartilhado/carregar'
import { formatarDataHora } from '../_compartilhado/sincronizacao'

export const metadata = { title: 'Tendências' }

const DIAS_TENDENCIAS = 14

type Aviso = { texto: string; tipo: TipoAviso; role: 'status' | 'alert' }

const AVISOS: Record<string, Record<string, Aviso>> = {
  atualizar: {
    ok: { texto: 'Radar atualizado.', tipo: 'sucesso', role: 'status' },
    'ja-rodou': { texto: 'O radar já foi atualizado com sucesso hoje. Para gastar mais uma busca, use "Atualizar mesmo assim".', tipo: 'info', role: 'status' },
    'sem-chave': { texto: 'Chave de IA não configurada (OPENROUTER_API_KEY). A busca na web exige OpenRouter.', tipo: 'erro', role: 'alert' },
    erro: { texto: 'A atualização falhou em pelo menos uma etapa. O que já foi gravado foi mantido; veja a última execução abaixo e tente novamente.', tipo: 'erro', role: 'alert' },
  },
  tese: {
    criado: { texto: 'Tema criado a partir da tese.', tipo: 'sucesso', role: 'status' },
    existia: { texto: 'Esse assunto já existia como tema. A tese foi marcada como aproveitada, sem criar duplicata.', tipo: 'info', role: 'status' },
    descartada: { texto: 'Tese descartada.', tipo: 'info', role: 'status' },
    'ja-tratada': { texto: 'Essa tese já tinha sido tratada.', tipo: 'info', role: 'status' },
    erro: { texto: 'Não foi possível concluir a ação. Tente novamente.', tipo: 'erro', role: 'alert' },
  },
}

const SELO_POTENCIAL: Record<TeseSugerida['potencial'], { variante: VarianteSelo; rotulo: string }> = {
  alto: { variante: 'sucesso', rotulo: 'Potencial alto' },
  medio: { variante: 'acento', rotulo: 'Potencial médio' },
  baixo: { variante: 'neutro', rotulo: 'Potencial baixo' },
}
const ROTULO_INTENCAO: Record<string, string> = {
  informacional: 'Informacional', comercial: 'Comercial', transacional: 'Transacional', navegacional: 'Navegacional',
}

function formatarData(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function dominio(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** Só http(s) vira link: o que está no banco já foi validado, mas a tela não confia em dado de fora. */
function linkSeguro(url: string): string | null {
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

function CartaoTendencia({ t }: { t: Tendencia }) {
  const href = linkSeguro(t.fonteUrl)
  return (
    <li className="space-y-1 px-5 py-3">
      <p className="font-medium text-tinta">{t.titulo}</p>
      <p className="text-sm text-tinta-suave">{t.resumo}</p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-tinta-suave">
        {t.publicadoEm ? <span>Publicado em {formatarData(t.publicadoEm)}</span> : <span>Data de publicação não informada</span>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-acento-texto underline-offset-2 hover:underline">
            Fonte: {dominio(href)} <span className="sr-only">(abre em nova aba)</span>
          </a>
        )}
      </p>
      {t.palavrasChave.length > 0 && (
        <p className="flex flex-wrap gap-1.5 pt-1">
          {t.palavrasChave.map((k) => (
            <Selo key={k} variante="neutro">{k}</Selo>
          ))}
        </p>
      )}
    </li>
  )
}

function CartaoTese({ t }: { t: TeseSugerida }) {
  const potencial = SELO_POTENCIAL[t.potencial]
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-medium text-tinta">
          {t.titulo}
          <Selo variante={potencial.variante}>{potencial.rotulo} · estimativa do modelo</Selo>
        </p>
        <p className="text-sm text-tinta-suave">{t.keyword} · {ROTULO_INTENCAO[t.intencao]}</p>
        <p className="text-sm text-tinta">{t.justificativa}</p>
        {t.sinais.length > 0 && <p className="text-xs text-tinta-suave">{t.sinais.join(' · ')}</p>}
      </div>
      <div className="flex items-center gap-2">
        <form method="POST" action="/api/teses/virar-tema">
          <input type="hidden" name="id" value={t.id} />
          <BotaoEnviar rotuloEnviando="Criando…" variante="primario" tamanho="sm">Virar tema</BotaoEnviar>
        </form>
        <form method="POST" action="/api/teses/descartar">
          <input type="hidden" name="id" value={t.id} />
          <button type="submit" className={classesBotao('secundario', 'sm')}>Descartar</button>
        </form>
      </div>
    </li>
  )
}

function TermosEmAltaBloco({ termos }: { termos: TermosEmAlta | null }) {
  if (!termos) return <p className="text-sm text-tinta-suave">Não foi possível ler o Search Console agora.</p>
  if (termos.estado === 'sem_dados') return <p className="text-sm text-tinta-suave">{MENSAGEM_SEM_GSC} As teses usam só os fatos recentes.</p>
  if (termos.estado === 'sem_janela_anterior') return <p className="text-sm text-tinta-suave">{MENSAGEM_SEM_JANELA}</p>
  if (termos.termos.length === 0) return <p className="text-sm text-tinta-suave">Nenhuma query aumentou as impressões em relação aos 28 dias anteriores.</p>
  return (
    <ul className="divide-y divide-borda text-sm">
      {termos.termos.map((t) => (
        <li key={t.query} className="flex justify-between gap-3 py-1.5">
          <span className="text-tinta">{t.query}</span>
          <span className="text-tinta-suave tabular-nums">{t.anterior.toLocaleString('pt-BR')} → {t.atual.toLocaleString('pt-BR')} (+{t.aumento.toLocaleString('pt-BR')})</span>
        </li>
      ))}
    </ul>
  )
}

export default async function TendenciasPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const sp = await searchParams
  const chaveAviso = (['atualizar', 'tese'] as const).find((k) => typeof sp[k] === 'string')
  let aviso = chaveAviso ? AVISOS[chaveAviso][sp[chaveAviso] as string] : undefined
  if (aviso && sp.atualizar === 'ok') {
    const nT = Number.parseInt(String(sp.tendencias ?? ''), 10)
    const nTe = Number.parseInt(String(sp.teses ?? ''), 10)
    if (Number.isInteger(nT) && Number.isInteger(nTe)) {
      aviso = { ...aviso, texto: `Radar atualizado: ${nT} ${nT === 1 ? 'tendência nova' : 'tendências novas'} e ${nTe} ${nTe === 1 ? 'tese nova' : 'teses novas'}.` }
    }
  }

  const db = getDb()
  const agora = new Date()
  const desde = new Date(agora.getTime() - DIAS_TENDENCIAS * 86_400_000)
  const [recentes, teses, sinc, termos] = await Promise.all([
    db.select().from(tendencias).where(gte(tendencias.coletadoEm, desde)).orderBy(desc(tendencias.coletadoEm), desc(tendencias.id)).limit(50),
    db.select().from(tesesSugeridas).orderBy(desc(tesesSugeridas.criadoEm), desc(tesesSugeridas.id)).limit(200),
    carregarSincronizacoesSeguro(),
    carregarTermosEmAlta().catch((e) => {
      console.error('tendencias: termos em alta falharam:', e instanceof Error ? e.name : 'erro')
      return null
    }),
  ])
  const ultima = sinc?.tendencias ?? null
  const rodouHoje = jaRodouHoje(ultima, agora)
  const novas = teses.filter((t) => t.status === 'nova')
  const tratadas = teses.filter((t) => t.status !== 'nova').length

  const linhaUltima = !sinc
    ? 'Não foi possível ler a última execução.'
    : !ultima
      ? 'Última execução: ainda não executada. O radar roda sozinho todo dia às 04:00 (Brasília).'
      : `Última execução: ${formatarDataHora(ultima.executadoEm)} · ${ultima.status === 'ok' ? `concluída${ultima.mensagem ? ` · ${ultima.mensagem}` : ''}` : 'falhou'}.`

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="SEO"
        titulo="Tendências"
        subtitulo="Fatos recentes de decisões, leis e índices, e teses de artigo sugeridas a partir deles."
        acoes={
          <form method="POST" action="/api/teses/atualizar" className="sm:text-right">
            {rodouHoje && <input type="hidden" name="forcar" value="1" />}
            <BotaoEnviar rotuloEnviando="Atualizando…" variante={rodouHoje ? 'secundario' : 'primario'}>
              {rodouHoje ? 'Atualizar mesmo assim' : 'Atualizar agora'}
            </BotaoEnviar>
            <p className="mt-1 max-w-64 text-xs text-tinta-suave">
              {rodouHoje ? 'Já atualizado hoje; outra atualização gasta mais uma busca e uma geração. ' : ''}
              Pode levar até 2 minutos.
            </p>
          </form>
        }
      />

      <p className="text-sm text-tinta-suave">{linhaUltima}</p>

      {aviso && (
        <CaixaAviso tipo={aviso.tipo} role={aviso.role}>
          {aviso.texto}
        </CaixaAviso>
      )}

      <Cartao titulo="Termos em alta no Search Console" descricao="Impressões dos últimos 28 dias contra os 28 anteriores, por query.">
        <TermosEmAltaBloco termos={termos} />
      </Cartao>

      <Cartao titulo="Teses sugeridas" descricao="O potencial é uma estimativa qualitativa do modelo, não uma medição de volume de busca." semPreenchimento>
        {novas.length === 0 ? (
          <div className="p-5">
            <EstadoVazio
              titulo={teses.length === 0 ? 'Nenhuma tese sugerida ainda' : 'Nenhuma tese nova'}
              explicacao={
                teses.length === 0
                  ? 'As teses surgem depois da primeira atualização, a partir dos fatos recentes e dos termos em alta.'
                  : `Todas as ${tratadas} teses sugeridas já foram tratadas. Novas aparecem na próxima atualização.`
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-borda">{novas.map((t) => <CartaoTese key={t.id} t={t} />)}</ul>
        )}
      </Cartao>

      <Cartao titulo="Fatos recentes" descricao={`Coletados nos últimos ${DIAS_TENDENCIAS} dias, só com fonte citada pelo provedor de busca.`} semPreenchimento>
        {recentes.length === 0 ? (
          <div className="p-5">
            <EstadoVazio
              titulo="Nenhuma tendência coletada"
              explicacao="Use “Atualizar agora” para buscar decisões, leis e índices dos últimos 7 dias. Itens sem fonte verificável são descartados."
            />
          </div>
        ) : (
          <ul className="divide-y divide-borda">{recentes.map((t) => <CartaoTendencia key={t.id} t={t} />)}</ul>
        )}
      </Cartao>
    </div>
  )
}
