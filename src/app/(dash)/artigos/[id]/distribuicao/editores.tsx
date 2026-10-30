'use client'

import { useId, useState } from 'react'
import { Aviso, classesBotao, cx } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import type { Carrossel, LinkedinArtigo, LinkedinPost, Newsletter } from '@/lib/distribuicao/schemas'
import { Contador } from '../contador'
import { BotaoCopiar, linhas, semVazios } from './comuns'
import type { Limites } from './tipos'

// ---------------------------------------------------------------------------
// Conferência leve do formato (o schema estrito fica no servidor; este arquivo vai ao navegador).
// ---------------------------------------------------------------------------

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const textos = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

export function ehLinkedinArtigo(v: unknown): v is LinkedinArtigo {
  return obj(v) && typeof v.titulo === 'string' && Array.isArray(v.blocos)
}
export function ehPost(v: unknown): v is LinkedinPost {
  return obj(v) && typeof v.texto === 'string' && textos(v.hashtags)
}
export function ehCarrossel(v: unknown): v is Carrossel {
  return obj(v) && Array.isArray(v.laminas) && typeof v.legenda === 'string'
}
export function ehNewsletter(v: unknown): v is Newsletter {
  return obj(v) && typeof v.assunto === 'string' && typeof v.abertura === 'string' && textos(v.pontos)
}

