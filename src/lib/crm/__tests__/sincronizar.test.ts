import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { criarClienteBrevo } from '@/lib/brevo'
import { contatos, eventosContato, funilInscricoes, sincronizacoes } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { mudarStatus, upsertContato } from '../contatos'
import { inscrever, INTERROMPIDO_POR_TEMPO } from '../funis'
import { adicionarContatosALista, importarDoBrevo, sincronizarPendentes } from '../sincronizar'
import { criarBancoTesteBrevo } from './banco-teste-brevo'
import { brevoFalso } from './brevo-fake'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteBrevo())
})
afterEach(async () => {
  await fechar()
})

async function criar(email: string, extra: Record<string, unknown> = {}) {
  const r = await upsertContato({ email, nome: 'Fulano', baseLegal: 'consentimento', ...extra }, 'manual', { db })
  if (r.acao !== 'criado') throw new Error('não criou')
  return r.contatoId
}
async function linha(id: number) {
  const [c] = await db.select().from(contatos).where(eq(contatos.id, id))
  return c
}

describe('sincronizarPendentes', () => {
  it('sem chave: não toca em nada e diz "Brevo não conectado"', async () => {
    const id = await criar('a@example.com')
    const r = await sincronizarPendentes({ db, cliente: criarClienteBrevo({ apiKey: null }) })
    expect(r).toEqual({ conectado: false, mensagem: 'Brevo não conectado' })
    expect((await linha(id)).syncStatus).toBe('pendente')
    expect(await db.select().from(sincronizacoes)).toHaveLength(0)
  })

  it('envia pendentes com atributos, grava sincronizado e registra a execução', async () => {
    const id = await criar('a@example.com', { telefone: '11 99999-0000', escritorio: 'Silva Adv', cidade: 'Campinas', uf: 'SP' })
    const b = brevoFalso()
    const r = await sincronizarPendentes({ db, cliente: b.cliente })
    expect(r).toEqual({ conectado: true, enviados: 1, erros: 0, restantes: 0, interrompido: null })
    const c = await linha(id)
    expect(c.syncStatus).toBe('sincronizado')
    expect(b.contatos.get('a@example.com')?.atributos).toEqual({
      NOME: 'Fulano', TELEFONE: '11 99999-0000', ESCRITORIO: 'Silva Adv', CIDADE: 'Campinas', UF: 'SP',
    })
    const [s] = await db.select().from(sincronizacoes)
    expect(s).toMatchObject({ fonte: 'brevo', status: 'ok', linhas: 1 })
  })

  it('campo vazio (inclusive nome vazio) não vai como texto vazio', async () => {
    await upsertContato({ email: 'sem-nome@example.com', baseLegal: 'contrato', cidade: 'Santos' }, 'manual', { db })
    const b = brevoFalso()
    await sincronizarPendentes({ db, cliente: b.cliente })
    expect(b.contatos.get('sem-nome@example.com')?.atributos).toEqual({ CIDADE: 'Santos' })
  })

  it('em lotes: respeita o teto por execução e continua na próxima', async () => {
    for (let i = 0; i < 7; i++) await criar(`c${i}@example.com`)
    const b = brevoFalso()
    const r1 = await sincronizarPendentes({ db, cliente: b.cliente, limite: 5, tamanhoLote: 2, paralelo: 2 })
    expect(r1).toMatchObject({ enviados: 5, restantes: 2 })
    const r2 = await sincronizarPendentes({ db, cliente: b.cliente, limite: 5, tamanhoLote: 2 })
    expect(r2).toMatchObject({ enviados: 2, restantes: 0 })
    expect(b.chamadas.filter((c) => c.op === 'upsert')).toHaveLength(7)
  })

  it('não reenvia quem já está sincronizado', async () => {
    await criar('a@example.com')
    const b = brevoFalso()
    await sincronizarPendentes({ db, cliente: b.cliente })
    await sincronizarPendentes({ db, cliente: b.cliente })
    expect(b.chamadas.filter((c) => c.op === 'upsert')).toHaveLength(1)
  })

  it('erro de um contato: marca erro com mensagem curta sem dado do contato e segue com os outros', async () => {
    const ruim = await criar('ruim@example.com')
    const bom = await criar('bom@example.com')
    const b = brevoFalso()
    b.falhar('ruim@example.com', { ok: false, motivo: 'http', status: 400, codigo: 'invalid_parameter', mensagem: 'O Brevo recusou os dados (400) (código invalid_parameter).' })
    const r = await sincronizarPendentes({ db, cliente: b.cliente })
    expect(r).toMatchObject({ enviados: 1, erros: 1, restantes: 1, interrompido: null })
    const c = await linha(ruim)
    expect(c.syncStatus).toBe('erro')
    expect(c.syncErro).toBe('O Brevo recusou os dados (400) (código invalid_parameter).')
    expect(c.syncErro).not.toContain('example.com')
    expect((await linha(bom)).syncStatus).toBe('sincronizado')
    const [s] = await db.select().from(sincronizacoes)
    expect(s.status).toBe('parcial')
  })

  it('erro geral (chave recusada): para na hora e deixa os contatos pendentes', async () => {
    const id = await criar('a@example.com')
    await criar('b@example.com')
    const b = brevoFalso()
    b.falharTudo({ ok: false, motivo: 'http', status: 401, mensagem: 'O Brevo recusou a chave de API (401). Confira BREVO_API_KEY.' })
    const r = await sincronizarPendentes({ db, cliente: b.cliente, paralelo: 1 })
    expect(r).toMatchObject({ enviados: 0, erros: 0, restantes: 2 })
    expect(r.conectado && r.interrompido).toMatch(/401/)
    expect((await linha(id)).syncStatus).toBe('pendente')
    expect(b.chamadas).toHaveLength(1)
    const [s] = await db.select().from(sincronizacoes)
    expect(s.status).toBe('erro')
  })

  it('contato editado durante o envio continua pendente', async () => {
    const id = await criar('a@example.com')
    const b = brevoFalso()
    const original = b.cliente.upsertContato
    b.cliente.upsertContato = async (c) => {
      await upsertContato({ email: 'a@example.com', cidade: 'Santos' }, 'manual', { db, agora: new Date(Date.now() + 5000) })
      return original(c)
    }
    await sincronizarPendentes({ db, cliente: b.cliente })
    expect((await linha(id)).syncStatus).toBe('pendente')
  })
})

