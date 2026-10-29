import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { contatos, eventosContato, funilInscricoes, funis, type Contato } from '@/lib/db/schema'
import { criarClienteBrevo } from '@/lib/brevo'
import { LimitadorPorIp } from '@/lib/webhooks'
import type { BancoCrm } from '../banco'
import {
  conectarListaBrevo,
  contatosComTag,
  definirAtivo,
  encerrarInscricoesDeDescadastrados,
  garantirFunis,
  inscrever,
  inscreverProspeccao,
  inscreverReativacao,
  ligarProspeccaoFria,
  obterFunil,
  resumoFunis,
  sair,
  sincronizarInscricoes,
} from '../funis'
import { inscreverBoasVindasDoSite, sairDeTodosOsFunis } from '../ganchos-funis'
import { tratarWebhookBrevo } from '../webhook-brevo'
import { tratarWebhookSite } from '../webhook-site'
import { criarBancoTesteFunis } from './banco-teste-funis'
import { brevoFalso } from './brevo-fake'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
})

const AGORA = new Date('2026-10-29T15:00:00Z')
const DIA = 86_400_000
let seq = 0

async function criar(extra: Partial<typeof contatos.$inferInsert> = {}): Promise<Contato> {
  seq++
  const email = extra.emailNormalizado ?? `pessoa${seq}@example.com`
  const [c] = await db
    .insert(contatos)
    .values({ nome: `Pessoa ${seq}`, email, emailNormalizado: email, origem: 'site', baseLegal: 'consentimento', status: 'lead', ...extra })
    .returning()
  return c
}
async function eventosDe(id: number) {
  return db.select().from(eventosContato).where(eq(eventosContato.contatoId, id)).orderBy(asc(eventosContato.id))
}
async function inscricao(contatoId: number, slug: string) {
  const f = await db.select().from(funis).where(eq(funis.slug, slug))
  const [i] = await db.select().from(funilInscricoes).where(and(eq(funilInscricoes.contatoId, contatoId), eq(funilInscricoes.funilId, f[0].id)))
  return i
}

describe('garantirFunis', () => {
  it('cria os quatro funis, com a prospecção fria desligada', async () => {
    const fs = await garantirFunis({ db })
    expect(fs.map((f) => [f.slug, f.ativo])).toEqual([
      ['boas-vindas', true],
      ['nutricao-blog', true],
      ['reativacao', true],
      ['prospeccao-fria', false],
    ])
    expect(fs.find((f) => f.slug === 'prospeccao-fria')?.exigeBaseLegal).toBe('legitimo_interesse')
  })

  it('é idempotente e não sobrescreve o estado do usuário', async () => {
    const a = await garantirFunis({ db })
    await db.update(funis).set({ ativo: false, brevoListaId: 7, tetoDiario: 3 }).where(eq(funis.slug, 'boas-vindas'))
    const antes = (await db.select().from(funis).where(eq(funis.slug, 'boas-vindas')))[0]
    const b = await garantirFunis({ db })
    await garantirFunis({ db })
    expect(b.map((f) => f.id)).toEqual(a.map((f) => f.id))
    expect(await db.select().from(funis)).toHaveLength(4)
    const depois = b.find((f) => f.slug === 'boas-vindas')!
    expect(depois).toMatchObject({ ativo: false, brevoListaId: 7, tetoDiario: 3 })
    expect(depois.atualizadoEm.getTime()).toBe(antes.atualizadoEm.getTime())
  })
})

