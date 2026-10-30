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
/** Simula o Resend tendo sincronizado o contato. */
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
  async function criarCurado() {
    // Cadastrado à mão: dados curados pela equipe.
    const r = await upsertContato(
      { email: 'c@example.com', nome: 'Carla Souza', telefone: '11 9999-0000', escritorio: 'Souza Advogados', baseLegal: 'contrato' },
      'manual',
      { db },
    )
    return r.contatoId!
  }
  const mudanca = { nome: 'C. Souza', telefone: '11 1111-1111', escritorio: 'Outro Escritório', cidade: 'Campinas', uf: 'são paulo' }

  it('planilha só preenche o que está vazio e registra o que manteve', async () => {
    const id = await criarCurado()
    const r = await upsertContato({ email: 'C@example.com', ...mudanca }, 'planilha', { db })
    expect(r.acao).toBe('atualizado')
    expect(alt(r)?.sort()).toEqual(['cidade', 'uf'])
    expect(await contatoPorEmail('c@example.com')).toMatchObject({
      nome: 'Carla Souza', telefone: '11 9999-0000', escritorio: 'Souza Advogados', cidade: 'Campinas', uf: 'SP', origem: 'manual',
    })
    expect((await eventos(id)).at(-1)).toMatchObject({
      tipo: 'atualizado',
      dados: { campos: ['cidade', 'uf'], mantidos: ['nome', 'telefone', 'escritorio'], origem: 'planilha' },
    })
  })

  it('brevo também só preenche o que está vazio', async () => {
    await criarCurado()
    const r = await upsertContato({ email: 'c@example.com', ...mudanca }, 'brevo', { db })
    expect(r).toMatchObject({ acao: 'atualizado', mantidos: ['nome', 'telefone', 'escritorio'] })
    expect((await contatoPorEmail('c@example.com')).nome).toBe('Carla Souza')
  })

  it('site sobrescreve só nome, telefone e escritório (informados pelo próprio contato)', async () => {
    await criarCurado()
    await upsertContato({ email: 'c@example.com', cidade: 'Campinas' }, 'manual', { db })
    const r = await upsertContato({ email: 'c@example.com', ...mudanca, cidade: 'Jundiaí' }, 'site', { db })
    expect(r).toMatchObject({ acao: 'atualizado', mantidos: ['cidade'] })
    expect(await contatoPorEmail('c@example.com')).toMatchObject({
      nome: 'C. Souza', telefone: '11 1111-1111', escritorio: 'Outro Escritório', cidade: 'Campinas', uf: 'SP',
    })
  })

  it('cadastro manual sobrescreve com o que foi digitado, mas nunca apaga com vazio', async () => {
    await criarCurado()
    const r = await upsertContato({ email: 'c@example.com', ...mudanca, telefone: '  ' }, 'manual', { db })
    expect(r).toMatchObject({ acao: 'atualizado', mantidos: [] })
    expect(await contatoPorEmail('c@example.com')).toMatchObject({
      nome: 'C. Souza', telefone: '11 9999-0000', escritorio: 'Outro Escritório', cidade: 'Campinas',
    })
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

  it('marca pendente só quando muda campo que o Resend usa (nome, status, base legal)', async () => {
    const { contatoId } = await upsertContato({ email: 'p@example.com', baseLegal: 'contrato' }, 'manual', { db })
    await marcarSincronizado(contatoId!)
    // Notas, telefone, escritório, cidade, UF e tags não vão para o Resend.
    await upsertContato({ email: 'p@example.com', notas: 'só nota', telefone: '81999990000', cidade: 'Recife', uf: 'PE', escritorio: 'Novo', tags: ['x'] }, 'manual', { db })
    expect((await contatoPorEmail('p@example.com')).syncStatus).toBe('sincronizado')
    await upsertContato({ email: 'p@example.com', nome: 'Nome Novo' }, 'manual', { db })
    expect((await contatoPorEmail('p@example.com')).syncStatus).toBe('pendente')
    await marcarSincronizado(contatoId!)
    await upsertContato({ email: 'p@example.com', baseLegal: 'consentimento' }, 'manual', { db })
    expect((await contatoPorEmail('p@example.com')).syncStatus).toBe('pendente')
  })

  it('upsert implícito nunca muda status, exceto para entrar em descadastrado', async () => {
    const { contatoId } = await upsertContato({ email: 'e@example.com', baseLegal: 'contrato' }, 'manual', { db })
    await mudarStatus(contatoId!, 'cliente', { db })
    for (const origem of ['manual', 'site', 'planilha', 'brevo'] as const) {
      const r = await upsertContato({ email: 'e@example.com', status: 'lead', cidade: 'Recife' }, origem, { db })
      expect(r.acao === 'ignorado').toBe(false)
    }
    expect((await contatoPorEmail('e@example.com')).status).toBe('cliente')
    // na criação o status informado vale
    await upsertContato({ email: 'novo-cliente@example.com', baseLegal: 'contrato', status: 'cliente' }, 'manual', { db })
    expect((await contatoPorEmail('novo-cliente@example.com')).status).toBe('cliente')
    // entrar em descadastrado pelo upsert (ex.: descadastro vindo do Brevo) pode, com evento
    await upsertContato({ email: 'e@example.com', status: 'descadastrado' }, 'brevo', { db })
    expect((await contatoPorEmail('e@example.com')).status).toBe('descadastrado')
    const ev = await eventos(contatoId!)
    expect(ev.map((e) => e.tipo)).toEqual(['criado', 'mudou_status', 'atualizado', 'mudou_status'])
    expect(ev[2].dados).toMatchObject({ campos: ['cidade'], origem: 'manual' })
    expect(ev[3].dados).toMatchObject({ de: 'cliente', para: 'descadastrado', origem: 'brevo' })
  })

  it('limites: no máximo 50 tags e 5 000 caracteres de notas; o excedente fica de fora e é registrado', async () => {
    const tags = Array.from({ length: 60 }, (_, i) => `t${i}`)
    await upsertContato({ email: 'lim@example.com', baseLegal: 'contrato', tags, notas: 'x'.repeat(6000) }, 'site', { db })
    let c = await contatoPorEmail('lim@example.com')
    expect(c.tags).toHaveLength(50)
    expect(c.notas).toHaveLength(5000)
    await upsertContato({ email: 'lim2@example.com', baseLegal: 'contrato', tags: tags.slice(0, 49), notas: 'a'.repeat(4990) }, 'site', { db })
    const r = await upsertContato({ email: 'lim2@example.com', tags: ['nova1', 'nova2'], notas: 'b'.repeat(20) }, 'planilha', { db })
    expect(r).toMatchObject({ acao: 'atualizado', alterados: ['tags'], mantidos: ['tags', 'notas'] })
    c = await contatoPorEmail('lim2@example.com')
    expect(c.tags).toHaveLength(50)
    expect(c.notas).toBe('a'.repeat(4990))
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
    // sem consentimento como base, a data do consentimento é apagada
    expect((await contatoPorEmail('m@example.com')).consentimentoEm).toBeNull()
  })

  it('a edição manual recusa notas ou tags acima do limite, sem gravar', async () => {
    const { contatoId } = await upsertContato({ email: 'n@example.com', baseLegal: 'contrato' }, 'manual', { db })
    expect(await editarContato(contatoId!, { notas: 'x'.repeat(5001) }, { db })).toEqual({ ok: false, motivo: 'longo' })
    expect(await editarContato(contatoId!, { tags: Array.from({ length: 51 }, (_, i) => `t${i}`) }, { db })).toEqual({ ok: false, motivo: 'longo' })
    expect((await contatoPorEmail('n@example.com')).notas).toBeNull()
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
  // O PGlite tem uma conexão só: as transações daqui se enfileiram e este teste confere o
  // caminho ON CONFLICT + FOR UPDATE, não a disputa real de travas. A disputa real foi
  // verificada contra o Neon (12 upserts simultâneos; ver o relatório da E7).
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