describe('descadastrado nunca entra em lista (Review Focus 3)', () => {
  it('sincronização: vai com emailBlacklisted, sem listIds, e sai de todas as listas', async () => {
    const id = await criar('a@example.com')
    const b = brevoFalso([{ id: 9, email: 'a@example.com', emailBlacklisted: false, listIds: [3, 4], atributos: {} }])
    await mudarStatus(id, 'descadastrado', { db, origem: 'manual' })
    await sincronizarPendentes({ db, cliente: b.cliente })
    const upserts = b.chamadas.filter((c) => c.op === 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].corpo).toMatchObject({ emailBlacklisted: true })
    expect(upserts[0].corpo).not.toHaveProperty('listIds')
    expect(b.chamadas.some((c) => c.op === 'adicionarALista')).toBe(false)
    const noBrevo = b.contatos.get('a@example.com')!
    expect(noBrevo.emailBlacklisted).toBe(true)
    expect(noBrevo.listIds).toEqual([])
    expect((await linha(id)).syncStatus).toBe('sincronizado')
  })

  it('adicionarContatosALista filtra descadastrados antes de chamar o Brevo', async () => {
    const a = await criar('a@example.com')
    const d = await criar('d@example.com')
    await mudarStatus(d, 'descadastrado', { db })
    const b = brevoFalso()
    const r = await adicionarContatosALista(7, [a, d, d], { db, cliente: b.cliente })
    expect(r).toEqual({ ok: true, adicionados: 1, recusadosDescadastrados: 1, falhas: 0 })
    const chamada = b.chamadas.find((c) => c.op === 'adicionarALista')
    expect(chamada?.corpo).toEqual(['a@example.com'])
  })

  it('adicionarContatosALista só com descadastrados nem chama o Brevo', async () => {
    const d = await criar('d@example.com')
    await mudarStatus(d, 'descadastrado', { db })
    const b = brevoFalso()
    const r = await adicionarContatosALista(7, [d], { db, cliente: b.cliente })
    expect(r).toMatchObject({ ok: true, adicionados: 0, recusadosDescadastrados: 1 })
    expect(b.chamadas).toHaveLength(0)
  })

  it('adicionarContatosALista sem chave: não conectado', async () => {
    const r = await adicionarContatosALista(7, [1], { db, cliente: criarClienteBrevo({ apiKey: null }) })
    expect(r).toEqual({ ok: false, mensagem: 'Brevo não conectado' })
  })
})

