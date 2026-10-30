// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/server', () => ({ connection: async () => {} }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('notFound') } }))

const estado = vi.hoisted(() => ({
  integracao: { conectado: false, acessoPublico: null as boolean | null, pendentes: 0, erros: 0, ultimoSync: null },
}))
vi.mock('@/lib/crm/sincronizar', () => ({ estadoIntegracao: async () => estado.integracao }))

const funilDados = vi.hoisted(() => ({
  funil: { id: 1, slug: 'boas-vindas', nome: 'Boas-vindas', descricao: 'd', ativo: true, tetoDiario: null, checklistLgpdEm: null },
  resumo: { enviados: 4, erros: 1, fila: 2, incertos: [] as { contatoId: number; nome: string | null; email: string; etapa: number; quando: Date }[] },
}))
vi.mock('@/lib/crm/banco', () => ({ bancoPadrao: () => ({ select: () => ({ from: () => ({ where: async () => [] }) }) }) }))
vi.mock('@/lib/crm/funis', async (orig) => ({
  ...(await orig<typeof import('@/lib/crm/funis')>()),
  obterFunil: async () => funilDados.funil,
  membrosDoFunil: async () => ({ itens: [], total: 0 }),
  resumoFunis: async () => [{ ...funilDados.funil, ativos: 0, concluidos: 0, sairam: 0 }],
}))
vi.mock('@/lib/crm/envios-painel', () => ({ resumoEnviosFunil: async () => funilDados.resumo }))

import IntegracaoPage from '../integracao/page'
import FunilPage from '../funis/[slug]/page'
import FunisPage from '../funis/page'

async function montar(el: Promise<ReactElement>) {
  render(await el)
}
const sp = (o: Record<string, string> = {}) => Promise.resolve(o)

const ORIGINAL = { ...process.env }
beforeEach(() => {
  delete process.env.RESEND_API_KEY
  delete process.env.RESEND_REMETENTE
  estado.integracao = { conectado: false, acessoPublico: null, pendentes: 0, erros: 0, ultimoSync: null }
})
afterEach(() => {
  cleanup()
  process.env = { ...ORIGINAL }
})

describe('integração', () => {
  it("mostra 'Resend não conectado' sem chave", async () => {
    await montar(IntegracaoPage({ searchParams: sp() }))
    expect(screen.getByText('Resend não conectado')).toBeTruthy()
  })

  it('mostra alerta de acesso público quando false, com a instrução de Standard Protection', async () => {
    estado.integracao = { ...estado.integracao, conectado: true, acessoPublico: false }
    await montar(IntegracaoPage({ searchParams: sp() }))
    expect(screen.getByText(/Standard Protection/)).toBeTruthy()
    expect(screen.getByText('Bloqueado')).toBeTruthy()
  })

  it('traz o webhook do Resend, os eventos a assinar, o DNS e nenhuma menção ao Brevo', async () => {
    const { container } = render(await IntegracaoPage({ searchParams: sp() }))
    const texto = container.textContent ?? ''
    expect(texto).toContain('/api/webhooks/resend')
    for (const e of ['email.opened', 'email.clicked', 'email.bounced', 'email.complained', 'contact.updated']) expect(texto).toContain(e)
    expect(texto).toContain('ogpericiacontabil.com.br')
    expect(texto).toContain('Hostinger')
    expect(texto.toLowerCase()).not.toContain('brevo')
  })
})

describe('funis', () => {
  it('lista etapas com prévia renderizada', async () => {
    const { container } = render(await FunilPage({ params: Promise.resolve({ slug: 'boas-vindas' }), searchParams: sp() }))
    expect(screen.getAllByText(/Etapa 1/).length).toBeGreaterThan(0)
    const iframes = container.querySelectorAll('iframe')
    expect(iframes.length).toBeGreaterThanOrEqual(3)
    expect(iframes[0].getAttribute('srcdoc')).toContain('descadastre-se')
    expect(iframes[0].getAttribute('sandbox')).toBe('')
    expect((container.textContent ?? '').toLowerCase()).not.toContain('brevo')
  })

  it('mostra envios dos últimos 30 dias e a fila de hoje', async () => {
    const { container } = render(await FunilPage({ params: Promise.resolve({ slug: 'boas-vindas' }), searchParams: sp() }))
    expect(container.textContent).toContain('Enviados (30 dias)')
    expect(container.textContent).toContain('Fila de hoje')
  })

  it('envios incertos aparecem com contato, etapa e data', async () => {
    funilDados.resumo = { ...funilDados.resumo, incertos: [{ contatoId: 9, nome: 'Ana', email: 'ana@example.com', etapa: 1, quando: new Date('2026-10-28T12:00:00Z') }] }
    const { container } = render(await FunilPage({ params: Promise.resolve({ slug: 'boas-vindas' }), searchParams: sp() }))
    const texto = container.textContent ?? ''
    expect(texto).toContain('Envios a conferir no Resend: o resultado não voltou; não são repetidos automaticamente')
    expect(texto).toContain('ana@example.com')
    funilDados.resumo = { ...funilDados.resumo, incertos: [] }
  })

  it('lista de funis sem menção ao Brevo', async () => {
    const { container } = render(await FunisPage({ searchParams: sp() }))
    expect((container.textContent ?? '').toLowerCase()).not.toContain('brevo')
    expect(screen.getByText('Boas-vindas')).toBeTruthy()
  })
})
