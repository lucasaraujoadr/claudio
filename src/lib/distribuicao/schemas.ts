import { z } from 'zod'
import { cortarNaPalavra } from '@/lib/ai/briefing'
import type { Lamina } from './arte/lamina'

export type TipoPeca = 'linkedin_artigo' | 'linkedin_post' | 'carrossel' | 'newsletter'
export const TIPOS_PECA: TipoPeca[] = ['linkedin_artigo', 'linkedin_post', 'carrossel', 'newsletter']

/** Limites da spec §3.1. Valem para a validação estrita, não para o schema enviado ao modelo. */
export const LIMITES = {
  artigo: { titulo: 100, subtitulo: 160, palavrasMin: 600, palavrasMax: 1200 },
  post: { texto: 2800, hashtagsMin: 3, hashtagsMax: 5 },
  carrossel: {
    laminasMin: 6,
    laminasMax: 8,
    capaTitulo: 60,
    capaSubtitulo: 90,
    titulo: 50,
    texto: 220,
    itens: 4,
    item: 70,
    chamada: 120,
    legenda: 2000,
  },
  newsletter: { assunto: 70, preCabecalho: 110, abertura: 400, pontosMin: 3, pontosMax: 5, ponto: 160 },
} as const

// ---------------------------------------------------------------------------
// Schemas enviados ao modelo: tudo nullable, sem .optional() e sem min/max (saída estrita).
// ---------------------------------------------------------------------------

export const linkedinArtigoSchemaModelo = z.object({
  titulo: z.string(),
  subtitulo: z.string().nullable(),
  blocos: z.array(
    z.object({
      tipo: z.enum(['paragrafo', 'h2', 'lista']),
      texto: z.string().nullable(),
      itens: z.array(z.string()).nullable(),
    }),
  ),
})

export const linkedinPostSchemaModelo = z.object({
  texto: z.string(),
  hashtags: z.array(z.string()),
})

export const carrosselSchemaModelo = z.object({
  laminas: z.array(
    z.object({
      tipo: z.enum(['capa', 'conteudo', 'chamada']),
      titulo: z.string().nullable(),
      subtitulo: z.string().nullable(),
      texto: z.string().nullable(),
      itens: z.array(z.string()).nullable(),
    }),
  ),
  legenda: z.string(),
})

export const newsletterSchemaModelo = z.object({
  assunto: z.string(),
  preCabecalho: z.string(),
  abertura: z.string(),
  pontos: z.array(z.string()),
})

export const SCHEMAS_MODELO = {
  linkedin_artigo: linkedinArtigoSchemaModelo,
  linkedin_post: linkedinPostSchemaModelo,
  carrossel: carrosselSchemaModelo,
  newsletter: newsletterSchemaModelo,
} as const

// ---------------------------------------------------------------------------
// Schemas estritos: o que se grava e o que a tela edita.
// ---------------------------------------------------------------------------

const linha = (max: number) => z.string().trim().min(1).max(max)

const blocoEstrito = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('paragrafo'), texto: z.string().trim().min(1) }),
  z.object({ tipo: z.literal('h2'), texto: linha(200) }),
  z.object({ tipo: z.literal('lista'), itens: z.array(z.string().trim().min(1)).min(1) }),
])

export const linkedinArtigoEstrito = z.object({
  titulo: linha(LIMITES.artigo.titulo),
  subtitulo: linha(LIMITES.artigo.subtitulo).nullable(),
  blocos: z.array(blocoEstrito).min(1),
})

export const linkedinPostEstrito = z.object({
  texto: linha(LIMITES.post.texto),
  hashtags: z
    .array(z.string().regex(/^[^\s#]+$/))
    .min(LIMITES.post.hashtagsMin)
    .max(LIMITES.post.hashtagsMax),
})

const L = LIMITES.carrossel
const laminaEstrita = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('capa'), titulo: linha(L.capaTitulo), subtitulo: linha(L.capaSubtitulo).nullable() }),
  z
    .object({
      tipo: z.literal('conteudo'),
      titulo: linha(L.titulo),
      texto: linha(L.texto).nullable(),
      itens: z.array(linha(L.item)).min(1).max(L.itens).nullable(),
    })
    .refine((l) => l.texto !== null || l.itens !== null, { message: 'lâmina sem texto nem itens' }),
  z.object({ tipo: z.literal('chamada'), texto: linha(L.chamada) }),
])