describe('inscrição e saída', () => {
  it('formulário do site → boas-vindas, com evento; repetir não duplica', async () => {
    const c = await criar()
    await inscreverBoasVindasDoSite(c.id, { db })
    await inscreverBoasVindasDoSite(c.id, { db })
    const i = await inscricao(c.id, 'boas-vindas')
    expect(i).toMatchObject({ status: 'ativo', origem: 'site', listaSync: 'pendente' })
    const ev = (await eventosDe(c.id)).filter((e) => e.tipo === 'entrou_funil')
    expect(ev).toHaveLength(1)
    expect(ev[0].dados).toMatchObject({ funil: 'boas-vindas', origem: 'site' })
  })

  it('quem já passou pelas boas-vindas não reentra pelo site', async () => {
    const c = await criar()
    await inscreverBoasVindasDoSite(c.id, { db })
    const f = await obterFunil('boas-vindas', { db })
    await sair(f.id, [c.id], { db, motivo: 'manual' })
    await inscreverBoasVindasDoSite(c.id, { db })
    expect((await inscricao(c.id, 'boas-vindas')).status).toBe('saiu')
    // Pela tela, a reentrada é permitida.
    const r = await inscrever('boas-vindas', [c.id], { db, caminho: 'manual' })
    expect(r.inscritos).toEqual([c.id])
    expect((await inscricao(c.id, 'boas-vindas')).status).toBe('ativo')
  })

  it('descadastrado nunca entra', async () => {
    const c = await criar({ status: 'descadastrado' })
    await inscreverBoasVindasDoSite(c.id, { db })
    const r = await inscrever('nutricao-blog', [c.id], { db, caminho: 'manual' })
    expect(r.recusados).toEqual({ descadastrado: 1 })
    expect(await db.select().from(funilInscricoes)).toHaveLength(0)
  })

  it('descadastro tira de todos os funis e registra saiu_funil', async () => {
    const c = await criar({ status: 'cliente', baseLegal: 'contrato' })
    await inscrever('nutricao-blog', [c.id], { db, caminho: 'manual' })
    await inscrever('reativacao', [c.id], { db, caminho: 'manual' })
    const n = await sairDeTodosOsFunis(c.id, { db, motivo: 'descadastro no Brevo' })
    expect(n).toBe(2)
    const linhas = await db.select().from(funilInscricoes).where(eq(funilInscricoes.contatoId, c.id))
    expect(linhas.every((l) => l.status === 'saiu' && l.listaSync === 'pendente' && l.motivoSaida === 'descadastro no Brevo')).toBe(true)
    expect((await eventosDe(c.id)).filter((e) => e.tipo === 'saiu_funil')).toHaveLength(2)
    // Repetir não grava nada novo.
    expect(await sairDeTodosOsFunis(c.id, { db, motivo: 'de novo' })).toBe(0)
  })

  it('webhook do site inscreve em boas-vindas; webhook do Brevo (descadastro) tira', async () => {
    const corpo = new URLSearchParams({ Nome: 'Teste', 'E-mail': 'teste.e9@example.com', form_id: 'x' }).toString()
    const rs = await tratarWebhookSite(
      new Request('http://localhost/api/webhooks/site?token=t', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corpo }),
      { db, token: 't', limitador: new LimitadorPorIp(100, 60_000) },
    )
    expect(rs.status).toBe(200)
    const [c] = await db.select().from(contatos)
    expect((await inscricao(c.id, 'boas-vindas')).status).toBe('ativo')
    const rb = await tratarWebhookBrevo(
      new Request('http://localhost/api/webhooks/brevo?token=b', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'unsubscribe', email: 'teste.e9@example.com', camp_id: 1, ts_event: 1_700_000_000 }),
      }),
      { db, token: 'b' },
    )
    expect(rb.status).toBe(200)
    expect((await inscricao(c.id, 'boas-vindas')).status).toBe('saiu')
  })

  it('descadastrado por outro caminho sai na limpeza diária', async () => {
    const c = await criar()
    await inscreverBoasVindasDoSite(c.id, { db })
    await db.update(contatos).set({ status: 'descadastrado' }).where(eq(contatos.id, c.id))
    expect(await encerrarInscricoesDeDescadastrados({ db })).toBe(1)
    expect((await inscricao(c.id, 'boas-vindas')).status).toBe('saiu')
  })

  it('funil desligado não recebe inscrição', async () => {
    const c = await criar({ status: 'cliente', baseLegal: 'contrato' })
    await garantirFunis({ db })
    await definirAtivo('nutricao-blog', false, { db })
    const r = await inscrever('nutricao-blog', [c.id], { db, caminho: 'manual' })
    expect(r.recusados).toEqual({ funil_inativo: 1 })
  })

  it('nutrição por tag de importação: só os elegíveis', async () => {
    const a = await criar({ origem: 'planilha', baseLegal: 'contrato', status: 'cliente', tags: ['lote-x'] })
    const b = await criar({ origem: 'planilha', baseLegal: 'legitimo_interesse', tags: ['lote-x'] })
    await criar({ origem: 'planilha', baseLegal: 'consentimento', status: 'descadastrado', tags: ['lote-x'] })
    await criar({ origem: 'planilha', baseLegal: 'consentimento', tags: ['outra'] })
    const ids = await contatosComTag('LOTE-X', { db })
    expect(ids).toEqual([a.id, b.id])
    const r = await inscrever('nutricao-blog', ids, { db, caminho: 'manual' })
    expect(r.inscritos).toEqual([a.id])
    expect(r.recusados).toEqual({ base_legal: 1 })
  })
})

