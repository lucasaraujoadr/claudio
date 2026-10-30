import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { ajustarFonte, estimarLinhas } from './ajuste'
import { carregarFontes } from './fontes'

export type Lamina =
  | { tipo: 'capa'; titulo: string; subtitulo: string | null }
  | { tipo: 'conteudo'; titulo: string; texto: string | null; itens: string[] | null }
  | { tipo: 'chamada'; texto: string }

export type Variacao = 'escura' | 'clara'

const LARGURA = 1080
const ALTURA = 1350
const MARGEM = 96
const LARGURA_UTIL = LARGURA - 2 * MARGEM // 888
const DOMINIO = 'ogpericiacontabil.com.br'
const ALTURA_LINHA = 1.25
const LOGO_ALTURA = 44
const LOGO_LARGURA = Math.round((694 / 127) * LOGO_ALTURA)
// Área do corpo entre o cabeçalho (logo) e o rodapé, já descontados os respiros.
const CORPO_ALTURA = 940

const TITULO_CAPA = [72, 64, 56, 48]
const TITULO_CONTEUDO = [56, 48, 42, 36]
const TEXTO = [36, 32, 28, 26]
const ITENS = [32, 28, 26]
// Fator de largura média por caractere: levemente conservador para a serifada em semibold.
const FATOR_TITULO = 0.54

const CORES = {
  escura: { fundo: '#0E0F11', texto: '#F5F3EE', suave: '#B7B2A6', ouro: '#DAA522', ouroTexto: '#DAA522', linha: '#2A2C30', logo: 'logo-og.png' },
  clara: { fundo: '#F5F3EE', texto: '#0E0F11', suave: '#5F5A51', ouro: '#C8941A', ouroTexto: '#8A6410', linha: '#DDD6C8', logo: 'logo-og-claro.png' },
} as const

const logos = new Map<string, Promise<string>>()
function lerLogo(arquivo: string): Promise<string> {
  let p = logos.get(arquivo)
  if (!p) {
    p = readFile(join(process.cwd(), 'public', arquivo))
      .then((b) => `data:image/png;base64,${b.toString('base64')}`)
      .catch((e) => {
        logos.delete(arquivo)
        throw e
      })
    logos.set(arquivo, p)
  }
  return p
}

type Cores = (typeof CORES)[Variacao]

function alturaTexto(linhas: number, tamanho: number) {
  return Math.ceil(linhas * tamanho * ALTURA_LINHA)
}

/** Itens em lista: maior degrau em que a soma das linhas (mais o respiro entre itens) cabe. */
function ajustarItens(itens: string[], alturaMax: number) {
  const largura = LARGURA_UTIL - 48 // recuo do marcador
  for (const tamanho of ITENS) {
    const gap = Math.round(tamanho * 0.7)
    let total = 0
    let ok = true
    for (const item of itens) {
      const linhas = estimarLinhas(item, largura, tamanho, 0.52)
      if (linhas === null) {
        ok = false
        break
      }
      total += alturaTexto(linhas, tamanho)
    }
    total += gap * (itens.length - 1)
    if (ok && total <= alturaMax) return { tamanho, gap, altura: total }
  }
  return null
}

function Moldura(props: { c: Cores; logo: string; n: number; total: number; mostrarDominio: boolean; filhos: React.ReactNode }) {
  const { c, logo, n, total, mostrarDominio, filhos } = props
  return (
    <div
      style={{
        width: LARGURA,
        height: ALTURA,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: MARGEM,
        backgroundColor: c.fundo,
        color: c.texto,
        fontFamily: 'IBM Plex Sans',
      }}
    >
      <div style={{ display: 'flex', height: LOGO_ALTURA }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text */}
        <img src={logo} width={LOGO_LARGURA} height={LOGO_ALTURA} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', height: CORPO_ALTURA, justifyContent: 'center' }}>{filhos}</div>
      <div
        style={{
          display: 'flex',
          justifyContent: mostrarDominio ? 'space-between' : 'flex-end',
          alignItems: 'center',
          borderTop: `2px solid ${c.linha}`,
          paddingTop: 28,
          fontSize: 24,
          color: c.suave,
        }}
      >
        {mostrarDominio ? <div style={{ display: 'flex', letterSpacing: 1 }}>{DOMINIO}</div> : null}
        <div style={{ display: 'flex', fontWeight: 600, color: c.ouroTexto }}>{`${n}/${total}`}</div>
      </div>
    </div>
  )
}

function Filete({ c, largura = 120 }: { c: Cores; largura?: number }) {
  return <div style={{ display: 'flex', width: largura, height: 6, backgroundColor: c.ouro }} />
}

