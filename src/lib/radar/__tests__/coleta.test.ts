import { describe, expect, it } from 'vitest'
import { coletarTendencias, tendenciasSchemaModelo, validarTendencias, type TendenciasModelo } from '../coleta'

const HOJE = new Date('2026-10-29T10:00:00Z')
const item = (fonteUrl: string, extra: Partial<TendenciasModelo['tendencias'][number]> = {}) => ({
  titulo: `Fato ${fonteUrl}`, resumo: 'Resumo.', fonteUrl, publicadoEm: '2026-10-27', palavrasChave: ['selic'], ...extra,
})
const res = (itens: TendenciasModelo['tendencias'], fontes: string[]) => ({ valor: { tendencias: itens }, fontes })

describe('validarTendencias', () => {
  it('aceita URL presente em fontes e rejeita a ausente, com contagem por motivo', () => {
    const { validas, relatorio } = validarTendencias(
      res([item('https://www.stj.jus.br/a'), item('https://www.stj.jus.br/inventada')], ['https://www.stj.jus.br/a']),
      HOJE,
    )
    expect(validas.map((v) => v.fonteUrl)).toEqual(['https://www.stj.jus.br/a'])
    expect(relatorio).toMatchObject({ retornadas: 2, aceitas: 1, rejeitadas: { fonte_nao_citada: 1 } })
    expect(relatorio.urlsRejeitadas).toEqual([{ url: 'https://www.stj.jus.br/inventada', motivo: 'fonte_nao_citada' }])
  })
  it('rejeita URL de busca, javascript: e repetida', () => {
    const busca = 'https://tst.jus.br/busca?q=selic'
    const { validas, relatorio } = validarTendencias(
      res(
        [item(busca), item('javascript:alert(1)'), item('https://a.gov.br/x'), item('https://A.gov.br/x/'), item('https://a.gov.br/x#frag')],
        [busca, 'javascript:alert(1)', 'https://a.gov.br/x'],
      ),
      HOJE,
    )
    expect(validas).toHaveLength(1)
    expect(relatorio.rejeitadas).toEqual({ pagina_de_busca: 1, url_invalida: 1, repetida: 2 })
  })
  it('o hash é igual para a mesma fonte escrita de formas equivalentes', () => {
    const a = validarTendencias(res([item('https://a.gov.br/x')], ['https://a.gov.br/x']), HOJE).validas[0].hash
    const b = validarTendencias(res([item('https://A.gov.br/x/#t')], ['https://a.gov.br/x']), HOJE).validas[0].hash
    expect(a).toBe(b)
  })
  it('limita a 10 e conta o excedente', () => {
    const urls = Array.from({ length: 13 }, (_, i) => `https://a.gov.br/${i}`)
    const { validas, relatorio } = validarTendencias(res(urls.map((u) => item(u)), urls), HOJE)
    expect(validas).toHaveLength(10)
    expect(relatorio.rejeitadas.excedente).toBe(3)
  })
  it('descarta item inválido sem perder os demais; data inválida vira null; data antiga é rejeitada', () => {
    const { validas, relatorio } = validarTendencias(
      res(
        [item('https://a.gov.br/1', { titulo: '' }), item('https://a.gov.br/2', { publicadoEm: '31/02/2026' }), item('https://a.gov.br/3', { publicadoEm: '2026-01-01' })],
        ['https://a.gov.br/1', 'https://a.gov.br/2', 'https://a.gov.br/3'],
      ),
      HOJE,
    )
    expect(validas.map((v) => [v.fonteUrl, v.publicadoEm])).toEqual([['https://a.gov.br/2', null]])
    expect(relatorio.rejeitadas).toEqual({ invalida: 1, antiga: 1 })
  })
  it('corte de data: 9 dias (7 + 2 de tolerância) passa, 10 dias não', () => {
    const u = ['https://a.gov.br/9', 'https://a.gov.br/10']
    const { validas, relatorio } = validarTendencias(
      res([item(u[0], { publicadoEm: '2026-10-20' }), item(u[1], { publicadoEm: '2026-10-19' })], u),
      HOJE,
    )
    expect(validas.map((v) => v.fonteUrl)).toEqual([u[0]])
    expect(relatorio.rejeitadas).toEqual({ antiga: 1 })
  })
  it('sem data: grava no máximo 3 por execução, conta em semData e rejeita o excedente', () => {
    const u = Array.from({ length: 5 }, (_, i) => `https://a.gov.br/s${i}`)
    const { validas, relatorio } = validarTendencias(res(u.map((x) => item(x, { publicadoEm: null })), u), HOJE)
    expect(validas).toHaveLength(3)
    expect(relatorio.semData).toBe(3)
    expect(relatorio.rejeitadas).toEqual({ sem_data_excedente: 2 })
  })
  it('itens datados não são afetados pelo limite de sem data', () => {
    const u = ['https://a.gov.br/d1', 'https://a.gov.br/s1']
    const { validas, relatorio } = validarTendencias(res([item(u[0]), item(u[1], { publicadoEm: null })], u), HOJE)
    expect(validas).toHaveLength(2)
    expect(relatorio.semData).toBe(1)
  })
  it('grava a URL citada normalizada: sem fragmento nem credenciais', () => {
    const { validas } = validarTendencias(res([item('https://user:senha@A.gov.br/x/#topo')], ['https://a.gov.br/x']), HOJE)
    expect(validas[0].fonteUrl).toBe('https://a.gov.br/x')
  })
})

describe('coletarTendencias', () => {
  it('faz uma única chamada de busca', async () => {
    let n = 0
    const r = await coletarTendencias(HOJE, async () => {
      n++
      return res([item('https://a.gov.br/1')], ['https://a.gov.br/1']) as never
    })
    expect(n).toBe(1)
    expect(r.validas).toHaveLength(1)
  })
})

describe('tendenciasSchemaModelo', () => {
  it('não tem minLength nem maxLength no JSON Schema enviado ao modelo', async () => {
    const { zodSchema } = await import('ai')
    const json = JSON.stringify(await zodSchema(tendenciasSchemaModelo).jsonSchema)
    expect(json).not.toContain('minLength')
    expect(json).not.toContain('maxLength')
  })
})
