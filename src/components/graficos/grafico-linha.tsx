'use client'

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CELULA_NUMERICA, Tabela } from '@/components/ui/tabela'
import { cx } from '@/components/ui/cx'
import {
  caminhoArea,
  caminhoLinha,
  formatarCompacto,
  formatarDataIso,
  formatarDiaMes,
  indiceMaisProximo,
  indicesRotulosX,
  ticksEixo,
} from './serie'

export type SerieLinha = {
  id: string
  rotulo: string
  /** Posição na paleta categórica (série 1 = dourado da marca, série 2 = violeta). */
  cor: 1 | 2
  /** Um valor por data; `null` = sem dado naquele dia (lacuna, nunca zero). */
  valores: (number | null)[]
}

export type GraficoLinhaProps = {
  /** Nome acessível do gráfico (e legenda da tabela equivalente). */
  titulo: string
  /** Resumo em texto do que o gráfico mostra, lido por leitores de tela. */
  resumo: string
  /** Datas ISO (`AAAA-MM-DD`), uma por ponto, em ordem. */
  datas: string[]
  series: SerieLinha[]
  /** Unidade dos valores, no plural: "sessões". */
  unidade: string
  /** Altura da área do gráfico, em px (inclui o eixo X). */
  altura?: number
  className?: string
}

const CLASSE_COR = {
  1: { linha: 'stroke-serie-1', area: 'fill-serie-1', ponto: 'fill-serie-1', chave: 'bg-serie-1' },
  2: { linha: 'stroke-serie-2', area: 'fill-serie-2', ponto: 'fill-serie-2', chave: 'bg-serie-2' },
} as const

const MARGEM = { topo: 14, direita: 44, base: 26, esquerda: 40 }
const fmt = (n: number) => n.toLocaleString('pt-BR')

/**
 * Gráfico de linhas em SVG próprio (sem biblioteca): marcas finas, grade discreta,
 * crosshair com dica no ponteiro e no teclado (setas, Home, End), lacunas onde não há
 * dado e uma tabela equivalente logo abaixo. As cores vêm dos tokens `--og-serie-*`,
 * então o gráfico acompanha o tema sem JavaScript.
 */