describe('reativação (rotina diária)', () => {
  it('inscreve clientes sem evento há 180 dias e mais ninguém', async () => {
    const velho = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: new Date(AGORA.getTime() - 400 * DIA) })
    await db.insert(eventosContato).values({ contatoId: velho.id, tipo: 'atualizado', em: new Date(AGORA.getTime() - 200 * DIA) })
    const recente = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: new Date(AGORA.getTime() - 400 * DIA) })
    await db.insert(eventosContato).values({ contatoId: recente.id, tipo: 'aberto', em: new Date(AGORA.getTime() - 10 * DIA) })
    const semEvento = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: new Date(AGORA.getTime() - 181 * DIA) })
    await criar({ status: 'lead', criadoEm: new Date(AGORA.getTime() - 400 * DIA) })
    await criar({ status: 'descadastrado', criadoEm: new Date(AGORA.getTime() - 400 * DIA) })
    const r = await inscreverReativacao({ db, agora: AGORA })
    expect(r.inscritos.sort()).toEqual([velho.id, semEvento.id].sort())
    // A entrada é uma interação: no dia seguinte ninguém reentra.
    const r2 = await inscreverReativacao({ db, agora: new Date(AGORA.getTime() + DIA) })
    expect(r2.inscritos).toEqual([])
  })

  it('no máximo 50 por dia; o resto fica para o dia seguinte', async () => {
    const antigo = new Date(AGORA.getTime() - 300 * DIA)
    await db.insert(contatos).values(
      Array.from({ length: 60 }, (_, i) => ({
        nome: `C${i}`,
        email: `c${i}@example.com`,
        emailNormalizado: `c${i}@example.com`,
        origem: 'planilha' as const,
        baseLegal: 'contrato' as const,
        status: 'cliente' as const,
        criadoEm: antigo,
      })),
    )
    expect((await inscreverReativacao({ db, agora: AGORA })).inscritos).toHaveLength(50)
    expect((await inscreverReativacao({ db, agora: new Date(AGORA.getTime() + 60_000) })).inscritos).toHaveLength(0)
    expect((await inscreverReativacao({ db, agora: new Date(AGORA.getTime() + DIA) })).inscritos).toHaveLength(10)
  })
})

