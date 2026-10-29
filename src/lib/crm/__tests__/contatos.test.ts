import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { contatos, eventosContato } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import {
  editarContato,
  linhaDoTempo,
  mudarStatus,
  reativarContato,
  registrarEvento,
  upsertContato,
  upsertContatos,
} from '../contatos'
import { criarBancoTeste } from './banco-teste'
import type { ResultadoUpsert } from '../contatos'

const alt = (r: ResultadoUpsert) => (r.acao === 'atualizado' ? r.alterados : undefined)

let db: BancoCrm
let fechar: () => Promise<void>

beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTeste())
})
afterEach(async () => {
  await fechar()
})

async function contatoPorEmail(email: string) {
  const [c] = await db.select().from(contatos).where(eq(contatos.emailNormalizado, email))
  return c
}
async function eventos(contatoId: number) {
  return db.select().from(eventosContato).where(eq(eventosContato.contatoId, contatoId)).orderBy(asc(eventosContato.id))
}
/** Simula o Brevo tendo sincronizado o contato. */
async function marcarSincronizado(id: number) {
  await db.update(contatos).set({ syncStatus: 'sincronizado' }).where(eq(contatos.id, id))
}

describe('upsertContato — criação', () => {
  it('cria pelo email normalizado, com evento "criado" e pendente de sincronização', async () => {
    const r = await upsertContato(
      { email: '  Ana@Example.COM ', nome: ' Ana Lima ', baseLegal: 'consentimento', tags: ['Trabalhista'] },
      'manual',
      { db },
    )
    expect(r.acao).toBe('criado')
    const c = await contatoPorEmail('ana@example.com')
    expect(c).toMatchObject({
      id: r.contatoId,
      email: 'Ana@Example.COM',
      nome: 'Ana Lima',
      origem: 'manual',
      baseLegal: 'consentimento',
      status: 'lead',
      tags: ['trabalhista'],
      syncStatus: 'pendente',
    })
    expect(c.consentimentoEm).toBeInstanceOf(Date)
    const ev = await eventos(c.id)
    expect(ev.map((e) => e.tipo)).toEqual(['criado'])
    expect(ev[0].dados).toMatchObject({ origem: 'manual' })
  })

  it('recusa email inválido e criação sem base legal, sem gravar nada', async () => {
    expect(await upsertContato({ email: 'nao-e-email', baseLegal: 'contrato' }, 'manual', { db })).toEqual({
      acao: 'ignorado',
      motivo: 'email_invalido',
    })
    expect(await upsertContato({ email: 'b@example.com' }, 'manual', { db })).toEqual({
      acao: 'ignorado',
      motivo: 'sem_base_legal',
    })
    expect(await db.select().from(contatos)).toHaveLength(0)
  })
})

