import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { LimitadorPorIp } from '@/lib/webhooks'
import { contatos, eventosContato, funilInscricoes } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { apagarDadosAPedido } from '../apagar-dados'
import { editarContato, reativarContato, upsertContato, upsertContatos } from '../contatos'
import { inscrever } from '../funis'
import { sincronizarPendentes } from '../sincronizar'
import { aplicarEventoBrevo } from '../webhook-brevo'
import { tratarWebhookSite } from '../webhook-site'
import { criarBancoTesteFunis } from './banco-teste-funis'
import { resendContatosFalso } from './resend-falso'

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
})
afterEach(async () => {
  await fechar()
})

const AGORA = new Date('2026-10-29T15:00:00Z')
const EMAIL = 'ana.titular@example.com'

async function contatoCompleto() {
  const [c] = await db
    .insert(contatos)
    .values({
      nome: 'Ana Titular',
      email: 'Ana.Titular@example.com',
      emailNormalizado: EMAIL,
      telefone: '(84) 99999-0000',
      escritorio: 'Titular Advocacia',
      cidade: 'Natal',
      uf: 'RN',
      notas: 'cliente antiga',
      tags: ['previdenciario', 'outubro'],
      resendContatoId: '321',
      origem: 'site',
      baseLegal: 'consentimento',
      status: 'lead',
      syncStatus: 'sincronizado',
    })
    .returning()
  await db.insert(eventosContato).values([
    { contatoId: c.id, tipo: 'formulario', dados: { origem: 'site', mensagem: 'Meu CPF é 000.000.000-00' } },
    { contatoId: c.id, tipo: 'atualizado', dados: { campos: ['telefone'], origem: 'manual' } },
  ])
  return c
}
async function linha(id: number) {
  const [c] = await db.select().from(contatos).where(eq(contatos.id, id))
  return c
}
async function eventosDe(id: number) {
  return db.select().from(eventosContato).where(eq(eventosContato.contatoId, id)).orderBy(asc(eventosContato.id))
}

