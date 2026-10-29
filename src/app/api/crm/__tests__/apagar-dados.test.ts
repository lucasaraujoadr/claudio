import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const apagarDadosAPedido = vi.fn()
vi.mock('@/lib/crm/apagar-dados', () => ({ apagarDadosAPedido }))

const { POST } = await import('../contatos/[id]/apagar/route')

function enviar(campos: Record<string, string>, id = '7') {
  return POST(
    new NextRequest(`http://localhost/api/crm/contatos/${id}/apagar`, {
      method: 'POST',
      body: new URLSearchParams(campos),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }),
    { params: Promise.resolve({ id }) },
  )
}

describe('POST /api/crm/contatos/[id]/apagar', () => {
  beforeEach(() => apagarDadosAPedido.mockReset())

  it('sem a confirmação: não apaga', async () => {
    const r = await enviar({ motivo: 'pediu por email' })
    expect(apagarDadosAPedido).not.toHaveBeenCalled()
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toContain('/crm/contatos/7?aviso=apagar-sem-ciente')
  })

  it('com confirmação e motivo: apaga e volta ao contato', async () => {
    apagarDadosAPedido.mockResolvedValue({ ok: true })
    const r = await enviar({ motivo: 'pediu por email', ciente: '1' })
    expect(apagarDadosAPedido).toHaveBeenCalledWith(7, 'pediu por email')
    expect(r.headers.get('location')).toContain('aviso=dados-apagados')
  })

  it('sem motivo: avisa', async () => {
    apagarDadosAPedido.mockResolvedValue({ ok: false, motivo: 'sem_motivo' })
    const r = await enviar({ motivo: ' ', ciente: '1' })
    expect(r.headers.get('location')).toContain('aviso=apagar-sem-motivo')
  })
})
