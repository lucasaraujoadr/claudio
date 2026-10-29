import { describe, expect, it } from 'vitest'
import { lerChecklist, lerEmails, lerInteiro, paramsResultadoInscricao } from '../funis-formulario'

describe('formulários dos funis', () => {
  it('lê emails por linha, vírgula ou ponto e vírgula; normaliza, deduplica e conta inválidos', () => {
    expect(lerEmails('A@Example.com\n b@example.com ; a@example.com, invalido@')).toEqual({ emails: ['a@example.com', 'b@example.com'], invalidos: 1, excedeu: false })
    expect(lerEmails('').emails).toEqual([])
  })
  it('limita a 1000 emails', () => {
    const r = lerEmails(Array.from({ length: 1001 }, (_, i) => `p${i}@example.com`).join('\n'))
    expect(r.emails).toHaveLength(1000)
    expect(r.excedeu).toBe(true)
  })
  it('checklist só conta caixas marcadas com 1', () => {
    const f = new FormData()
    f.set('avaliacao', '1')
    f.set('descadastro', 'on')
    expect(lerChecklist(f)).toEqual({ avaliacaoLegitimoInteresse: true, descadastroEmTodoEmail: false, volumeBaixoAquecido: false })
  })
  it('inteiro só com dígitos', () => {
    expect(lerInteiro('12')).toBe(12)
    expect(lerInteiro(' 7 ')).toBe(7)
    expect(lerInteiro('-1')).toBeNull()
    expect(lerInteiro('1e3')).toBeNull()
    expect(lerInteiro(null)).toBeNull()
  })
  it('resumo da inscrição vai na URL sem dado de contato', () => {
    const p = paramsResultadoInscricao({ inscritos: [1, 2], jaInscritos: 1, recusados: { base_legal: 2, nao_encontrado: 1 } }, 3)
    expect(p.toString()).toBe('aviso=inscricao&inscritos=2&ja=1&nao=4&motivos=base_legal%3A2')
  })
})