/** Campo de texto com rótulo e contador; `linhas > 1` vira textarea. */
function Campo({
  rotulo,
  valor,
  max,
  min,
  rows = 1,
  ajuda,
  aoMudar,
}: {
  rotulo: string
  valor: string
  max?: number
  min?: number
  rows?: number
  ajuda?: string
  aoMudar: (v: string) => void
}) {
  const id = useId()
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className={CLASSES_ROTULO}>
          {rotulo}
        </label>
        {max !== undefined && <Contador valor={valor.trim().length} min={min ?? 1} max={max} />}
      </div>
      {rows > 1 ? (
        <textarea id={id} value={valor} rows={rows} onChange={(e) => aoMudar(e.target.value)} className={classesCampo('mt-1')} />
      ) : (
        <input id={id} value={valor} onChange={(e) => aoMudar(e.target.value)} className={classesCampo('mt-1')} />
      )}
      {ajuda && <p className="mt-1 text-xs text-tinta-suave">{ajuda}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// LinkedIn — artigo
// ---------------------------------------------------------------------------

type BlocoEdicao = { tipo: 'paragrafo' | 'h2'; texto: string } | { tipo: 'lista'; itens: string[] }

function normalizarArtigo(titulo: string, subtitulo: string, blocos: BlocoEdicao[]): LinkedinArtigo {
  return {
    titulo,
    subtitulo: subtitulo.trim() ? subtitulo : null,
    blocos: blocos.map((b) => (b.tipo === 'lista' ? { tipo: 'lista', itens: semVazios(b.itens) } : b)),
  }
}

export function textoLinkedinArtigo(a: LinkedinArtigo): string {
  const partes = [a.titulo, a.subtitulo ?? '']
  for (const b of a.blocos) partes.push(b.tipo === 'lista' ? b.itens.map((i) => `• ${i}`).join('\n') : b.texto)
  return partes.filter((p) => p.trim()).join('\n\n')
}

const palavras = (t: string) => t.split(/\s+/).filter(Boolean).length

export function EditorLinkedinArtigo({ inicial, limites, alterar }: { inicial: LinkedinArtigo; limites: Limites; alterar: (c: LinkedinArtigo) => void }) {
  const [titulo, setTitulo] = useState(inicial.titulo)
  const [subtitulo, setSubtitulo] = useState(inicial.subtitulo ?? '')
  const [blocos, setBlocos] = useState<BlocoEdicao[]>(inicial.blocos)
  const L = limites.artigo
  const atual = normalizarArtigo(titulo, subtitulo, blocos)
  const total = blocos.reduce((n, b) => n + palavras(b.tipo === 'lista' ? b.itens.join(' ') : b.texto), 0)
  const fora = total < L.palavrasMin || total > L.palavrasMax

  function mudar(t: string, s: string, bl: BlocoEdicao[]) {
    setTitulo(t)
    setSubtitulo(s)
    setBlocos(bl)
    alterar(normalizarArtigo(t, s, bl))
  }
  const mudarBloco = (i: number, b: BlocoEdicao) => mudar(titulo, subtitulo, blocos.map((x, j) => (j === i ? b : x)))

  return (
    <div className="space-y-4">
      <Campo rotulo="Título" valor={titulo} max={L.titulo} aoMudar={(v) => mudar(v, subtitulo, blocos)} />
      <Campo rotulo="Subtítulo (opcional)" valor={subtitulo} max={L.subtitulo} min={0} aoMudar={(v) => mudar(titulo, v, blocos)} />
      <div className="space-y-3">
        <p className="flex flex-wrap items-baseline justify-between gap-2">
          <span className={CLASSES_ROTULO}>Texto, por blocos</span>
          <span className={cx('text-xs tabular-nums', fora ? 'font-semibold text-aviso' : 'text-tinta-suave')}>
            {total} palavras (previsto: {L.palavrasMin} a {L.palavrasMax})
          </span>
        </p>
        {blocos.map((b, i) =>
          b.tipo === 'lista' ? (
            <Campo
              key={i}
              rotulo={`Bloco ${i + 1}: lista`}
              ajuda="Um item por linha."
              rows={Math.max(3, b.itens.length + 1)}
              valor={b.itens.join('\n')}
              aoMudar={(v) => mudarBloco(i, { tipo: 'lista', itens: linhas(v) })}
            />
          ) : (
            <Campo
              key={i}
              rotulo={`Bloco ${i + 1}: ${b.tipo === 'h2' ? 'intertítulo' : 'parágrafo'}`}
              rows={b.tipo === 'h2' ? 1 : 4}
              valor={b.texto}
              aoMudar={(v) => mudarBloco(i, { tipo: b.tipo, texto: v })}
            />
          ),
        )}
      </div>
      <BotaoCopiar texto={textoLinkedinArtigo(atual)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// LinkedIn — post
// ---------------------------------------------------------------------------

const lerHashtags = (t: string) => t.split(/[\s,]+/).map((h) => h.replace(/#/g, '')).filter(Boolean)

export function textoPost(p: LinkedinPost): string {
  return `${p.texto.trim()}\n\n${p.hashtags.map((h) => `#${h}`).join(' ')}`
}

export function EditorPost({ inicial, limites, alterar }: { inicial: LinkedinPost; limites: Limites; alterar: (c: LinkedinPost) => void }) {
  const [texto, setTexto] = useState(inicial.texto)
  const [hashtags, setHashtags] = useState(inicial.hashtags.map((h) => `#${h}`).join(' '))
  const L = limites.post
  const idTexto = useId()
  const lidas = lerHashtags(hashtags)
  const atual = { texto, hashtags: lidas }

  function mudar(t: string, h: string) {
    setTexto(t)
    setHashtags(h)
    alterar({ texto: t, hashtags: lerHashtags(h) })
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={idTexto} className={CLASSES_ROTULO}>
            Texto do post
          </label>
          <Contador valor={texto.length} min={1} max={L.texto} />
        </div>
        <textarea id={idTexto} value={texto} rows={10} onChange={(e) => mudar(e.target.value, hashtags)} className={classesCampo('mt-1')} />
      </div>
      <Campo
        rotulo="Hashtags"
        valor={hashtags}
        ajuda={`${lidas.length} de ${L.hashtagsMin} a ${L.hashtagsMax} hashtags, separadas por espaço.`}
        aoMudar={(v) => mudar(texto, v)}
      />
      <BotaoCopiar texto={textoPost(atual)} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Carrossel
// ---------------------------------------------------------------------------

type LaminaEdicao = Carrossel['laminas'][number]

function normalizarLaminas(laminas: LaminaEdicao[]): LaminaEdicao[] {
  return laminas.map((l) => {
    if (l.tipo === 'capa') return { ...l, subtitulo: l.subtitulo?.trim() ? l.subtitulo : null }
    if (l.tipo === 'conteudo') {
      const itens = l.itens ? semVazios(l.itens) : []
      return { ...l, texto: l.texto?.trim() ? l.texto : null, itens: itens.length ? itens : null }
    }
    return l
  })
}

export function EditorCarrossel({
  pecaId,
  inicial,
  limites,
  variacao,
  versaoArte,
  laminasLongas,
  trocandoVariacao,
  alterar,
  aoVariacao,
}: {
  pecaId: number
  inicial: Carrossel
  limites: Limites
  variacao: 'escura' | 'clara'
  /** Muda quando a peça é salva: invalida o cache das miniaturas. */
  versaoArte: number
  laminasLongas: number[]
  trocandoVariacao: boolean
  alterar: (c: Carrossel) => void
  aoVariacao: (v: 'escura' | 'clara') => void
}) {
  const [laminas, setLaminas] = useState<LaminaEdicao[]>(inicial.laminas)
  const [legenda, setLegenda] = useState(inicial.legenda)
  const L = limites.carrossel
  const nomeVariacao = useId()

  function mudar(ls: LaminaEdicao[], leg: string) {
    setLaminas(ls)
    setLegenda(leg)
    alterar({ laminas: normalizarLaminas(ls), legenda: leg })
  }
  const mudarLamina = (i: number, l: LaminaEdicao) => mudar(laminas.map((x, j) => (j === i ? l : x)), legenda)
  const base = `/api/distribuicao/pecas/${pecaId}`

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex flex-wrap items-center gap-3" disabled={trocandoVariacao}>
          <legend className="sr-only">Variação da arte</legend>
          <span className={CLASSES_ROTULO} aria-hidden>
            Variação:
          </span>
          {(
            [
              ['escura', 'Escura'],
              ['clara', 'Clara'],
            ] as const
          ).map(([v, rotulo]) => (
            <label key={v} className="inline-flex items-center gap-1.5 text-sm text-tinta">
              <input type="radio" name={nomeVariacao} value={v} checked={variacao === v} onChange={() => aoVariacao(v)} className="accent-acento" />
              {rotulo}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap gap-2">
          <a href={`${base}/pdf`} download className={classesBotao('secundario', 'sm')}>
            Baixar PDF (LinkedIn)
          </a>
          <a href={`${base}/zip`} download className={classesBotao('secundario', 'sm')}>
            Baixar PNGs (.zip)
          </a>
        </div>
      </div>

      <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Miniaturas das lâminas (última versão salva)">
        {laminas.map((_, i) => {
          const n = i + 1
          const longa = laminasLongas.includes(n)
          return (
            <li key={i} className="min-w-0">
              <figure className={cx('overflow-hidden rounded-md border', longa ? 'border-aviso-borda ring-2 ring-aviso' : 'border-borda')}>
                {/* PNG gerado pela rota da arte; next/image não ajuda numa imagem dinâmica do próprio painel. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`${base}/lamina/${n}?v=${versaoArte}`}
                  alt={`Lâmina ${n}`}
                  width={1080}
                  height={1350}
                  loading="lazy"
                  className="block h-auto w-full bg-elevada"
                />
                <figcaption className="flex items-center justify-between gap-1 px-2 py-1 text-xs text-tinta-suave">
                  <span>Lâmina {n}</span>
                  {longa && <span className="font-semibold text-aviso">texto não cabe</span>}
                </figcaption>
              </figure>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-tinta-suave">As miniaturas mostram a última versão salva, na variação escolhida.</p>

      <div className="space-y-3">
        {laminas.map((l, i) => {
          const n = i + 1
          const longa = laminasLongas.includes(n)
          const rotulo = l.tipo === 'capa' ? 'capa' : l.tipo === 'chamada' ? 'chamada final' : 'conteúdo'
          return (
            <fieldset key={i} aria-label={`Lâmina ${n}`} className="min-w-0 space-y-3 rounded-lg border border-borda p-3">
              <legend className="px-1 text-sm font-semibold text-tinta">
                Lâmina {n} <span className="font-normal text-tinta-suave">({rotulo})</span>
              </legend>
              {longa && (
                <Aviso tipo="alerta" role={null}>
                  O texto não cabe na lâmina {n}. Encurte o título, o texto ou os itens.
                </Aviso>
              )}
              {l.tipo === 'capa' && (
                <>
                  <Campo rotulo="Título" valor={l.titulo} max={L.capaTitulo} aoMudar={(v) => mudarLamina(i, { ...l, titulo: v })} />
                  <Campo
                    rotulo="Subtítulo (opcional)"
                    valor={l.subtitulo ?? ''}
                    max={L.capaSubtitulo}
                    min={0}
                    aoMudar={(v) => mudarLamina(i, { ...l, subtitulo: v })}
                  />
                </>
              )}
              {l.tipo === 'conteudo' && (
                <>
                  <Campo rotulo="Título" valor={l.titulo} max={L.titulo} aoMudar={(v) => mudarLamina(i, { ...l, titulo: v })} />
                  <Campo rotulo="Texto" rows={3} valor={l.texto ?? ''} max={L.texto} min={0} aoMudar={(v) => mudarLamina(i, { ...l, texto: v })} />
                  <Campo
                    rotulo="Itens (opcional)"
                    rows={3}
                    valor={(l.itens ?? []).join('\n')}
                    ajuda={`Um item por linha; até ${L.itens} itens de ${L.item} caracteres.`}
                    aoMudar={(v) => mudarLamina(i, { ...l, itens: v ? linhas(v) : null })}
                  />
                </>
              )}
              {l.tipo === 'chamada' && (
                <Campo rotulo="Texto" rows={2} valor={l.texto} max={L.chamada} aoMudar={(v) => mudarLamina(i, { ...l, texto: v })} />
              )}
            </fieldset>
          )
        })}
      </div>

      <Campo rotulo="Legenda do post" rows={5} valor={legenda} max={L.legenda} aoMudar={(v) => mudar(laminas, v)} />
      <BotaoCopiar texto={legenda.trim()} rotulo="Copiar legenda" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Newsletter (campos; a prévia e o envio ficam no cartão)
// ---------------------------------------------------------------------------

export function EditorNewsletter({ inicial, limites, alterar }: { inicial: Newsletter; limites: Limites; alterar: (c: Newsletter) => void }) {
  const [n, setN] = useState({ ...inicial })
  const L = limites.newsletter
  const qtd = semVazios(n.pontos).length

  function mudar(novo: Newsletter) {
    setN(novo)
    alterar({ ...novo, pontos: semVazios(novo.pontos) })
  }

  return (
    <div className="space-y-4">
      <Campo rotulo="Assunto" valor={n.assunto} max={L.assunto} aoMudar={(v) => mudar({ ...n, assunto: v })} />
      <Campo rotulo="Pré-cabeçalho" valor={n.preCabecalho} max={L.preCabecalho} ajuda="Aparece ao lado do assunto na caixa de entrada." aoMudar={(v) => mudar({ ...n, preCabecalho: v })} />
      <Campo rotulo="Abertura" rows={4} valor={n.abertura} max={L.abertura} aoMudar={(v) => mudar({ ...n, abertura: v })} />
      <Campo
        rotulo="Pontos principais"
        rows={6}
        valor={n.pontos.join('\n')}
        ajuda={`Um por linha: ${qtd} de ${L.pontosMin} a ${L.pontosMax}, até ${L.ponto} caracteres cada.`}
        aoMudar={(v) => mudar({ ...n, pontos: linhas(v) })}
      />
    </div>
  )
}