describe('importarDoBrevo', () => {
  it('traz contatos com origem brevo, base legal do lote e bloqueados como descadastrados', async () => {
    const b = brevoFalso([
      { id: 1, email: 'a@example.com', emailBlacklisted: false, listIds: [], atributos: { NOME: 'Ana', UF: 'SP' } },
      { id: 2, email: 'b@example.com', emailBlacklisted: true, listIds: [], atributos: { FIRSTNAME: 'Bia', LASTNAME: 'Lima' } },
      { id: 3, email: null, emailBlacklisted: false, listIds: [], atributos: {} },
    ])
    const r = await importarDoBrevo({ db, cliente: b.cliente, baseLegal: 'legitimo_interesse', porPagina: 2 })
    expect(r).toMatchObject({ conectado: true, lidos: 3, criados: 2, ignorados: 1, erro: null, truncado: false })
    const todos = await db.select().from(contatos)
    const a = todos.find((c) => c.emailNormalizado === 'a@example.com')!
    const bb = todos.find((c) => c.emailNormalizado === 'b@example.com')!
    expect(a).toMatchObject({ origem: 'brevo', baseLegal: 'legitimo_interesse', nome: 'Ana', uf: 'SP', status: 'lead' })
    expect(bb).toMatchObject({ nome: 'Bia Lima', status: 'descadastrado' })
  })

  it('não tira ninguém de descadastrado', async () => {
    const id = await criar('a@example.com')
    await mudarStatus(id, 'descadastrado', { db })
    const b = brevoFalso([{ id: 1, email: 'a@example.com', emailBlacklisted: false, listIds: [], atributos: {} }])
    await importarDoBrevo({ db, cliente: b.cliente, baseLegal: 'consentimento' })
    expect((await linha(id)).status).toBe('descadastrado')
  })

  it('para no teto e avisa', async () => {
    const b = brevoFalso(Array.from({ length: 5 }, (_, i) => ({ id: i, email: `c${i}@example.com`, emailBlacklisted: false, listIds: [], atributos: {} })))
    const r = await importarDoBrevo({ db, cliente: b.cliente, baseLegal: 'contrato', maxContatos: 3, porPagina: 2 })
    expect(r).toMatchObject({ lidos: 3, criados: 3, truncado: true })
  })

  it('sem chave: não conectado', async () => {
    const r = await importarDoBrevo({ db, cliente: criarClienteBrevo({ apiKey: null }), baseLegal: 'contrato' })
    expect(r).toEqual({ conectado: false, mensagem: 'Brevo não conectado' })
  })
})

describe('estadoIntegracao', () => {
  it('conta por situação e traz a última execução', async () => {
    await criar('a@example.com')
    await criar('b@example.com')
    const b = brevoFalso()
    b.falhar('b@example.com', { ok: false, motivo: 'http', status: 400, mensagem: 'O Brevo recusou os dados (400).' })
    await sincronizarPendentes({ db, cliente: b.cliente })
    await criar('c@example.com')
    const { estadoIntegracao } = await import('../sincronizar')
    const e = await estadoIntegracao({ db })
    expect(e.porSync).toEqual({ pendente: 1, sincronizado: 1, erro: 1 })
    expect(e.ultimaSincronizacao?.status).toBe('parcial')
    expect(e.ultimaImportacao).toBeNull()
  })
})

describe('leitura de volta do bloqueio no Brevo', () => {
  it('contato já existente no Brevo e bloqueado lá vira descadastrado (origem brevo) e sai dos funis', async () => {
    const id = await criar('bloq@example.com')
    await db.update(contatos).set({ status: 'cliente' }).where(eq(contatos.id, id))
    await inscrever('nutricao-blog', [id], { db, caminho: 'manual' })
    const b = brevoFalso([{ id: 55, email: 'bloq@example.com', emailBlacklisted: true, listIds: [3], atributos: {} }])
    const r = await sincronizarPendentes({ db, cliente: b.cliente, registrar: false })
    expect(r).toMatchObject({ enviados: 1, interrompido: null })
    const c = await linha(id)
    expect(c.status).toBe('descadastrado')
    const evs = await db.select().from(eventosContato).where(eq(eventosContato.contatoId, id))
    expect(evs.find((e) => e.tipo === 'mudou_status')?.dados).toMatchObject({ de: 'cliente', para: 'descadastrado', origem: 'brevo' })
    const [i] = await db.select().from(funilInscricoes).where(eq(funilInscricoes.contatoId, id))
    expect(i.status).toBe('saiu')
    // Fica pendente para a próxima rodada levar o bloqueio e tirar das listas.
    expect(c.syncStatus).toBe('pendente')
    await sincronizarPendentes({ db, cliente: b.cliente, registrar: false })
    expect(b.contatos.get('bloq@example.com')?.listIds).toEqual([])
  })

  it('não bloqueado no Brevo: nada muda', async () => {
    const id = await criar('livre@example.com')
    const b = brevoFalso([{ id: 56, email: 'livre@example.com', emailBlacklisted: false, listIds: [], atributos: {} }])
    await sincronizarPendentes({ db, cliente: b.cliente, registrar: false })
    expect(await linha(id)).toMatchObject({ status: 'lead', syncStatus: 'sincronizado' })
  })
})

describe('prazo da rotina (deveParar)', () => {
  it('para entre lotes e diz que foi por tempo; o resto fica pendente', async () => {
    for (let i = 0; i < 4; i++) await criar(`p${i}@example.com`)
    const b = brevoFalso()
    let chamadas = 0
    const r = await sincronizarPendentes({ db, cliente: b.cliente, tamanhoLote: 2, paralelo: 2, registrar: false, deveParar: () => chamadas++ > 0 })
    expect(r).toMatchObject({ enviados: 2, interrompido: INTERROMPIDO_POR_TEMPO })
    const pendentes = (await db.select().from(contatos)).filter((c) => c.syncStatus === 'pendente')
    expect(pendentes).toHaveLength(2)
  })
})