export const carrosselEstrito = z
  .object({
    laminas: z.array(laminaEstrita).min(L.laminasMin).max(L.laminasMax),
    legenda: linha(L.legenda),
  })
  .refine(
    (c) => c.laminas[0]?.tipo === 'capa' && c.laminas[c.laminas.length - 1]?.tipo === 'chamada',
    { message: 'o carrossel começa na capa e termina na chamada' },
  )

const N = LIMITES.newsletter
export const newsletterEstrito = z.object({
  assunto: linha(N.assunto),
  preCabecalho: linha(N.preCabecalho),
  abertura: linha(N.abertura),
  pontos: z.array(linha(N.ponto)).min(N.pontosMin).max(N.pontosMax),
})

export const SCHEMAS_ESTRITOS = {
  linkedin_artigo: linkedinArtigoEstrito,
  linkedin_post: linkedinPostEstrito,
  carrossel: carrosselEstrito,
  newsletter: newsletterEstrito,
} as const

export type LinkedinArtigo = z.infer<typeof linkedinArtigoEstrito>
export type LinkedinPost = z.infer<typeof linkedinPostEstrito>
export type Carrossel = z.infer<typeof carrosselEstrito>
export type Newsletter = z.infer<typeof newsletterEstrito>
export type ConteudoPeca = LinkedinArtigo | LinkedinPost | Carrossel | Newsletter

// Garante em tempo de compilação que a lâmina estrita mapeia 1:1 na da arte (Task 8).
type _LaminasCompativeis = Carrossel['laminas'][number] extends Lamina ? true : never
const _verificacao: _LaminasCompativeis = true
void _verificacao

// ---------------------------------------------------------------------------
// Reparo: corta na palavra o que exceder e registra; quantidade fora do intervalo lança erro.
// ---------------------------------------------------------------------------

export class PecaInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'PecaInvalidaError'
  }
}

type Ajustes = string[]

function cortar(texto: string, max: number, campo: string, ajustes: Ajustes): string {
  const t = texto.replace(/[ \t]+\n/g, '\n').trim()
  if (t.length <= max) return t
  ajustes.push(`${campo} cortado de ${t.length} para o limite de ${max} caracteres`)
  return cortarNaPalavra(t, max)
}

function cortarNulavel(texto: string | null, max: number, campo: string, ajustes: Ajustes): string | null {
  if (texto === null) return null
  const t = cortar(texto, max, campo, ajustes)
  return t === '' ? null : t
}

function intervalo(n: number, min: number, max: number, nome: string) {
  if (n < min || n > max) throw new PecaInvalidaError(`${nome}: ${n} fora do intervalo de ${min} a ${max}`)
}

export function contarPalavras(texto: string): number {
  return texto.split(/\s+/).filter(Boolean).length
}

function reparoLinkedinArtigo(b: z.infer<typeof linkedinArtigoSchemaModelo>, ajustes: Ajustes): LinkedinArtigo {
  const blocos: LinkedinArtigo['blocos'] = []
  for (const bl of b.blocos) {
    if (bl.tipo === 'lista') {
      const itens = (bl.itens ?? []).map((i) => i.trim()).filter(Boolean)
      if (itens.length) blocos.push({ tipo: 'lista', itens })
    } else {
      const texto = bl.texto?.trim()
      if (texto) blocos.push({ tipo: bl.tipo, texto: bl.tipo === 'h2' ? cortar(texto, 200, 'h2', ajustes) : texto })
    }
  }
  const palavras = blocos.reduce(
    (n, bl) => n + contarPalavras(bl.tipo === 'lista' ? bl.itens.join(' ') : bl.texto),
    0,
  )
  if (palavras < LIMITES.artigo.palavrasMin || palavras > LIMITES.artigo.palavrasMax) {
    ajustes.push(
      `o artigo tem ${palavras} palavras; o previsto é de ${LIMITES.artigo.palavrasMin} a ${LIMITES.artigo.palavrasMax}`,
    )
  }
  return {
    titulo: cortar(b.titulo, LIMITES.artigo.titulo, 'título', ajustes),
    subtitulo: cortarNulavel(b.subtitulo, LIMITES.artigo.subtitulo, 'subtítulo', ajustes),
    blocos,
  }
}

