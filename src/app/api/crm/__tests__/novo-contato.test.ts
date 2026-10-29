import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const upsertContato = vi.fn()
const mudarStatus = vi.fn()
vi.mock('@/lib/crm/contatos', () => ({ upsertContato, mudarStatus }))

const { POST } = await import('../contatos/route')

function enviar(campos: Record<string, string>) {
  const corpo = new URLSearchParams(campos)
  return POST(new NextRequest('http://localhost/api/crm/contatos', {
    method: 'POST',
    body: corpo,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  }))
}

describe('POST /api/crm/contatos — status no cadastro', () => {
  beforeEach(() => {
    upsertContato.mockReset()
    mudarStatus.mockReset()
  })

  it('contato existente com o status padrão: o status atual não muda', async () => {
    upsertContato.mockResolvedValue({ acao: 'atualizado', contatoId: 7, alterados: ['nome'], mantidos: [] })
    const r = await enviar({ email: 'a@example.com', base_legal: 'contrato', status: '' })
    expect(upsertContato).toHaveBeenCalledWith(expect.objectContaining({ status: 'lead' }), 'manual')
    expect(mudarStatus).not.toHaveBeenCalled()
    expect(r.headers.get('location')).toContain('/crm/contatos/7?aviso=existia')
  })

  it('contato existente com status escolhido: aplica por mudarStatus (explícito)', async () => {
    upsertContato.mockResolvedValue({ acao: 'inalterado', contatoId: 7, mantidos: [] })
    mudarStatus.mockResolvedValue({ ok: false, motivo: 'descadastrado' })
    const r = await enviar({ email: 'a@example.com', base_legal: 'contrato', status: 'cliente' })
    expect(mudarStatus).toHaveBeenCalledWith(7, 'cliente', { origem: 'manual' })
    expect(r.headers.get('location')).toContain('aviso=existia-descadastrado')
  })

  it('contato novo: o status vai na criação, sem mudarStatus', async () => {
    upsertContato.mockResolvedValue({ acao: 'criado', contatoId: 9 })
    await enviar({ email: 'b@example.com', base_legal: 'contrato', status: 'cliente' })
    expect(upsertContato).toHaveBeenCalledWith(expect.objectContaining({ status: 'cliente' }), 'manual')
    expect(mudarStatus).not.toHaveBeenCalled()
  })

  it('campo longo volta com o nome do campo', async () => {
    const r = await enviar({ email: 'b@example.com', base_legal: 'contrato', notas: 'x'.repeat(5001) })
    expect(r.headers.get('location')).toContain('erro=longo&campo=notas')
    expect(upsertContato).not.toHaveBeenCalled()
  })
})
