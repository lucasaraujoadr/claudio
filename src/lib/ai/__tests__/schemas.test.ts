import { describe, expect, it } from 'vitest'
import { clustersSchema, clustersSchemaModelo } from '../schemas'

const tema = { titulo: 'Quando contratar um perito contábil', keyword: 'perito contábil', intencao: 'comercial', prioridade: 'alta' }
const cluster = { nome: 'Perícia', keywordPilar: 'perícia contábil judicial', intencao: 'informacional', prioridade: 'alta', temas: [tema] }
const resposta = (c: Record<string, unknown> = {}) => ({ clusters: [{ ...cluster, ...c }] })

describe('clustersSchema', () => {
  it('aceita resposta bem formada', () => {
    expect(clustersSchema.safeParse(resposta()).success).toBe(true)
  })
  it('rejeita cluster sem keyword pilar', () => {
    const { keywordPilar: _k, ...semPilar } = cluster
    expect(clustersSchema.safeParse({ clusters: [semPilar] }).success).toBe(false)
  })
  it('rejeita intencao fora do enum', () => {
    expect(clustersSchema.safeParse(resposta({ intencao: 'outra' })).success).toBe(false)
  })
  it('rejeita prioridade fora do enum', () => {
    expect(clustersSchema.safeParse(resposta({ prioridade: 'urgente' })).success).toBe(false)
  })
  it('rejeita cluster sem nenhum tema', () => {
    expect(clustersSchema.safeParse(resposta({ temas: [] })).success).toBe(false)
  })
  it('rejeita textos acima do limite', () => {
    expect(clustersSchema.safeParse(resposta({ temas: [{ ...tema, titulo: 'x'.repeat(121) }] })).success).toBe(false)
    expect(clustersSchema.safeParse(resposta({ keywordPilar: 'x'.repeat(81) })).success).toBe(false)
  })
})

describe('clustersSchemaModelo', () => {
  it('não tem minLength nem maxLength no JSON Schema enviado à OpenAI', async () => {
    const { zodSchema } = await import('ai')
    const json = JSON.stringify(await zodSchema(clustersSchemaModelo).jsonSchema)
    expect(json).not.toContain('minLength')
    expect(json).not.toContain('maxLength')
    expect(json).toContain('minItems')
  })
})
