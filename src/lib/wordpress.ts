/**
 * Cliente da REST API do WordPress (/wp-json/wp/v2) com senha de aplicativo.
 * `fetch` é injetado para os testes. Credenciais nunca entram em mensagem de erro, log
 * ou retorno; as mensagens são fixas e nunca repetem o corpo da resposta.
 */
import { siteUrl } from '@/lib/site'

export type ConfigWp = { url: string; usuario: string; senha: string }

export type DadosPost = {
  status: 'draft' | 'future' | 'publish'
  titulo: string
  slug: string
  conteudo: string
  resumo: string
  categorias: number[]
  capaId: number | null
  dataGmt?: string
  metaDescription: string
}

export type PostWp = { id: number; status: string; link: string; modificadoGmt: string; metaGravada: boolean }

export type TipoErroWp = 'credencial' | 'nao_encontrado' | 'conflito_slug' | 'rede' | 'servidor' | 'invalido'

const MENSAGENS: Record<TipoErroWp, string> = {
  credencial: 'senha de aplicativo inválida ou usuário sem permissão de Editor',
  nao_encontrado: 'o item não foi encontrado no WordPress',
  conflito_slug: 'já existe outro conteúdo com este endereço (slug) no WordPress',
  rede: 'o WordPress não respondeu; tente de novo',
  servidor: 'o WordPress não respondeu; tente de novo',
  invalido: 'o WordPress recusou os dados enviados',
}

export class ErroWp extends Error {
  tipo: TipoErroWp
  constructor(tipo: TipoErroWp) {
    super(MENSAGENS[tipo])
    this.name = 'ErroWp'
    this.tipo = tipo
  }
}

const TIMEOUT_MS = 30_000
const CACHE_CATEGORIAS_MS = 60 * 60 * 1000

export function configWp(env: NodeJS.ProcessEnv = process.env): ConfigWp | null {
  const usuario = env.WP_USUARIO?.trim()
  const senha = env.WP_SENHA_APP?.trim()
  if (!usuario || !senha) return null
  const url = (env.WP_URL?.trim() || siteUrl()).replace(/\/+$/, '')
  return { url, usuario, senha }
}

const cacheCategorias = new Map<string, { em: number; itens: { id: number; nome: string }[] }>()

/** Uso em testes. */
export function reiniciarCacheCategoriasWp(): void {
  cacheCategorias.clear()
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function nomeAscii(nome: string): string {
  const base = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^-+|-+$/g, '')
  return base || 'imagem'
}

