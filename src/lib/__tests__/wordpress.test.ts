import { beforeEach, describe, expect, it } from 'vitest'
import { configWp, criarClienteWp, ErroWp, reiniciarCacheCategoriasWp, type DadosPost } from '@/lib/wordpress'

type Chamada = { url: string; metodo: string; headers: Record<string, string>; corpo: unknown }

function fetchFalso(respostas: Array<{ status: number; json?: unknown } | Error>) {
  const chamadas: Chamada[] = []
  let i = 0
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({
      url: String(url),
      metodo: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      corpo: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    })
    const r = respostas[Math.min(i++, respostas.length - 1)]
    if (r instanceof Error) throw r
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status })
  }) as typeof fetch
  return { f, chamadas }
}

const cfg = { url: 'https://exemplo.com.br', usuario: 'editor-secreto', senha: 'abcd efgh SENHA-123' }
const dados: DadosPost = {
  status: 'draft',
  titulo: 'Título',
  slug: 'titulo',
  conteudo: '<p>oi</p>',
  resumo: 'resumo',
  categorias: [3],
  capaId: null,
  metaDescription: 'meta desc',
}
const postOk = { id: 7, status: 'draft', link: 'https://exemplo.com.br/?p=7', modified_gmt: '2026-10-29T10:00:00', meta: { _genesis_description: 'meta desc' } }

beforeEach(() => reiniciarCacheCategoriasWp())

describe('configWp', () => {
  it('null sem senha ou sem usuário; url sem barra final', () => {
    expect(configWp({ WP_USUARIO: 'u' } as never)).toBeNull()
    expect(configWp({ WP_SENHA_APP: 's' } as never)).toBeNull()
    expect(configWp({ WP_USUARIO: 'u', WP_SENHA_APP: 's', WP_URL: 'https://a.com/' } as never)).toEqual({ url: 'https://a.com', usuario: 'u', senha: 's' })
  })
})

describe('cliente WordPress', () => {
  it('criarPost manda Basic correto, context, corpo com meta e featured_media 0', async () => {
    const { f, chamadas } = fetchFalso([{ status: 201, json: postOk }])
    const p = await criarClienteWp(cfg, f).criarPost(dados)
    expect(p).toEqual({ id: 7, status: 'draft', link: postOk.link, modificadoGmt: postOk.modified_gmt, metaGravada: true })
    const c = chamadas[0]
    expect(c.metodo).toBe('POST')
    expect(c.url).toBe('https://exemplo.com.br/wp-json/wp/v2/posts?context=edit')
    expect(c.headers.Authorization).toBe('Basic ' + Buffer.from(`${cfg.usuario}:${cfg.senha}`).toString('base64'))
    expect(c.corpo).toEqual({
      status: 'draft', title: 'Título', slug: 'titulo', content: '<p>oi</p>', excerpt: 'resumo',
      categories: [3], featured_media: 0, meta: { _genesis_description: 'meta desc', _genesis_title: 'Título' },
    })
  })

  it('atualizarPost usa POST /posts/:id', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: postOk }])
    await criarClienteWp(cfg, f).atualizarPost(7, { ...dados, capaId: 9, dataGmt: '2026-11-01T10:00:00' })
    expect(chamadas[0].metodo).toBe('POST')
    expect(chamadas[0].url).toBe('https://exemplo.com.br/wp-json/wp/v2/posts/7?context=edit')
    expect(chamadas[0].corpo).toMatchObject({ featured_media: 9, date_gmt: '2026-11-01T10:00:00' })
  })

  it('lerPost 404 → null', async () => {
    const { f, chamadas } = fetchFalso([{ status: 404, json: { code: 'rest_post_invalid_id' } }])
    expect(await criarClienteWp(cfg, f).lerPost(7)).toBeNull()
    expect(chamadas[0].url).toContain('/posts/7?context=edit')
  })

  it('401 → credencial, sem usuário nem senha na mensagem', async () => {
    const { f } = fetchFalso([{ status: 401, json: { message: `bad ${cfg.senha} ${cfg.usuario}` } }])
    const e = await criarClienteWp(cfg, f).criarPost(dados).catch((x) => x)
    expect(e).toBeInstanceOf(ErroWp)
    expect(e.tipo).toBe('credencial')
    expect(e.message).toBe('senha de aplicativo inválida ou usuário sem permissão de Editor')
    expect(e.message).not.toContain(cfg.usuario)
    expect(e.message).not.toContain(cfg.senha)
  })

  it('fetch lançando → rede; 500 → servidor', async () => {
    const e1 = await criarClienteWp(cfg, fetchFalso([new Error(`falha ${cfg.senha}`)]).f).lerPost(1).catch((x) => x)
    expect(e1.tipo).toBe('rede')
    expect(e1.message).toBe('o WordPress não respondeu; tente de novo')
    expect(e1.message).not.toContain(cfg.senha)
    const e2 = await criarClienteWp(cfg, fetchFalso([{ status: 500 }]).f).lerPost(1).catch((x) => x)
    expect(e2.tipo).toBe('servidor')
  })

  it('400 invalid_param → invalido', async () => {
    const { f } = fetchFalso([{ status: 400, json: { code: 'rest_invalid_param', message: 'x' } }])
    const e = await criarClienteWp(cfg, f).criarPost(dados).catch((x) => x)
    expect(e.tipo).toBe('invalido')
  })

  it('metaGravada false quando a resposta não tem _genesis_description', async () => {
    const { f } = fetchFalso([{ status: 201, json: { ...postOk, meta: {} } }])
    expect((await criarClienteWp(cfg, f).criarPost(dados)).metaGravada).toBe(false)
  })

  it('enviarImagem manda Content-Disposition com nome ASCII', async () => {
    const { f, chamadas } = fetchFalso([{ status: 201, json: { id: 5, source_url: 'https://exemplo.com.br/a.png' } }])
    const r = await criarClienteWp(cfg, f).enviarImagem(new Uint8Array([1, 2]), 'Perícia Contábil "capa".png', 'image/png')
    expect(r).toEqual({ id: 5, url: 'https://exemplo.com.br/a.png' })
    expect(chamadas[0].url).toBe('https://exemplo.com.br/wp-json/wp/v2/media')
    expect(chamadas[0].headers['Content-Type']).toBe('image/png')
    const cd = chamadas[0].headers['Content-Disposition']
    expect(cd).toBe('attachment; filename="Pericia-Contabil-capa.png"')
  })

  it('slugEmUso ignora o próprio id', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: [{ id: 7, link: 'https://x/7' }, { id: 8, link: 'https://x/8' }] }])
    expect(await criarClienteWp(cfg, f).slugEmUso('titulo', 7)).toBe('https://x/8')
    expect(chamadas[0].url).toContain('slug=titulo')
    expect(chamadas[0].url).toContain('context=edit')
    const { f: f2 } = fetchFalso([{ status: 200, json: [{ id: 7, link: 'https://x/7' }] }])
    expect(await criarClienteWp(cfg, f2).slugEmUso('titulo', 7)).toBeNull()
  })

  it('categorias em cache: segunda chamada não chama fetch; ordenadas por nome', async () => {
    const { f, chamadas } = fetchFalso([{ status: 200, json: [{ id: 2, name: 'Zebra' }, { id: 1, name: 'Água' }] }])
    const c = criarClienteWp(cfg, f)
    expect(await c.listarCategorias()).toEqual([{ id: 1, nome: 'Água' }, { id: 2, nome: 'Zebra' }])
    await c.listarCategorias()
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0].url).toContain('per_page=100&_fields=id,name')
  })
})
