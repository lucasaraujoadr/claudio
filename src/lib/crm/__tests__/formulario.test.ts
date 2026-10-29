import { describe, it, expect } from 'vitest'
import { lerEdicao, lerId, lerMapeamento, lerNovoContato, mensagemCampoLongo } from '../formulario'

function form(campos: Record<string, string>): FormData {
  const f = new FormData()
  for (const [k, v] of Object.entries(campos)) f.set(k, v)
  return f
}

describe('formulários do CRM', () => {
  it('novo contato exige email válido e base legal', () => {
    expect(lerNovoContato(form({ email: 'x' , base_legal: 'contrato' }))).toEqual({ ok: false, erro: 'email' })
    expect(lerNovoContato(form({ email: 'a@example.com' }))).toEqual({ ok: false, erro: 'base-legal' })
    expect(lerNovoContato(form({ email: 'a@example.com', base_legal: 'contrato', uf: 'ZZ' }))).toEqual({ ok: false, erro: 'uf' })
    expect(lerNovoContato(form({ email: 'a@example.com', base_legal: 'contrato', status: 'descadastrado' }))).toEqual({ ok: false, erro: 'status' })
    const r = lerNovoContato(form({ email: ' a@example.com ', base_legal: 'consentimento', tags: 'x, y', nome: ' Ana ' }))
    expect(r).toMatchObject({ ok: true, statusEscolhido: null, dados: { email: 'a@example.com', baseLegal: 'consentimento', status: 'lead', tags: ['x', 'y'], nome: 'Ana' } })
    expect(lerNovoContato(form({ email: 'a@example.com', base_legal: 'contrato', status: 'cliente' }))).toMatchObject({ ok: true, statusEscolhido: 'cliente', dados: { status: 'cliente' } })
  })

  it('campo acima do limite é recusado com o nome do campo, não cortado', () => {
    expect(lerNovoContato(form({ email: 'a@example.com', base_legal: 'contrato', notas: 'x'.repeat(5001) }))).toEqual({ ok: false, erro: 'longo', campo: 'notas' })
    expect(lerEdicao(form({ base_legal: 'contrato', nome: 'x'.repeat(201) }))).toEqual({ ok: false, erro: 'longo', campo: 'nome' })
    const muitas = Array.from({ length: 51 }, (_, i) => `t${i}`).join(',')
    expect(lerEdicao(form({ base_legal: 'contrato', tags: muitas }))).toEqual({ ok: false, erro: 'longo', campo: 'tags' })
    expect(lerEdicao(form({ base_legal: 'contrato', notas: 'x'.repeat(5000) })).ok).toBe(true)
    expect(mensagemCampoLongo('notas')).toContain('5.000')
  })

  it('edição exige base legal e não aceita status nem email', () => {
    expect(lerEdicao(form({ nome: 'A' }))).toEqual({ ok: false, erro: 'base-legal' })
    const r = lerEdicao(form({ base_legal: 'contrato', status: 'lead', email: 'b@example.com', telefone: '' }))
    expect(r.ok && r.edicao).toEqual({ nome: '', telefone: '', escritorio: '', cidade: '', uf: '', baseLegal: 'contrato', tags: [], notas: '' })
  })

  it('mapeamento só com índices numéricos', () => {
    expect(lerMapeamento(form({ col_email: '1', col_nome: '0' }))).toMatchObject({ email: 1, nome: 0, telefone: null })
    expect(lerMapeamento(form({ col_email: '1; drop' }))).toBeNull()
  })

  it('id de rota', () => {
    expect(lerId('12')).toBe(12)
    expect(lerId('0')).toBeNull()
    expect(lerId('1e3')).toBeNull()
  })
})