describe('prospecção fria', () => {
  async function frios(n: number) {
    const r: Contato[] = []
    for (let i = 0; i < n; i++) r.push(await criar({ origem: 'planilha', baseLegal: 'legitimo_interesse' }))
    return r
  }
  const CHECK = { avaliacaoLegitimoInteresse: true, descadastroEmTodoEmail: true, volumeBaixoAquecido: true }

  it('desligada: a rotina não inscreve ninguém', async () => {
    await frios(3)
    expect((await inscreverProspeccao({ db, agora: AGORA })).inscritos).toEqual([])
  })

  it('ligar exige checklist e teto, e registra quando foi confirmado', async () => {
    expect(await ligarProspeccaoFria({ ...CHECK, volumeBaixoAquecido: false }, 5, { db })).toEqual({ ok: false, motivo: 'checklist' })
    expect(await ligarProspeccaoFria(CHECK, null, { db })).toEqual({ ok: false, motivo: 'teto' })
    expect(await definirAtivo('prospeccao-fria', true, { db })).toEqual({ ok: false, motivo: 'use_checklist' })
    expect((await obterFunil('prospeccao-fria', { db })).ativo).toBe(false)
    expect(await ligarProspeccaoFria(CHECK, 2, { db, agora: AGORA })).toEqual({ ok: true })
    const f = await obterFunil('prospeccao-fria', { db })
    expect(f).toMatchObject({ ativo: true, tetoDiario: 2 })
    expect(f.checklistLgpdEm?.getTime()).toBe(AGORA.getTime())
  })

  it('ligada: só leads com legítimo interesse, dentro do teto, sem reinscrever', async () => {
    const [a, b, c] = await frios(3)
    const consentido = await criar({ origem: 'planilha', baseLegal: 'consentimento' })
    const cliente = await criar({ origem: 'planilha', baseLegal: 'legitimo_interesse', status: 'cliente' })
    await ligarProspeccaoFria(CHECK, 2, { db, agora: AGORA })
    expect((await inscreverProspeccao({ db, agora: AGORA })).inscritos).toEqual([a.id, b.id])
    // Teto também vale para a tela.
    expect((await inscrever('prospeccao-fria', [c.id], { db, caminho: 'manual', agora: AGORA })).recusados).toEqual({ teto_diario: 1 })
    expect((await inscrever('prospeccao-fria', [consentido.id, cliente.id], { db, caminho: 'manual', agora: new Date(AGORA.getTime() + DIA) })).recusados).toEqual({ base_legal: 1, status: 1 })
    const f = await obterFunil('prospeccao-fria', { db })
    await sair(f.id, [a.id], { db, motivo: 'teste' })
    const amanha = await inscreverProspeccao({ db, agora: new Date(AGORA.getTime() + DIA) })
    expect(amanha.inscritos).toEqual([c.id])
  })
})

