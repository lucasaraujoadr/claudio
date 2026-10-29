import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { contatos, eventosContato, funilInscricoes, funis, type Contato } from '@/lib/db/schema'
import { LimitadorPorIp } from '@/lib/webhooks'
import type { BancoCrm } from '../banco'
import {
  concluirSequencias,
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
} from '../funis'
import { inscreverBoasVindasDoSite, sairDeTodosOsFunis } from '../ganchos-funis'
import { tratarWebhookBrevo } from '../webhook-brevo'
import { tratarWebhookSite } from '../webhook-site'
import { criarBancoTesteFunis } from './banco-teste-funis'

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
    await db.update(funis).set({ ativo: false, tetoDiario: 3 }).where(eq(funis.slug, 'boas-vindas'))
    const antes = (await db.select().from(funis).where(eq(funis.slug, 'boas-vindas')))[0]
    const b = await garantirFunis({ db })
    await garantirFunis({ db })
    expect(b.map((f) => f.id)).toEqual(a.map((f) => f.id))
    expect(await db.select().from(funis)).toHaveLength(4)
    const depois = b.find((f) => f.slug === 'boas-vindas')!
    expect(depois).toMatchObject({ ativo: false, tetoDiario: 3 })
    expect(depois.atualizadoEm.getTime()).toBe(antes.atualizadoEm.getTime())
  })
})

describe('inscrição e saída', () => {
  it('formulário do site → boas-vindas, com evento; repetir não duplica', async () => {
    const c = await criar()
    await inscreverBoasVindasDoSite(c.id, { db })
    await inscreverBoasVindasDoSite(c.id, { db })
    const i = await inscricao(c.id, 'boas-vindas')
    expect(i).toMatchObject({ status: 'ativo', origem: 'site' })
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
    expect(linhas.every((l) => l.status === 'saiu' && l.motivoSaida === 'descadastro no Brevo')).toBe(true)
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
    const { ids, excedeu } = await contatosComTag('LOTE-X', { db })
    expect(ids).toEqual([a.id, b.id])
    expect(excedeu).toBe(false)
    expect(await contatosComTag('lote-x', { db, limite: 1 })).toEqual({ ids: [a.id], excedeu: true })
    const r = await inscrever('nutricao-blog', ids, { db, caminho: 'manual' })
    expect(r.inscritos).toEqual([a.id])
    expect(r.recusados).toEqual({ base_legal: 1 })
  })
})

describe('reativação (rotina diária)', () => {
  it('inscreve clientes sem interação real há 180 dias e mais ninguém', async () => {
    const antes = (dias: number) => new Date(AGORA.getTime() - dias * DIA)
    const velho = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: antes(400) })
    await db.insert(eventosContato).values({ contatoId: velho.id, tipo: 'atualizado', dados: { origem: 'manual' }, em: antes(200) })
    const recente = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: antes(400) })
    await db.insert(eventosContato).values({ contatoId: recente.id, tipo: 'clicado', em: antes(10) })
    const editadoNaTela = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: antes(400) })
    await db.insert(eventosContato).values({ contatoId: editadoNaTela.id, tipo: 'atualizado', dados: { origem: 'manual' }, em: antes(20) })
    // Eventos automáticos não contam: abertura (Apple MPP), envio, importação, sincronização, funil.
    const soAutomatico = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: antes(400) })
    await db.insert(eventosContato).values([
      { contatoId: soAutomatico.id, tipo: 'aberto', em: antes(1) },
      { contatoId: soAutomatico.id, tipo: 'enviado', em: antes(1) },
      { contatoId: soAutomatico.id, tipo: 'importado', em: antes(5) },
      { contatoId: soAutomatico.id, tipo: 'atualizado', dados: { origem: 'planilha' }, em: antes(5) },
      { contatoId: soAutomatico.id, tipo: 'saiu_funil', em: antes(5) },
    ])
    const semEvento = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: new Date(AGORA.getTime() - 181 * DIA) })
    await criar({ status: 'lead', criadoEm: new Date(AGORA.getTime() - 400 * DIA) })
    await criar({ status: 'descadastrado', criadoEm: new Date(AGORA.getTime() - 400 * DIA) })
    const r = await inscreverReativacao({ db, agora: AGORA })
    expect(r.inscritos.sort()).toEqual([velho.id, soAutomatico.id, semEvento.id].sort())
    // Quem já está ativo na reativação não é escolhido de novo no dia seguinte.
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
  const CHECK = { avaliacaoLegitimoInteresse: true, fonteDocumentada: true, descadastroEmTodoEmail: true, volumeBaixoAquecido: true }

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

