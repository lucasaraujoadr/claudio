import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

let valorCookie: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (nome: string) => (nome === 'tema' && valorCookie !== undefined ? { name: nome, value: valorCookie } : undefined),
  }),
}))

vi.mock('next/font/google', () => {
  const fonte = (o: { variable: string }) => ({ variable: o.variable.replace('--', 'v-'), className: 'f', style: {} })
  return { IBM_Plex_Sans: fonte, Source_Serif_4: fonte }
})

vi.mock('../../../app/globals.css', () => ({}))

async function htmlDoServidor(): Promise<string> {
  const { default: RootLayout } = await import('@/app/layout')
  const arvore = await RootLayout({ children: <p>conteúdo</p>, params: Promise.resolve({}) } as Parameters<typeof RootLayout>[0])
  return renderToStaticMarkup(arvore)
}

beforeEach(() => {
  valorCookie = undefined
})

describe('layout raiz: tema no HTML do servidor', () => {
  it('com cookie escuro, o <html> já sai com data-theme="escuro"', async () => {
    valorCookie = 'escuro'
    expect(await htmlDoServidor()).toMatch(/<html[^>]*data-theme="escuro"/)
  })

  it('com cookie claro, sai com data-theme="claro"', async () => {
    valorCookie = 'claro'
    expect(await htmlDoServidor()).toMatch(/<html[^>]*data-theme="claro"/)
  })

  it('sem cookie (ou com valor inválido) não chuta tema: o script do <head> decide', async () => {
    expect(await htmlDoServidor()).not.toMatch(/<html[^>]*data-theme=/)
    valorCookie = '"><script>'
    const html = await htmlDoServidor()
    expect(html).not.toMatch(/<html[^>]*data-theme=/)
    expect(html).not.toContain('"><script>')
  })

  it('o script de tema vem dentro do <head>, antes do <body>', async () => {
    const html = await htmlDoServidor()
    const head = html.slice(html.indexOf('<head>'), html.indexOf('</head>'))
    expect(head).toContain('<script>')
    expect(head).toContain('prefers-color-scheme: dark')
    expect(html.indexOf('</head>')).toBeLessThan(html.indexOf('<body'))
  })
})

describe('layout raiz: theme-color', () => {
  it('com tema escolhido no cookie, a barra do navegador usa a cor desse tema', async () => {
    const { generateViewport } = await import('@/app/layout')
    const { COR_TEMA } = await import('@/components/tema/tema')
    valorCookie = 'escuro'
    expect((await generateViewport()).themeColor).toBe(COR_TEMA.escuro)
    valorCookie = 'claro'
    expect((await generateViewport()).themeColor).toBe(COR_TEMA.claro)
  })

  it('sem escolha (ou valor inválido), segue o sistema com as duas cores', async () => {
    const { generateViewport } = await import('@/app/layout')
    valorCookie = 'roxo'
    expect(Array.isArray((await generateViewport()).themeColor)).toBe(true)
  })
})