describe('listas do Brevo', () => {
  async function inscritoBoasVindas(extra: Partial<typeof contatos.$inferInsert> = {}) {
    const c = await criar(extra)
    await inscreverBoasVindasDoSite(c.id, { db })
    return c
  }

  it('sem chave: inscrição fica guardada como pendente, sem erro', async () => {
    await inscritoBoasVindas({ brevoId: '1' })
    const r = await sincronizarInscricoes({ db, cliente: criarClienteBrevo({ apiKey: null }) })
    expect(r).toEqual({ conectado: false, mensagem: 'Brevo não conectado' })
    expect((await db.select().from(funilInscricoes))[0].listaSync).toBe('pendente')
  })

  it('sem lista conectada: fica pendente e é contado', async () => {
    await inscritoBoasVindas({ brevoId: '1' })
    const b = brevoFalso()
    const r = await sincronizarInscricoes({ db, cliente: b.cliente })
    expect(r).toMatchObject({ conectado: true, adicionados: 0, semLista: 1 })
    expect(b.chamadas.filter((c) => c.op === 'adicionarALista')).toHaveLength(0)
    expect((await db.select().from(funilInscricoes))[0].listaSync).toBe('pendente')
  })

  it('com lista: adiciona os ativos, remove os que saíram, espera quem ainda não está no Brevo', async () => {
    const b = brevoFalso()
    await garantirFunis({ db })
    await db.update(funis).set({ brevoListaId: 42 }).where(eq(funis.slug, 'boas-vindas'))
    const a = await inscritoBoasVindas({ brevoId: '1' })
    const semBrevo = await inscritoBoasVindas({ brevoId: null })
    const saiu = await inscritoBoasVindas({ brevoId: '3' })
    await sairDeTodosOsFunis(saiu.id, { db, motivo: 'manual' })
    const r = await sincronizarInscricoes({ db, cliente: b.cliente })
    expect(r).toMatchObject({ adicionados: 1, removidos: 1, aguardandoContato: 1, erros: 0, interrompido: null })
    expect(b.chamadas.find((c) => c.op === 'adicionarALista')).toMatchObject({ listaId: 42, corpo: [a.emailNormalizado] })
    expect(b.chamadas.find((c) => c.op === 'removerDaLista')).toMatchObject({ listaId: 42, corpo: [saiu.emailNormalizado] })
    expect((await inscricao(a.id, 'boas-vindas')).listaSync).toBe('sincronizado')
    expect((await inscricao(semBrevo.id, 'boas-vindas')).listaSync).toBe('pendente')
    expect((await inscricao(saiu.id, 'boas-vindas')).listaSync).toBe('sincronizado')
    // Nada reenviado na segunda rodada.
    b.chamadas.length = 0
    await sincronizarInscricoes({ db, cliente: b.cliente })
    expect(b.chamadas.filter((c) => c.op === 'adicionarALista' || c.op === 'removerDaLista')).toHaveLength(0)
  })

  it('descadastrado com inscrição ativa (estado inconsistente) nunca é adicionado à lista', async () => {
    const b = brevoFalso()
    await garantirFunis({ db })
    await db.update(funis).set({ brevoListaId: 42 }).where(eq(funis.slug, 'boas-vindas'))
    const c = await inscritoBoasVindas({ brevoId: '1' })
    await db.update(contatos).set({ status: 'descadastrado' }).where(eq(contatos.id, c.id))
    await sincronizarInscricoes({ db, cliente: b.cliente })
    expect(b.chamadas.filter((x) => x.op === 'adicionarALista')).toHaveLength(0)
  })

  it('erro geral do Brevo para e deixa pendente', async () => {
    const b = brevoFalso()
    await garantirFunis({ db })
    await db.update(funis).set({ brevoListaId: 42 }).where(eq(funis.slug, 'boas-vindas'))
    await inscritoBoasVindas({ brevoId: '1' })
    b.falharTudo({ ok: false, motivo: 'http', status: 503, mensagem: 'O Brevo está indisponível (503). Tente de novo mais tarde.' })
    const r = await sincronizarInscricoes({ db, cliente: b.cliente })
    expect(r).toMatchObject({ interrompido: expect.stringContaining('503'), adicionados: 0 })
    expect((await db.select().from(funilInscricoes))[0].listaSync).toBe('pendente')
  })

  it('erro de dados (400) marca só aquela inscrição como erro', async () => {
    const b = brevoFalso()
    await garantirFunis({ db })
    await db.update(funis).set({ brevoListaId: 42 }).where(eq(funis.slug, 'boas-vindas'))
    const ok = await inscritoBoasVindas({ brevoId: '1' })
    const ruim = await inscritoBoasVindas({ brevoId: '2' })
    const original = b.cliente.adicionarALista
    b.cliente.adicionarALista = async (l, emails) =>
      emails.includes(ruim.emailNormalizado) ? { ok: false, motivo: 'http', status: 400, mensagem: 'O Brevo recusou os dados (400).' } : original(l, emails)
    const r = await sincronizarInscricoes({ db, cliente: b.cliente })
    expect(r).toMatchObject({ adicionados: 1, erros: 1, interrompido: null })
    expect((await inscricao(ok.id, 'boas-vindas')).listaSync).toBe('sincronizado')
    expect(await inscricao(ruim.id, 'boas-vindas')).toMatchObject({ listaSync: 'erro', listaSyncErro: 'O Brevo recusou os dados (400).' })
  })
})

