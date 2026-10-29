import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { BancoCrm } from '../banco'
import { mudarStatus, upsertContato } from '../contatos'
import { contarPorStatus, listarContatos, tagsEmUso } from '../consultas'
import { CABECALHO_EXPORTACAO, fluxoExportacao, linhaExportacao } from '../exportar'
import { lerFiltro, queryDoFiltro } from '../filtros'
import { criarBancoTeste } from './banco-teste'

describe('lerFiltro', () => {
  it('lê e valida os parâmetros da URL', () => {
    expect(lerFiltro({ q: '  souza ', status: 'cliente', origem: 'xx', tag: 'Trabalhista', pagina: '3' })).toEqual({
      q: 'souza', status: 'cliente', origem: null, tag: 'trabalhista', pagina: 3,
    })
    expect(lerFiltro({ pagina: '-1', status: ['lead', 'cliente'] })).toMatchObject({ pagina: 1, status: null })
    expect(queryDoFiltro({ q: 'a b', status: null, origem: 'site', tag: null, pagina: 2 })).toBe('q=a+b&origem=site&pagina=2')
  })
})

describe('consultas e exportação', () => {
  let db: BancoCrm
  let fechar: () => Promise<void>
  beforeAll(async () => {
    ;({ db, fechar } = await criarBancoTeste())
    await upsertContato({ email: 'ana@example.com', nome: 'Ana Souza', escritorio: 'Souza & Lima', baseLegal: 'consentimento', tags: ['trabalhista'] }, 'site', { db })
    await upsertContato({ email: 'bia@example.com', nome: 'Bia', cidade: 'Natal', uf: 'RN', baseLegal: 'contrato', tags: ['previdenciário'] }, 'planilha', { db })
    const c = await upsertContato({ email: 'caio@example.com', nome: '=HYPERLINK("x")', baseLegal: 'legitimo_interesse' }, 'manual', { db })
    await mudarStatus(c.contatoId!, 'descadastrado', { db })
    await upsertContato({ email: 'pct_100%@example.com', nome: 'Percentual', baseLegal: 'contrato' }, 'manual', { db })
  })
  afterAll(async () => {
    await fechar()
  })

  it('busca por nome, email e escritório, sem tratar % e _ como curinga', async () => {
    const f = (q: string) => listarContatos({ q, status: null, origem: null, tag: null, pagina: 1 }, { db })
    expect((await f('souza')).itens.map((c) => c.emailNormalizado)).toEqual(['ana@example.com'])
    expect((await f('BIA@')).total).toBe(1)
    expect((await f('lima')).total).toBe(1)
    expect((await f('%')).itens.map((c) => c.nome)).toEqual(['Percentual'])
  })

  it('filtra por status, origem e tag e conta por status', async () => {
    const base = { q: '', status: null, origem: null, tag: null, pagina: 1 } as const
    expect((await listarContatos({ ...base, status: 'descadastrado' }, { db })).total).toBe(1)
    expect((await listarContatos({ ...base, origem: 'planilha' }, { db })).itens[0].nome).toBe('Bia')
    expect((await listarContatos({ ...base, tag: 'trabalhista' }, { db })).total).toBe(1)
    expect(await contarPorStatus({ db })).toEqual({ lead: 3, cliente: 0, inativo: 0, descadastrado: 1 })
    expect(await tagsEmUso({ db })).toEqual(['previdenciário', 'trabalhista'])
  })

  it('pagina', async () => {
    const r = await listarContatos({ q: '', status: null, origem: null, tag: null, pagina: 2 }, { db, porPagina: 3 })
    expect(r.total).toBe(4)
    expect(r.itens).toHaveLength(1)
  })

  it('exporta em UTF-8 com BOM, ";" e acentos, só o filtrado, sem fórmula executável', async () => {
    const fluxo = fluxoExportacao({ q: '', status: null, origem: null, tag: null, pagina: 1 }, { db, tamanhoBloco: 2 })
    const bytes = new Uint8Array(await new Response(fluxo).arrayBuffer())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const texto = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(texto.startsWith('\uFEFF')).toBe(true)
    const linhas = texto.slice(1).split('\r\n').filter(Boolean)
    expect(linhas[0]).toBe(CABECALHO_EXPORTACAO.join(';'))
    expect(linhas).toHaveLength(5)
    expect(texto).toContain('previdenciário')
    expect(texto).toContain(`'=HYPERLINK(""x"")`)
    const so = fluxoExportacao({ q: '', status: null, origem: 'site', tag: null, pagina: 1 }, { db })
    expect((await new Response(so).text()).split('\r\n').filter(Boolean)).toHaveLength(2)
  })

  it('linha de exportação em pt-BR', () => {
    const l = linhaExportacao({
      id: 1, nome: 'Ana', email: 'Ana@example.com', emailNormalizado: 'ana@example.com', telefone: null, escritorio: null,
      cidade: 'Natal', uf: 'RN', origem: 'site', baseLegal: 'legitimo_interesse', consentimentoEm: null, status: 'lead',
      tags: ['a', 'b'], notas: null, resendContatoId: null, syncStatus: 'pendente', syncErro: null, dadosApagadosEm: null,
      criadoEm: new Date('2026-10-29T02:30:00Z'), atualizadoEm: new Date('2026-10-29T02:30:00Z'),
    })
    expect(l).toEqual(['Ana', 'Ana@example.com', '', '', 'Natal', 'RN', 'Lead', 'Site', 'Legítimo interesse', '', 'a, b', '', '28/10/2026 23:30', '28/10/2026 23:30'])
  })
})