function montar(l: Lamina, n: number, c: Cores): { filhos: React.ReactNode; mostrarDominio: boolean } | null {
  if (l.tipo === 'capa') {
    const t = ajustarFonte(l.titulo, { largura: LARGURA_UTIL, alturaMax: 560 }, TITULO_CAPA, FATOR_TITULO)
    if (!t) return null
    let sub = null
    if (l.subtitulo) {
      sub = ajustarFonte(l.subtitulo, { largura: LARGURA_UTIL, alturaMax: 240 }, TEXTO)
      if (!sub) return null
    }
    return {
      mostrarDominio: true,
      filhos: (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <Filete c={c} largura={160} />
          <div
            style={{
              display: 'flex',
              marginTop: 48,
              fontFamily: 'Source Serif 4',
              fontWeight: 600,
              fontSize: t.tamanho,
              lineHeight: ALTURA_LINHA,
              letterSpacing: -1,
            }}
          >
            {l.titulo}
          </div>
          {sub && l.subtitulo ? (
            <div style={{ display: 'flex', marginTop: 44, fontSize: sub.tamanho, lineHeight: ALTURA_LINHA, color: c.suave }}>
              {l.subtitulo}
            </div>
          ) : null}
        </div>
      ),
    }
  }

  if (l.tipo === 'chamada') {
    const t = ajustarFonte(l.texto, { largura: LARGURA_UTIL, alturaMax: 560 }, TITULO_CAPA, FATOR_TITULO)
    if (!t) return null
    return {
      mostrarDominio: false,
      filhos: (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
          <Filete c={c} largura={120} />
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginTop: 56,
              fontFamily: 'Source Serif 4',
              fontWeight: 600,
              fontSize: t.tamanho,
              lineHeight: ALTURA_LINHA,
            }}
          >
            {l.texto}
          </div>
          <div style={{ display: 'flex', marginTop: 72, fontWeight: 600, fontSize: 50, color: c.ouroTexto, letterSpacing: 0.5 }}>
            {DOMINIO}
          </div>
        </div>
      ),
    }
  }

  // conteudo
  const GAP_FILETE = 44 // filete + respiro até o título
  const GAP_BLOCO = 40
  const titulo = ajustarFonte(l.titulo, { largura: LARGURA_UTIL, alturaMax: 300 }, TITULO_CONTEUDO, FATOR_TITULO)
  if (!titulo) return null
  let restante = CORPO_ALTURA - 6 - GAP_FILETE - alturaTexto(titulo.linhas, titulo.tamanho)
  const itensValidos = l.itens && l.itens.length > 0 ? l.itens : null

  let texto = null
  if (l.texto) {
    // Com lista, o texto não toma mais que ~40% do que sobra.
    const max = itensValidos ? Math.floor((restante - GAP_BLOCO) * 0.4) : restante - GAP_BLOCO
    texto = ajustarFonte(l.texto, { largura: LARGURA_UTIL, alturaMax: max }, TEXTO)
    if (!texto) return null
    restante -= GAP_BLOCO + alturaTexto(texto.linhas, texto.tamanho)
  }
  let itens = null
  if (itensValidos) {
    itens = ajustarItens(itensValidos, restante - GAP_BLOCO)
    if (!itens) return null
  }

  return {
    mostrarDominio: true,
    filhos: (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Filete c={c} />
        <div
          style={{
            display: 'flex',
            marginTop: GAP_FILETE - 6,
            fontFamily: 'Source Serif 4',
            fontWeight: 600,
            fontSize: titulo.tamanho,
            lineHeight: ALTURA_LINHA,
          }}
        >
          {l.titulo}
        </div>
        {texto && l.texto ? (
          <div style={{ display: 'flex', marginTop: GAP_BLOCO, fontSize: texto.tamanho, lineHeight: ALTURA_LINHA, color: c.suave }}>
            {l.texto}
          </div>
        ) : null}
        {itens && itensValidos ? (
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: GAP_BLOCO }}>
            {itensValidos.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', marginTop: i === 0 ? 0 : itens.gap }}>
                <div
                  style={{
                    display: 'flex',
                    width: 14,
                    height: 14,
                    marginTop: Math.round((itens.tamanho * ALTURA_LINHA - 14) / 2),
                    marginRight: 34,
                    backgroundColor: c.ouro,
                    flexShrink: 0,
                  }}
                />
                <div style={{ display: 'flex', flex: 1, fontSize: itens.tamanho, lineHeight: ALTURA_LINHA }}>{item}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    ),
  }
}

export async function renderizarLamina(
  l: Lamina,
  n: number,
  total: number,
  variacao: 'escura' | 'clara',
): Promise<Response | { erro: string }> {
  const c = CORES[variacao]
  const montada = montar(l, n, c)
  if (!montada) return { erro: `texto longo demais na lâmina ${n}` }
  const [fonts, logo] = await Promise.all([carregarFontes(), lerLogo(c.logo)])
  return new ImageResponse(
    <Moldura c={c} logo={logo} n={n} total={total} mostrarDominio={montada.mostrarDominio} filhos={montada.filhos} />,
    { width: LARGURA, height: ALTURA, fonts },
  )
}