describe('upsertContato — mescla', () => {
  it('preenche campos vazios, troca por valor novo não vazio, nunca apaga com vazio', async () => {
    await upsertContato(
      { email: 'c@example.com', nome: 'Carla', telefone: '11 9999-0000', baseLegal: 'contrato' },
      'manual',
      { db },
    )
    const r = await upsertContato(
      { email: 'C@example.com', nome: '  ', telefone: null, escritorio: 'Souza Advogados', cidade: 'Campinas', uf: 'são paulo' },
      'planilha',
      { db },
    )
    expect(r.acao).toBe('atualizado')
    expect(alt(r)?.sort()).toEqual(['cidade', 'escritorio', 'uf'])
    const c = await contatoPorEmail('c@example.com')
    expect(c).toMatchObject({
      nome: 'Carla',
      telefone: '11 9999-0000',
      escritorio: 'Souza Advogados',
      cidade: 'Campinas',
      uf: 'SP',
      origem: 'manual', // a origem é a do primeiro registro
    })
    const r2 = await upsertContato({ email: 'c@example.com', nome: 'Carla Souza' }, 'brevo', { db })
    expect(alt(r2)).toEqual(['nome'])
    expect((await contatoPorEmail('c@example.com')).nome).toBe('Carla Souza')
  })

  it('une as tags sem repetir e acrescenta notas sem duplicar', async () => {
    await upsertContato({ email: 't@example.com', baseLegal: 'contrato', tags: ['a', 'b'], notas: 'Primeira' }, 'manual', { db })
    await upsertContato({ email: 't@example.com', tags: ['B', 'c'], notas: 'Segunda' }, 'planilha', { db })
    await upsertContato({ email: 't@example.com', tags: [], notas: 'Segunda' }, 'planilha', { db })
    const c = await contatoPorEmail('t@example.com')
    expect(c.tags).toEqual(['a', 'b', 'c'])
    expect(c.notas).toBe('Primeira\n\nSegunda')
  })

  it('sem mudança: "inalterado", sem evento e sem mexer na sincronização', async () => {
    const { contatoId } = await upsertContato({ email: 'i@example.com', nome: 'I', baseLegal: 'contrato', tags: ['x'] }, 'manual', { db })
    await marcarSincronizado(contatoId!)
    const r = await upsertContato({ email: 'i@example.com', nome: 'I', tags: ['X'] }, 'planilha', { db })
    expect(r.acao).toBe('inalterado')
    const c = await contatoPorEmail('i@example.com')
    expect(c.syncStatus).toBe('sincronizado')
    expect((await eventos(c.id)).map((e) => e.tipo)).toEqual(['criado'])
  })

  it('marca pendente só quando muda campo que vai para o Brevo', async () => {
    const { contatoId } = await upsertContato({ email: 'p@example.com', baseLegal: 'contrato' }, 'manual', { db })
    await marcarSincronizado(contatoId!)
    await upsertContato({ email: 'p@example.com', notas: 'só nota' }, 'manual', { db })
    expect((await contatoPorEmail('p@example.com')).syncStatus).toBe('sincronizado')
    await upsertContato({ email: 'p@example.com', escritorio: 'Novo' }, 'manual', { db })
    expect((await contatoPorEmail('p@example.com')).syncStatus).toBe('pendente')
  })

  it('registra "atualizado" com os campos e "mudou_status" com de/para', async () => {
    const { contatoId } = await upsertContato({ email: 'e@example.com', baseLegal: 'contrato' }, 'manual', { db })
    await upsertContato({ email: 'e@example.com', cidade: 'Recife', status: 'cliente' }, 'brevo', { db })
    const ev = await eventos(contatoId!)
    expect(ev.map((e) => e.tipo)).toEqual(['criado', 'atualizado', 'mudou_status'])
    expect(ev[1].dados).toMatchObject({ campos: ['cidade'], origem: 'brevo' })
    expect(ev[2].dados).toMatchObject({ de: 'lead', para: 'cliente', origem: 'brevo' })
  })
})

describe('base legal', () => {
  it('nunca rebaixa implicitamente; fortalece quando a nova é mais forte', async () => {
    await upsertContato({ email: 'b@example.com', baseLegal: 'consentimento' }, 'site', { db })
    const r = await upsertContato({ email: 'b@example.com', baseLegal: 'legitimo_interesse' }, 'planilha', { db })
    expect(r.acao).toBe('inalterado')
    expect((await contatoPorEmail('b@example.com')).baseLegal).toBe('consentimento')

    await upsertContato({ email: 'l@example.com', baseLegal: 'legitimo_interesse' }, 'planilha', { db })
    expect((await contatoPorEmail('l@example.com')).consentimentoEm).toBeNull()
    const quando = new Date('2026-10-01T12:00:00Z')
    const r2 = await upsertContato({ email: 'l@example.com', baseLegal: 'consentimento', consentimentoEm: quando }, 'site', { db })
    expect(alt(r2)).toEqual(expect.arrayContaining(['baseLegal', 'consentimentoEm']))
    const l = await contatoPorEmail('l@example.com')
    expect(l.baseLegal).toBe('consentimento')
    expect(l.consentimentoEm?.toISOString()).toBe(quando.toISOString())
  })

  it('a edição manual explícita pode trocar a base, e fica na linha do tempo', async () => {
    const { contatoId } = await upsertContato({ email: 'm@example.com', baseLegal: 'consentimento' }, 'site', { db })
    const r = await editarContato(contatoId!, { baseLegal: 'legitimo_interesse' }, { db })
    expect(r).toMatchObject({ ok: true, alterados: ['baseLegal'] })
    expect((await contatoPorEmail('m@example.com')).baseLegal).toBe('legitimo_interesse')
    const ev = await eventos(contatoId!)
    expect(ev.at(-1)).toMatchObject({ tipo: 'atualizado', dados: { campos: ['baseLegal'], baseLegal: { de: 'consentimento', para: 'legitimo_interesse' } } })
  })
})