describe('resumoFunis', () => {
  it('conta membros por status', async () => {
    const a = await criar()
    const b = await criar()
    await inscreverBoasVindasDoSite(a.id, { db })
    await inscreverBoasVindasDoSite(b.id, { db })
    await sairDeTodosOsFunis(b.id, { db, motivo: 'x' })
    const r = await resumoFunis({ db })
    expect(r.find((f) => f.slug === 'boas-vindas')).toMatchObject({ ativos: 1, sairam: 1, concluidos: 0 })
    expect(r.find((f) => f.slug === 'reativacao')).toMatchObject({ ativos: 0 })
  })
})

describe('sequências concluídas e reentrada', () => {
  it('inscrição ativa dentro da duração (contada de entrou_em) continua ativa', async () => {
    const c = await criar()
    await inscrever('boas-vindas', [c.id], { db, caminho: 'site', agora: new Date(AGORA.getTime() - 5 * DIA) })
    expect(await concluirSequencias({ db, agora: AGORA })).toBe(0)
    expect((await inscricao(c.id, 'boas-vindas')).status).toBe('ativo')
  })

  it('reentrada reinicia a contagem: não conclui cedo', async () => {
    const c = await criar()
    const f = await obterFunil('boas-vindas', { db })
    await inscrever('boas-vindas', [c.id], { db, caminho: 'site', agora: new Date(AGORA.getTime() - 20 * DIA) })
    await sair(f.id, [c.id], { db, motivo: 'manual', agora: new Date(AGORA.getTime() - 19 * DIA) })
    const reentrada = new Date(AGORA.getTime() - 2 * DIA)
    await inscrever('boas-vindas', [c.id], { db, caminho: 'manual', agora: reentrada })
    const i = await inscricao(c.id, 'boas-vindas')
    expect(i).toMatchObject({ status: 'ativo', saiuEm: null })
    expect(i.entrouEm).toEqual(reentrada)
    expect(await concluirSequencias({ db, agora: AGORA })).toBe(0)
    expect((await inscricao(c.id, 'boas-vindas')).status).toBe('ativo')
  })

  it('ativo além da duração vira concluido (contado da entrada) e conta no resumo; nutrição não conclui', async () => {
    const c = await criar()
    await inscrever('boas-vindas', [c.id], { db, caminho: 'site', agora: new Date(AGORA.getTime() - 14 * DIA) })
    const n = await criar({ status: 'cliente', baseLegal: 'contrato' })
    await inscrever('nutricao-blog', [n.id], { db, caminho: 'manual', agora: new Date(AGORA.getTime() - 400 * DIA) })
    const novo = await criar()
    await inscrever('boas-vindas', [novo.id], { db, caminho: 'site', agora: new Date(AGORA.getTime() - 12 * DIA) })
    expect(await concluirSequencias({ db, agora: AGORA })).toBe(1)
    expect(await inscricao(c.id, 'boas-vindas')).toMatchObject({ status: 'concluido', motivoSaida: 'sequência concluída' })
    expect((await inscricao(novo.id, 'boas-vindas')).status).toBe('ativo')
    expect((await inscricao(n.id, 'nutricao-blog')).status).toBe('ativo')
    expect((await eventosDe(c.id)).at(-1)).toMatchObject({ tipo: 'saiu_funil', dados: { concluido: true } })
    expect((await resumoFunis({ db })).find((f) => f.slug === 'boas-vindas')).toMatchObject({ concluidos: 1, ativos: 1 })
  })

  it('reativação: a rotina reinscreve quem concluiu há mais de 180 dias, nunca quem saiu', async () => {
    const antes = (dias: number) => new Date(AGORA.getTime() - dias * DIA)
    const concluiu = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: antes(800) })
    const removido = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: antes(800) })
    const recemConcluido = await criar({ status: 'cliente', baseLegal: 'contrato', criadoEm: antes(800) })
    await inscrever('reativacao', [concluiu.id, removido.id], { db, caminho: 'cron', agora: antes(400) })
    await concluirSequencias({ db, agora: antes(370) })
    await inscrever('reativacao', [recemConcluido.id], { db, caminho: 'cron', agora: antes(60) })
    await concluirSequencias({ db, agora: antes(30) })
    const f = await obterFunil('reativacao', { db })
    // `removido` voltou pela tela e o usuário o tirou à mão: a linha fica `saiu`.
    await inscrever('reativacao', [removido.id], { db, caminho: 'manual', agora: antes(300) })
    await sair(f.id, [removido.id], { db, motivo: 'removido na tela', agora: antes(299) })
    const r = await inscreverReativacao({ db, agora: AGORA })
    expect(r.inscritos).toEqual([concluiu.id])
    expect((await inscricao(removido.id, 'reativacao')).status).toBe('saiu')
    expect((await inscricao(recemConcluido.id, 'reativacao')).status).toBe('concluido')
  })
})