function reparoPost(b: z.infer<typeof linkedinPostSchemaModelo>, ajustes: Ajustes): LinkedinPost {
  const vistas = new Set<string>()
  const hashtags: string[] = []
  for (const h of b.hashtags) {
    const limpa = h.replace(/[#\s]/g, '')
    if (limpa && !vistas.has(limpa.toLowerCase())) {
      vistas.add(limpa.toLowerCase())
      hashtags.push(limpa)
    }
  }
  intervalo(hashtags.length, LIMITES.post.hashtagsMin, LIMITES.post.hashtagsMax, 'hashtags')
  return { texto: cortar(b.texto, LIMITES.post.texto, 'texto', ajustes), hashtags }
}

function reparoCarrossel(b: z.infer<typeof carrosselSchemaModelo>, ajustes: Ajustes): Carrossel {
  intervalo(b.laminas.length, L.laminasMin, L.laminasMax, 'lâminas')
  const laminas = b.laminas.map((l, i): Carrossel['laminas'][number] => {
    const n = i + 1
    if (l.tipo === 'capa') {
      return {
        tipo: 'capa',
        titulo: cortar(l.titulo ?? '', L.capaTitulo, `título da capa`, ajustes),
        subtitulo: cortarNulavel(l.subtitulo, L.capaSubtitulo, 'subtítulo da capa', ajustes),
      }
    }
    if (l.tipo === 'chamada') {
      return { tipo: 'chamada', texto: cortar(l.texto ?? '', L.chamada, `texto da chamada`, ajustes) }
    }
    let itens = l.itens?.map((x) => x.trim()).filter(Boolean) ?? []
    if (itens.length > L.itens) {
      ajustes.push(`lâmina ${n}: ${itens.length} itens reduzidos para ${L.itens}`)
      itens = itens.slice(0, L.itens)
    }
    return {
      tipo: 'conteudo',
      titulo: cortar(l.titulo ?? '', L.titulo, `título da lâmina ${n}`, ajustes),
      texto: cortarNulavel(l.texto, L.texto, `texto da lâmina ${n}`, ajustes),
      itens: itens.length ? itens.map((x) => cortar(x, L.item, `item da lâmina ${n}`, ajustes)) : null,
    }
  })
  return { laminas, legenda: cortar(b.legenda, L.legenda, 'legenda', ajustes) }
}

function reparoNewsletter(b: z.infer<typeof newsletterSchemaModelo>, ajustes: Ajustes): Newsletter {
  const pontos = b.pontos.map((p) => p.trim()).filter(Boolean)
  intervalo(pontos.length, N.pontosMin, N.pontosMax, 'pontos')
  return {
    assunto: cortar(b.assunto, N.assunto, 'assunto', ajustes),
    preCabecalho: cortar(b.preCabecalho, N.preCabecalho, 'pré-cabeçalho', ajustes),
    abertura: cortar(b.abertura, N.abertura, 'abertura', ajustes),
    pontos: pontos.map((p) => cortar(p, N.ponto, 'ponto', ajustes)),
  }
}

/** Valida o bruto do modelo, corta na palavra o que exceder e confere o resultado com o schema estrito. */
export function repararPeca(tipo: TipoPeca, bruto: unknown): { valor: ConteudoPeca; ajustes: string[] } {
  const ajustes: Ajustes = []
  let valor: ConteudoPeca
  switch (tipo) {
    case 'linkedin_artigo':
      valor = reparoLinkedinArtigo(linkedinArtigoSchemaModelo.parse(bruto), ajustes)
      break
    case 'linkedin_post':
      valor = reparoPost(linkedinPostSchemaModelo.parse(bruto), ajustes)
      break
    case 'carrossel':
      valor = reparoCarrossel(carrosselSchemaModelo.parse(bruto), ajustes)
      break
    case 'newsletter':
      valor = reparoNewsletter(newsletterSchemaModelo.parse(bruto), ajustes)
      break
  }
  const r = SCHEMAS_ESTRITOS[tipo].safeParse(valor)
  if (!r.success) throw new PecaInvalidaError(`peça ${tipo} inválida: ${r.error.issues[0]?.message ?? 'erro'}`)
  return { valor: r.data, ajustes }
}