describe('descadastrado é definitivo', () => {
  async function criarDescadastrado(email: string) {
    const { contatoId } = await upsertContato({ email, nome: 'D', baseLegal: 'consentimento' }, 'site', { db })
    const r = await mudarStatus(contatoId!, 'descadastrado', { db, origem: 'brevo' })
    expect(r).toEqual({ ok: true, de: 'lead', para: 'descadastrado' })
    return contatoId!
  }

  it('upsert com status não tira de descadastrado, por nenhuma origem', async () => {
    const id = await criarDescadastrado('d@example.com')
    for (const origem of ['planilha', 'site', 'brevo', 'manual'] as const) {
      await upsertContato({ email: 'd@example.com', status: 'lead', baseLegal: 'consentimento', cidade: `c-${origem}` }, origem, { db })
    }
    const c = await contatoPorEmail('d@example.com')
    expect(c.status).toBe('descadastrado')
    expect(c.cidade).toBe('c-manual') // os outros campos ainda podem ser atualizados
    expect((await eventos(id)).filter((e) => e.tipo === 'mudou_status')).toHaveLength(1)
  })

  it('na importação o descadastrado é ignorado e fica intacto', async () => {
    await criarDescadastrado('d@example.com')
    const antes = await contatoPorEmail('d@example.com')
    const r = await upsertContato({ email: 'D@example.com', nome: 'Outro', tags: ['x'] }, 'planilha', { db, seDescadastrado: 'ignorar' })
    expect(r).toEqual({ acao: 'ignorado', motivo: 'descadastrado', contatoId: antes.id })
    expect(await contatoPorEmail('d@example.com')).toEqual(antes)
  })

  it('mudarStatus e editarContato não saem de descadastrado', async () => {
    const id = await criarDescadastrado('d@example.com')
    expect(await mudarStatus(id, 'cliente', { db })).toEqual({ ok: false, motivo: 'descadastrado' })
    await editarContato(id, { nome: 'Novo nome' }, { db })
    expect((await contatoPorEmail('d@example.com')).status).toBe('descadastrado')
  })

  it('só reativarContato, com motivo, tira de descadastrado — e registra', async () => {
    const id = await criarDescadastrado('d@example.com')
    await marcarSincronizado(id)
    expect(await reativarContato(id, '   ', { db })).toEqual({ ok: false, motivo: 'sem_motivo' })
    expect(await reativarContato(id, 'Pediu por email em 28/10 para voltar a receber', { db })).toEqual({ ok: true })
    const c = await contatoPorEmail('d@example.com')
    expect(c.status).toBe('lead')
    expect(c.syncStatus).toBe('pendente')
    expect((await eventos(id)).at(-1)).toMatchObject({
      tipo: 'mudou_status',
      dados: { de: 'descadastrado', para: 'lead', reativacao: true, motivo: 'Pediu por email em 28/10 para voltar a receber' },
    })
    expect(await reativarContato(id, 'de novo', { db })).toEqual({ ok: false, motivo: 'nao_descadastrado' })
  })
})

describe('concorrência e lote', () => {
  it('upserts simultâneos do mesmo email geram um contato só, sem perder tags', async () => {
    const rs = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        upsertContato({ email: i % 2 ? 'Same@Example.com' : 'same@example.com', baseLegal: 'contrato', tags: [`t${i}`] }, 'site', { db }),
      ),
    )
    expect(rs.filter((r) => r.acao === 'criado')).toHaveLength(1)
    const todos = await db.select().from(contatos)
    expect(todos).toHaveLength(1)
    expect([...todos[0].tags].sort()).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'])
    expect((await eventos(todos[0].id)).filter((e) => e.tipo === 'criado')).toHaveLength(1)
  })

  it('lote com o mesmo email duas vezes mescla na ordem e devolve um resultado por item', async () => {
    const rs = await upsertContatos(
      [
        { email: 'x@example.com', nome: 'X', baseLegal: 'contrato' },
        { email: 'invalido' },
        { email: 'X@example.com', cidade: 'Natal' },
      ],
      'planilha',
      { db, importacao: { lote: 'L1', arquivo: 'lista.csv' } },
    )
    expect(rs.map((r) => r.acao)).toEqual(['criado', 'ignorado', 'atualizado'])
    const c = await contatoPorEmail('x@example.com')
    expect(c).toMatchObject({ nome: 'X', cidade: 'Natal', origem: 'planilha' })
    const tipos = (await eventos(c.id)).map((e) => e.tipo)
    expect(tipos).toEqual(['criado', 'importado', 'atualizado', 'importado'])
  })

  it('registrarEvento grava na linha do tempo, e linhaDoTempo vem do mais novo ao mais antigo', async () => {
    const { contatoId } = await upsertContato({ email: 'h@example.com', baseLegal: 'contrato' }, 'manual', { db })
    await registrarEvento(contatoId!, 'aberto', { campanha: 7 }, { db, em: new Date(Date.now() + 60_000) })
    const ev = await linhaDoTempo(contatoId!, { db })
    expect(ev.map((e) => e.tipo)).toEqual(['aberto', 'criado'])
  })
})