describe('apagarDadosAPedido', () => {
  it('apaga os dados, guarda só o email como supressão e registra um evento sem dado pessoal', async () => {
    const c = await contatoCompleto()
    const r = await apagarDadosAPedido(c.id, 'Pedido por email em 28/10', { db, agora: AGORA })
    expect(r).toEqual({ ok: true })
    expect(await linha(c.id)).toMatchObject({
      nome: '',
      email: 'Ana.Titular@example.com',
      emailNormalizado: EMAIL,
      telefone: null,
      escritorio: null,
      cidade: null,
      uf: null,
      notas: null,
      tags: [],
      resendContatoId: null,
      status: 'descadastrado',
      syncStatus: 'pendente',
      dadosApagadosEm: AGORA,
    })
    const evs = await eventosDe(c.id)
    const anteriores = evs.filter((e) => e.tipo !== 'dados_apagados')
    expect(anteriores.length).toBeGreaterThanOrEqual(2)
    for (const e of anteriores) expect(e.dados).toBeNull()
    const marca = evs.filter((e) => e.tipo === 'dados_apagados')
    expect(marca).toHaveLength(1)
    expect(marca[0].dados).toEqual({ motivo: 'Pedido por email em 28/10', em: AGORA.toISOString(), statusAnterior: 'lead' })
    expect(JSON.stringify(evs)).not.toContain('Ana')
    expect(JSON.stringify(evs)).not.toContain('000.000')
  })

  it('tira de todos os funis na mesma transação', async () => {
    const c = await contatoCompleto()
    await inscrever('boas-vindas', [c.id], { db, caminho: 'site', agora: AGORA })
    await apagarDadosAPedido(c.id, 'pedido', { db, agora: AGORA })
    const [i] = await db.select().from(funilInscricoes).where(eq(funilInscricoes.contatoId, c.id))
    expect(i).toMatchObject({ status: 'saiu' })
  })

  it('exige motivo; contato inexistente; não apaga duas vezes', async () => {
    const c = await contatoCompleto()
    expect(await apagarDadosAPedido(c.id, '   ', { db })).toEqual({ ok: false, motivo: 'sem_motivo' })
    expect((await linha(c.id)).nome).toBe('Ana Titular')
    expect(await apagarDadosAPedido(99999, 'x', { db })).toEqual({ ok: false, motivo: 'nao_encontrado' })
    await apagarDadosAPedido(c.id, 'pedido', { db })
    expect(await apagarDadosAPedido(c.id, 'de novo', { db })).toEqual({ ok: false, motivo: 'ja_apagado' })
    expect((await eventosDe(c.id)).filter((e) => e.tipo === 'dados_apagados')).toHaveLength(1)
  })

  it('reativação é recusada para sempre', async () => {
    const c = await contatoCompleto()
    await apagarDadosAPedido(c.id, 'pedido', { db })
    expect(await reativarContato(c.id, 'a pessoa pediu para voltar', { db })).toEqual({ ok: false, motivo: 'dados_apagados' })
    expect((await linha(c.id)).status).toBe('descadastrado')
  })

  it('edição manual é recusada (não repõe dado apagado)', async () => {
    const c = await contatoCompleto()
    await apagarDadosAPedido(c.id, 'pedido', { db })
    expect(await editarContato(c.id, { nome: 'Ana de novo' }, { db })).toEqual({ ok: false, motivo: 'dados_apagados' })
    expect((await linha(c.id)).nome).toBe('')
  })

  it('reimportar o mesmo email (planilha, cadastro manual) não repõe nada e continua descadastrado', async () => {
    const c = await contatoCompleto()
    await apagarDadosAPedido(c.id, 'pedido', { db })
    const depois = await linha(c.id)
    const volta = { email: EMAIL, nome: 'Ana Titular', telefone: '84999990000', cidade: 'Natal', uf: 'RN', tags: ['nova'], notas: 'x', baseLegal: 'legitimo_interesse' as const }
    const [p] = await upsertContatos([volta], 'planilha', { db, seDescadastrado: 'ignorar', importacao: { lote: 'l1', arquivo: 'a.csv' } })
    expect(p).toEqual({ acao: 'ignorado', motivo: 'dados_apagados', contatoId: c.id })
    expect(await upsertContato({ ...volta, baseLegal: 'consentimento' }, 'manual', { db })).toEqual({ acao: 'ignorado', motivo: 'dados_apagados', contatoId: c.id })
    expect(await linha(c.id)).toEqual(depois)
    expect((await eventosDe(c.id)).filter((e) => e.dados !== null).map((e) => e.tipo)).toEqual(['dados_apagados'])
  })

  it('formulário do site com o mesmo email: responde 200 e não grava nada', async () => {
    const c = await contatoCompleto()
    await apagarDadosAPedido(c.id, 'pedido', { db })
    const depois = await linha(c.id)
    const n = (await eventosDe(c.id)).length
    const corpo = new URLSearchParams({ Nome: 'Ana Titular', 'E-mail': EMAIL, Telefone: '84 9999', Mensagem: 'oi de novo' }).toString()
    const res = await tratarWebhookSite(
      new Request('http://localhost/api/webhooks/site?token=t', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: corpo }),
      { db, token: 't', limitador: new LimitadorPorIp(100, 60_000) },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, ignorado: 'dados_apagados' })
    expect(await linha(c.id)).toEqual(depois)
    expect(await eventosDe(c.id)).toHaveLength(n)
    expect(await db.select().from(funilInscricoes)).toHaveLength(0)
  })

  it('evento do Brevo para um contato apagado entra sem dados', async () => {
    const c = await contatoCompleto()
    await apagarDadosAPedido(c.id, 'pedido', { db })
    await aplicarEventoBrevo({ tipo: 'clicado', descadastra: false, email: EMAIL, chave: 'k1', em: AGORA, dados: { evento: 'click', link: 'https://x.example/?nome=Ana' } }, { db })
    const ultimo = (await eventosDe(c.id)).at(-1)
    expect(ultimo).toMatchObject({ tipo: 'clicado', dados: null })
  })

  it('a sincronização manda ao Resend só a supressão e não grava id de contato', async () => {
    const c = await contatoCompleto()
    await apagarDadosAPedido(c.id, 'pedido', { db })
    expect((await linha(c.id)).resendContatoId).toBeNull()
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente, registrar: false })
    // Nada além de: contato unsubscribed (sem nome) e fora do segmento. Nunca entra no segmento.
    expect(f.chamadas.filter((x) => x.op !== 'segmento')).toEqual([
      { op: 'salvar', corpo: { email: EMAIL, nome: null, descadastrado: true } },
      { op: 'remover', email: EMAIL, segmentoId: 'seg_newsletter' },
    ])
    const enviado = JSON.stringify(f.chamadas)
    for (const dado of ['Ana', 'Titular', '99999', 'Natal', 'Advocacia', 'cliente antiga', 'previdenciario']) expect(enviado).not.toContain(dado)
    // O id devolvido pelo Resend (rc_1) não é guardado: a linha continua sem id.
    expect(await linha(c.id)).toMatchObject({ syncStatus: 'sincronizado', resendContatoId: null, status: 'descadastrado', dadosApagadosEm: expect.any(Date) })
    // Nova rodada: nada pendente, nada enviado.
    f.chamadas.length = 0
    await sincronizarPendentes({ db, cliente: f.cliente, registrar: false })
    expect(f.chamadas).toHaveLength(0)
    expect((await linha(c.id)).resendContatoId).toBeNull()
  })
})