export function GraficoLinha({ titulo, resumo, datas, series, unidade, altura = 220, className }: GraficoLinhaProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Null até medir o contêiner: nada é desenhado esticado; a altura já fica reservada.
  const [medida, setMedida] = useState<number | null>(null)
  const [indice, setIndice] = useState<number | null>(null)
  const [anuncio, setAnuncio] = useState('')
  const idResumo = useId()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const medir = () => setMedida(Math.max(260, Math.round(el.getBoundingClientRect().width)))
    medir()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const largura = medida ?? 640
  const total = datas.length
  const maximo = Math.max(0, ...series.flatMap((s) => s.valores.filter((v): v is number => v !== null)))
  const ticks = ticksEixo(maximo, altura < 180 ? 3 : 4)
  const topoEscala = ticks[ticks.length - 1] || 1
  const x0 = MARGEM.esquerda
  const larguraPlot = Math.max(1, largura - MARGEM.esquerda - MARGEM.direita)
  const base = altura - MARGEM.base
  const alturaPlot = base - MARGEM.topo
  const x = (i: number) => x0 + (total <= 1 ? larguraPlot / 2 : (i / (total - 1)) * larguraPlot)
  const y = (v: number) => base - (v / topoEscala) * alturaPlot
  const rotulosX = indicesRotulosX(total, largura < 480 ? 3 : 6)

  function textoDoPonto(i: number): string {
    const partes = series.map((s) => {
      const v = s.valores[i]
      return `${s.rotulo}: ${v === null ? 'sem dado' : `${fmt(v)} ${unidade}`}`
    })
    return `${formatarDataIso(datas[i])}. ${partes.join('; ')}.`
  }

  function aoMover(e: PointerEvent<SVGRectElement>) {
    const caixa = e.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!caixa) return
    const px = ((e.clientX - caixa.left) / caixa.width) * largura
    setIndice(indiceMaisProximo(px, total, x0, larguraPlot))
  }

  function aoTeclar(e: KeyboardEvent<HTMLDivElement>) {
    if (total === 0) return
    const atual = indice ?? total - 1
    const proximo =
      e.key === 'ArrowLeft' ? Math.max(0, atual - 1)
      : e.key === 'ArrowRight' ? Math.min(total - 1, atual + 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? total - 1
      : null
    if (proximo === null) return
    e.preventDefault()
    setIndice(proximo)
    setAnuncio(textoDoPonto(proximo))
  }

  // Último ponto com valor de cada série: marcador final e rótulo direto (só da série 1).
  const finais = series.map((s) => {
    for (let i = s.valores.length - 1; i >= 0; i--) {
      const v = s.valores[i]
      if (v !== null) return { i, v }
    }
    return null
  })

  const dica = indice !== null && total > 0 ? indice : null
  const dicaNaDireita = dica !== null && x(dica) < largura * 0.6

  return (
    <figure className={cx('min-w-0', className)}>
      {series.length > 1 && (
        <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-tinta-suave" aria-label="Legenda">
          {series.map((s) => (
            <li key={s.id} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cx('h-0.5 w-4 rounded-full', CLASSE_COR[s.cor].chave)} />
              {s.rotulo}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label={`${titulo}. Use as setas para percorrer os dias.`}
        aria-describedby={idResumo}
        onKeyDown={aoTeclar}
        onFocus={() => setIndice((i) => i ?? (total > 0 ? total - 1 : null))}
        onBlur={() => setIndice(null)}
        style={{ height: altura }}
        className="relative w-full rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-foco"
      >
        {/* O grupo acima já tem o nome e o resumo: o SVG é só desenho (nome anunciado uma vez). */}
        {medida !== null && (
        <svg
          aria-hidden="true"
          width={largura}
          height={altura}
          viewBox={`0 0 ${largura} ${altura}`}
          className="block overflow-visible"
        >
          {/* Grade: linhas finas, sólidas, um tom acima da superfície. */}
          <g aria-hidden="true">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={x0} x2={x0 + larguraPlot} y1={y(t)} y2={y(t)} className="stroke-borda" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={x0 - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-tinta-suave text-[11px] tabular-nums">
                  {formatarCompacto(t)}
                </text>
              </g>
            ))}
            {rotulosX.map((i) => (
              <text
                key={i}
                x={x(i)}
                y={base + 18}
                textAnchor={i === 0 ? 'start' : i === total - 1 ? 'end' : 'middle'}
                className="fill-tinta-suave text-[11px] tabular-nums"
              >
                {formatarDiaMes(datas[i])}
              </text>
            ))}
          </g>

          <g aria-hidden="true">
            {series[0] && (
              <path d={caminhoArea(series[0].valores, x, y, base)} className={CLASSE_COR[series[0].cor].area} fillOpacity={0.1} />
            )}
            {series.map((s) => (
              <path
                key={s.id}
                d={caminhoLinha(s.valores, x, y)}
                fill="none"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                className={CLASSE_COR[s.cor].linha}
              />
            ))}
            {/* Pontos isolados entre lacunas: sem marcador, sumiriam. */}
            {series.map((s) =>
              s.valores.map((v, i) =>
                v !== null && (s.valores[i - 1] ?? null) === null && (s.valores[i + 1] ?? null) === null ? (
                  <circle key={`${s.id}-${i}`} cx={x(i)} cy={y(v)} r={2.5} className={CLASSE_COR[s.cor].ponto} />
                ) : null,
              ),
            )}
            {series.map((s, k) => {
              const f = finais[k]
              if (!f) return null
              return (
                <g key={s.id}>
                  <circle cx={x(f.i)} cy={y(f.v)} r={4} strokeWidth={2} className={cx(CLASSE_COR[s.cor].ponto, 'stroke-superficie')} />
                  {k === 0 && (
                    <text x={x(f.i) + 8} y={y(f.v)} dy="0.32em" className="fill-tinta text-xs font-semibold tabular-nums">
                      {formatarCompacto(f.v)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>

          {dica !== null && (
            <g aria-hidden="true">
              <line x1={x(dica)} x2={x(dica)} y1={MARGEM.topo} y2={base} className="stroke-borda-forte" strokeWidth={1} />
              {series.map((s) => {
                const v = s.valores[dica]
                return v === null ? null : (
                  <circle key={s.id} cx={x(dica)} cy={y(v)} r={4} strokeWidth={2} className={cx(CLASSE_COR[s.cor].ponto, 'stroke-superficie')} />
                )
              })}
            </g>
          )}

          {/* Alvo do ponteiro: o plano inteiro, não a linha de 2 px. */}
          <rect
            x={x0}
            y={MARGEM.topo}
            width={larguraPlot}
            height={alturaPlot}
            fill="transparent"
            onPointerMove={aoMover}
            onPointerDown={aoMover}
            onPointerLeave={() => setIndice(null)}
          />
        </svg>
        )}

        {dica !== null && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border border-borda bg-superficie px-3 py-2 text-xs shadow-cartao"
            style={dicaNaDireita ? { left: Math.min(x(dica) + 12, largura - 160) } : { right: Math.max(4, largura - x(dica) + 12) }}
          >
            <p className="mb-1 text-tinta-suave">{formatarDataIso(datas[dica])}</p>
            {series.map((s) => {
              const v = s.valores[dica]
              return (
                <p key={s.id} className="flex items-center gap-2">
                  <span aria-hidden="true" className={cx('h-0.5 w-3 shrink-0 rounded-full', CLASSE_COR[s.cor].chave)} />
                  <span className="font-semibold text-tinta tabular-nums">{v === null ? '—' : fmt(v)}</span>
                  <span className="text-tinta-suave">{v === null ? 'sem dado' : s.rotulo.toLowerCase()}</span>
                </p>
              )
            })}
          </div>
        )}
        <p aria-live="polite" className="sr-only">
          {anuncio}
        </p>
      </div>
      <figcaption id={idResumo} className="mt-2 text-xs text-tinta-suave">
        {resumo}
      </figcaption>

      <details className="group mt-3">
        <summary className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-acento-texto hover:underline">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">›</span>
          Ver dados em tabela
        </summary>
        <div className="mt-2 max-h-72 overflow-y-auto">
          <Tabela legenda={titulo} compacta>
            <thead>
              <tr>
                <th scope="col">Data</th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className={CELULA_NUMERICA}>
                    {s.rotulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {datas
                .map((d, i) => ({ d, i }))
                .reverse()
                .map(({ d, i }) => (
                  <tr key={d}>
                    <th scope="row" className="font-normal">
                      {formatarDataIso(d)}
                    </th>
                    {series.map((s) => {
                      const v = s.valores[i]
                      return (
                        <td key={s.id} className={cx(CELULA_NUMERICA, v === null && 'text-tinta-suave')}>
                          {v === null ? 'sem dado' : fmt(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
            </tbody>
          </Tabela>
        </div>
      </details>
    </figure>
  )
}