export function criarClienteWp(cfg: ConfigWp, f: typeof fetch = fetch) {
  const base = `${cfg.url}/wp-json/wp/v2`
  const auth = 'Basic ' + Buffer.from(`${cfg.usuario}:${cfg.senha}`).toString('base64')

  async function chamar(
    metodo: 'GET' | 'POST',
    caminho: string,
    opts: { json?: unknown; binario?: { bytes: Uint8Array; tipo: string; nome: string }; aceitar404?: boolean } = {},
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = { Authorization: auth, Accept: 'application/json' }
    let body: BodyInit | undefined
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.json)
    } else if (opts.binario) {
      headers['Content-Type'] = opts.binario.tipo
      headers['Content-Disposition'] = `attachment; filename="${nomeAscii(opts.binario.nome)}"`
      body = opts.binario.bytes as unknown as BodyInit
    }
    let resp: Response
    try {
      resp = await f(`${base}${caminho}`, { method: metodo, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch {
      throw new ErroWp('rede')
    }
    let json: unknown = null
    const texto = await resp.text().catch(() => '')
    if (texto) {
      try {
        json = JSON.parse(texto)
      } catch {
        json = null
      }
    }
    if (resp.ok) return { status: resp.status, json }
    if (resp.status === 401 || resp.status === 403) throw new ErroWp('credencial')
    if (resp.status === 404) {
      if (opts.aceitar404) return { status: 404, json: null }
      throw new ErroWp('nao_encontrado')
    }
    if (resp.status >= 500) throw new ErroWp('servidor')
    const codigo = ehObjeto(json) && typeof json.code === 'string' ? json.code : ''
    if (resp.status === 400 && codigo.includes('invalid_param')) throw new ErroWp('invalido')
    throw new ErroWp('invalido')
  }

  function lerPostResposta(j: unknown, metaEnviada?: string): PostWp {
    if (!ehObjeto(j) || typeof j.id !== 'number') throw new ErroWp('servidor')
    const meta = ehObjeto(j.meta) ? j.meta : {}
    return {
      id: j.id,
      status: typeof j.status === 'string' ? j.status : '',
      link: typeof j.link === 'string' ? j.link : '',
      modificadoGmt: typeof j.modified_gmt === 'string' ? j.modified_gmt : '',
      metaGravada: metaEnviada !== undefined && meta._genesis_description === metaEnviada,
    }
  }

  function corpoPost(d: DadosPost) {
    return {
      status: d.status,
      title: d.titulo,
      slug: d.slug,
      content: d.conteudo,
      excerpt: d.resumo,
      categories: d.categorias,
      featured_media: d.capaId ?? 0,
      ...(d.dataGmt ? { date_gmt: d.dataGmt } : {}),
      meta: { _genesis_description: d.metaDescription, _genesis_title: d.titulo },
    }
  }

  return {
    async listarCategorias(): Promise<{ id: number; nome: string }[]> {
      const agora = Date.now()
      const emCache = cacheCategorias.get(cfg.url)
      if (emCache && agora - emCache.em < CACHE_CATEGORIAS_MS) return emCache.itens
      const itens: { id: number; nome: string }[] = []
      for (let pagina = 1; pagina <= 20; pagina++) {
        const { json } = await chamar('GET', `/categories?per_page=100&_fields=id,name${pagina > 1 ? `&page=${pagina}` : ''}`)
        if (!Array.isArray(json)) throw new ErroWp('servidor')
        for (const c of json) {
          if (ehObjeto(c) && typeof c.id === 'number') itens.push({ id: c.id, nome: typeof c.name === 'string' ? c.name : '' })
        }
        if (json.length < 100) break
      }
      itens.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      cacheCategorias.set(cfg.url, { em: agora, itens })
      return itens
    },

    async enviarImagem(bytes: Uint8Array, nomeArquivo: string, tipo: string): Promise<{ id: number; url: string }> {
      const { json } = await chamar('POST', '/media', { binario: { bytes, tipo, nome: nomeArquivo } })
      if (!ehObjeto(json) || typeof json.id !== 'number' || typeof json.source_url !== 'string') throw new ErroWp('servidor')
      return { id: json.id, url: json.source_url }
    },

    async criarPost(d: DadosPost): Promise<PostWp> {
      const { json } = await chamar('POST', '/posts?context=edit', { json: corpoPost(d) })
      return lerPostResposta(json, d.metaDescription)
    },

    async atualizarPost(id: number, d: DadosPost): Promise<PostWp> {
      const { json } = await chamar('POST', `/posts/${Math.trunc(id)}?context=edit`, { json: corpoPost(d) })
      return lerPostResposta(json, d.metaDescription)
    },

    async lerPost(id: number): Promise<PostWp | null> {
      const r = await chamar('GET', `/posts/${Math.trunc(id)}?context=edit`, { aceitar404: true })
      if (r.status === 404) return null
      return lerPostResposta(r.json)
    },

    async slugEmUso(slug: string, excetoId?: number): Promise<string | null> {
      const { json } = await chamar(
        'GET',
        `/posts?slug=${encodeURIComponent(slug)}&status=publish,future,draft,pending,private&_fields=id,link&context=edit`,
      )
      if (!Array.isArray(json)) throw new ErroWp('servidor')
      for (const p of json) {
        if (ehObjeto(p) && typeof p.id === 'number' && p.id !== excetoId && typeof p.link === 'string') return p.link
      }
      return null
    },
  }
}
