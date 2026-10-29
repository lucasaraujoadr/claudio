import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { artigoSchemaModelo } from '../formato'
import { pesquisaSchemaModelo, reescritaSchemaModelo } from '../prompts'
import { briefingSchemaModelo } from '@/lib/ai/schemas'
import { tesesSchemaModelo } from '@/lib/radar/teses'

// Saída estruturada estrita (OpenAI): todo objeto precisa listar TODAS as suas propriedades em `required`.
function violacoes(no: unknown, caminho = '#'): string[] {
  if (!no || typeof no !== 'object') return []
  if (Array.isArray(no)) return no.flatMap((n, i) => violacoes(n, `${caminho}[${i}]`))
  const n = no as Record<string, unknown>
  const saida: string[] = []
  if (n.properties && typeof n.properties === 'object') {
    const chaves = Object.keys(n.properties)
    const req = Array.isArray(n.required) ? (n.required as string[]) : []
    const faltando = chaves.filter((k) => !req.includes(k))
    if (faltando.length) saida.push(`${caminho}: faltam em required: ${faltando.join(', ')}`)
  }
  for (const [k, v] of Object.entries(n)) saida.push(...violacoes(v, `${caminho}.${k}`))
  return saida
}

function verificar(schema: z.ZodType) {
  expect(violacoes(z.toJSONSchema(schema))).toEqual([])
}

describe('schemas enviados ao modelo são compatíveis com saída estrita', () => {
  it('artigoSchemaModelo', () => verificar(artigoSchemaModelo))
  it('pesquisaSchemaModelo', () => verificar(pesquisaSchemaModelo))
  it('reescritaSchemaModelo', () => verificar(reescritaSchemaModelo))
  it('briefingSchemaModelo (guarda)', () => verificar(briefingSchemaModelo))
  it('tesesSchemaModelo (guarda)', () => verificar(tesesSchemaModelo))
  it('o helper detecta campo opcional', () => {
    expect(violacoes(z.toJSONSchema(z.object({ a: z.string().optional() })))).not.toEqual([])
  })
})