describe('conectarListaBrevo', () => {
  it('cria a pasta (uma vez) e a lista do funil', async () => {
    const b = brevoFalso()
    const r1 = await conectarListaBrevo('boas-vindas', { db, cliente: b.cliente })
    const r2 = await conectarListaBrevo('reativacao', { db, cliente: b.cliente })
    expect(r1).toMatchObject({ ok: true, criada: true, verificada: true })
    expect(r2).toMatchObject({ ok: true, criada: true })
    expect(b.pastas).toHaveLength(1)
    expect([...b.listas.values()].map((l) => l.nome)).toEqual(['Painel OG — Boas-vindas', 'Painel OG — Reativação de clientes'])
    expect((await obterFunil('boas-vindas', { db })).brevoListaId).toBe(r1.ok ? r1.listaId : -1)
  })

  it('aceita lista existente conferindo no Brevo; recusa a que não existe', async () => {
    const b = brevoFalso()
    b.listas.set(77, { id: 77, nome: 'Minha lista', pastaId: 1 })
    expect(await conectarListaBrevo('nutricao-blog', { db, cliente: b.cliente, listaIdExistente: 77 })).toMatchObject({ ok: true, verificada: true, criada: false })
    expect(await conectarListaBrevo('nutricao-blog', { db, cliente: b.cliente, listaIdExistente: 78 })).toEqual({ ok: false, motivo: 'lista_nao_encontrada' })
    expect((await obterFunil('nutricao-blog', { db })).brevoListaId).toBe(77)
  })

  it('sem chave: guarda o id informado sem conferir; criar exige chave', async () => {
    const semChave = criarClienteBrevo({ apiKey: null })
    expect(await conectarListaBrevo('nutricao-blog', { db, cliente: semChave, listaIdExistente: 5 })).toMatchObject({ ok: true, verificada: false })
    expect(await conectarListaBrevo('reativacao', { db, cliente: semChave })).toEqual({ ok: false, motivo: 'nao_conectado' })
    expect(await conectarListaBrevo('reativacao', { db, cliente: semChave, listaIdExistente: -1 })).toEqual({ ok: false, motivo: 'lista_invalida' })
  })

  it('trocar de lista reabre as inscrições ativas para a lista nova', async () => {
    const b = brevoFalso()
    b.listas.set(1, { id: 1, nome: 'a', pastaId: 1 })
    b.listas.set(2, { id: 2, nome: 'b', pastaId: 1 })
    await conectarListaBrevo('boas-vindas', { db, cliente: b.cliente, listaIdExistente: 1 })
    const c = await criar({ brevoId: '9' })
    await inscreverBoasVindasDoSite(c.id, { db })
    await sincronizarInscricoes({ db, cliente: b.cliente })
    expect((await inscricao(c.id, 'boas-vindas')).listaSync).toBe('sincronizado')
    await conectarListaBrevo('boas-vindas', { db, cliente: b.cliente, listaIdExistente: 2 })
    expect((await inscricao(c.id, 'boas-vindas')).listaSync).toBe('pendente')
  })
})

describe('resumoFunis', () => {
  it('conta membros por status e pendências do Brevo', async () => {
    const a = await criar()
    const b = await criar()
    await inscreverBoasVindasDoSite(a.id, { db })
    await inscreverBoasVindasDoSite(b.id, { db })
    await sairDeTodosOsFunis(b.id, { db, motivo: 'x' })
    const r = await resumoFunis({ db })
    expect(r.find((f) => f.slug === 'boas-vindas')).toMatchObject({ ativos: 1, sairam: 1, concluidos: 0, pendentesBrevo: 2 })
    expect(r.find((f) => f.slug === 'reativacao')).toMatchObject({ ativos: 0, pendentesBrevo: 0 })
  })
})
