import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { contatos, funilInscricoes, funis, sincronizacoes } from '@/lib/db/schema'
import { ErroResend } from '@/lib/resend'
import type { BancoCrm } from '../banco'
import { garantirFunis, INTERROMPIDO_POR_TEMPO } from '../funis'
import { elegivelNewsletter, estadoIntegracao, SEGMENTO_NEWSLETTER, sincronizarPendentes } from '../sincronizar'
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

type Extra = Partial<typeof contatos.$inferInsert>
async function criar(email: string, extra: Extra = {}, naNutricao = true) {
  const [c] = await db
    .insert(contatos)
    .values({ nome: 'Fulano de Tal', email, emailNormalizado: email, origem: 'site', baseLegal: 'consentimento', status: 'lead', syncStatus: 'pendente', ...extra })
    .returning()
  if (naNutricao) await entrarNaNutricao(c.id)
  return c.id
}
async function entrarNaNutricao(contatoId: number) {
  await garantirFunis({ db })
  const [f] = await db.select().from(funis).where(eq(funis.slug, 'nutricao-blog'))
  await db.insert(funilInscricoes).values({ contatoId, funilId: f.id, status: 'ativo', origem: 'manual' })
}
async function linha(id: number) {
  const [c] = await db.select().from(contatos).where(eq(contatos.id, id))
  return c
}

describe('elegivelNewsletter', () => {
  const base = { status: 'lead', baseLegal: 'consentimento', dadosApagadosEm: null } as const
  it('lead/cliente com consentimento/contrato e nutrição ativa', () => {
    expect(elegivelNewsletter(base, true)).toBe(true)
    expect(elegivelNewsletter({ ...base, status: 'cliente', baseLegal: 'contrato' }, true)).toBe(true)
  })
  it('recusa os demais casos', () => {
    expect(elegivelNewsletter(base, false)).toBe(false)
    expect(elegivelNewsletter({ ...base, baseLegal: 'legitimo_interesse' }, true)).toBe(false)
    expect(elegivelNewsletter({ ...base, status: 'inativo' }, true)).toBe(false)
    expect(elegivelNewsletter({ ...base, status: 'descadastrado' }, true)).toBe(false)
    expect(elegivelNewsletter({ ...base, dadosApagadosEm: new Date() }, true)).toBe(false)
  })
})

describe('sincronizarPendentes', () => {
  it('sem Resend configurado: não toca em nada', async () => {
    const id = await criar('a@example.com')
    const r = await sincronizarPendentes({ db, cliente: null })
    expect(r).toEqual({ conectado: false, mensagem: 'Resend não configurado' })
    expect((await linha(id)).syncStatus).toBe('pendente')
    expect(await db.select().from(sincronizacoes)).toHaveLength(0)
  })

  it('lead com consentimento na nutrição entra no segmento', async () => {
    const id = await criar('a@example.com')
    const f = resendContatosFalso()
    const r = await sincronizarPendentes({ db, cliente: f.cliente })
    expect(r).toEqual({ conectado: true, enviados: 1, erros: 0, restantes: 0, interrompido: null })
    expect(f.de('segmento')).toEqual([{ op: 'segmento', nome: SEGMENTO_NEWSLETTER }])
    expect(f.de('salvar')).toEqual([{ op: 'salvar', corpo: { email: 'a@example.com', nome: 'Fulano de Tal', descadastrado: false } }])
    expect(f.de('adicionar')).toEqual([{ op: 'adicionar', email: 'a@example.com', segmentoId: 'seg_newsletter' }])
    expect(f.de('remover')).toHaveLength(0)
    expect(await linha(id)).toMatchObject({ syncStatus: 'sincronizado', syncErro: null, resendContatoId: 'rc_1' })
    const [s] = await db.select().from(sincronizacoes)
    expect(s).toMatchObject({ fonte: 'resend-contatos', status: 'ok', linhas: 1 })
  })

  it('cliente com contrato também entra; nome vazio vai como nulo', async () => {
    await criar('c@example.com', { status: 'cliente', baseLegal: 'contrato', nome: '  ' })
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect(f.de('salvar')).toEqual([{ op: 'salvar', corpo: { email: 'c@example.com', nome: null, descadastrado: false } }])
    expect(f.de('adicionar')).toHaveLength(1)
  })

  it('legítimo interesse não entra', async () => {
    const id = await criar('li@example.com', { baseLegal: 'legitimo_interesse' })
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect(f.de('adicionar')).toHaveLength(0)
    expect(f.de('salvar')).toHaveLength(0)
    expect(f.de('remover')).toEqual([{ op: 'remover', email: 'li@example.com', segmentoId: 'seg_newsletter' }])
    expect((await linha(id)).syncStatus).toBe('sincronizado')
  })

  it('quem não está na nutrição sai do segmento', async () => {
    await criar('fora@example.com', {}, false)
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect(f.de('adicionar')).toHaveLength(0)
    expect(f.de('remover')).toHaveLength(1)
  })

  it('inscrição da nutrição que saiu não conta', async () => {
    const id = await criar('saiu@example.com')
    await db.update(funilInscricoes).set({ status: 'saiu' }).where(eq(funilInscricoes.contatoId, id))
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect(f.de('adicionar')).toHaveLength(0)
    expect(f.de('remover')).toHaveLength(1)
  })

  it('descadastrado sai do segmento e fica unsubscribed', async () => {
    const id = await criar('d@example.com', { status: 'descadastrado' })
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect(f.de('salvar')).toEqual([{ op: 'salvar', corpo: { email: 'd@example.com', nome: 'Fulano de Tal', descadastrado: true } }])
    expect(f.de('remover')).toHaveLength(1)
    expect(f.de('adicionar')).toHaveLength(0)
    expect(await linha(id)).toMatchObject({ syncStatus: 'sincronizado', resendContatoId: 'rc_1' })
  })

  it('contato com dados apagados: só a supressão vai ao Resend, sem nome nem id guardado', async () => {
    const id = await criar('Apagado@Example.com', {
      emailNormalizado: 'apagado@example.com',
      nome: '',
      status: 'descadastrado',
      dadosApagadosEm: new Date('2026-10-29T10:00:00Z'),
      resendContatoId: null,
    })
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect(f.chamadas.filter((c) => c.op !== 'segmento')).toEqual([
      { op: 'salvar', corpo: { email: 'apagado@example.com', nome: null, descadastrado: true } },
      { op: 'remover', email: 'apagado@example.com', segmentoId: 'seg_newsletter' },
    ])
    expect(await linha(id)).toMatchObject({ syncStatus: 'sincronizado', resendContatoId: null })
  })

  it('apagado nunca vai como elegível, mesmo com status e funil ainda válidos', async () => {
    await criar('x@example.com', { status: 'lead', dadosApagadosEm: new Date() })
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect(f.de('adicionar')).toHaveLength(0)
    expect(f.de('salvar')).toEqual([{ op: 'salvar', corpo: { email: 'x@example.com', nome: null, descadastrado: true } }])
  })

  it('não envia telefone, cidade, escritório, notas nem tags', async () => {
    await criar('a@example.com', { telefone: '(11) 99999-0000', cidade: 'Campinas', uf: 'SP', escritorio: 'Silva Advocacia', notas: 'nota secreta', tags: ['t1'] })
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente })
    const [salvar] = f.de('salvar')
    expect(Object.keys(salvar.op === 'salvar' ? salvar.corpo : {}).sort()).toEqual(['descadastrado', 'email', 'nome'])
    const json = JSON.stringify(f.chamadas)
    for (const proibido of ['99999', 'Campinas', 'Silva Advocacia', 'secreta', 't1']) expect(json).not.toContain(proibido)
  })

  it('erro do Resend marca erro sem mensagem com dados e segue para os demais', async () => {
    const ruim = await criar('ruim@example.com')
    const bom = await criar('bom@example.com')
    const f = resendContatosFalso()
    f.falhar('salvar', 'ruim@example.com', new ErroResend('invalido'))
    const r = await sincronizarPendentes({ db, cliente: f.cliente })
    expect(r).toMatchObject({ enviados: 1, erros: 1, restantes: 1, interrompido: null })
    const c = await linha(ruim)
    expect(c.syncStatus).toBe('erro')
    expect(c.syncErro).toBe('o Resend recusou os dados enviados')
    expect(c.syncErro).not.toContain('ruim')
    expect(c.syncErro).not.toContain('Fulano')
    expect((await linha(bom)).syncStatus).toBe('sincronizado')
    const [s] = await db.select().from(sincronizacoes)
    expect(s.status).toBe('parcial')
  })

  it('erro que não é do cliente vira frase fixa, sem repetir a mensagem', async () => {
    const id = await criar('a@example.com')
    const f = resendContatosFalso()
    f.cliente.salvarContato = async () => {
      throw new Error('falha com a@example.com')
    }
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect((await linha(id)).syncErro).toBe('falha ao sincronizar com o Resend')
  })

  it('chave recusada ou limite: interrompe e deixa o contato como estava', async () => {
    const a = await criar('a@example.com')
    const b = await criar('b@example.com')
    const f = resendContatosFalso()
    f.falhar('salvar', 'a@example.com', new ErroResend('credencial'))
    const r = await sincronizarPendentes({ db, cliente: f.cliente })
    expect(r).toMatchObject({ conectado: true, enviados: 0, erros: 0, interrompido: 'chave do Resend inválida ou sem permissão' })
    expect((await linha(a)).syncStatus).toBe('pendente')
    expect((await linha(b)).syncStatus).toBe('pendente')
    expect(f.de('salvar')).toHaveLength(1)
    const [s] = await db.select().from(sincronizacoes)
    expect(s.status).toBe('erro')
  })

  it('remover de quem nunca esteve no Resend (404) é sucesso', async () => {
    const id = await criar('nunca@example.com', {}, false)
    const f = resendContatosFalso()
    f.falhar('remover', 'nunca@example.com', new ErroResend('nao_encontrado'))
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect((await linha(id)).syncStatus).toBe('sincronizado')
  })

  it('edição durante a sincronização deixa o contato pendente', async () => {
    const id = await criar('a@example.com')
    const f = resendContatosFalso()
    const salvar = f.cliente.salvarContato
    f.cliente.salvarContato = async (c) => {
      await db.update(contatos).set({ atualizadoEm: new Date(Date.now() + 5000) }).where(eq(contatos.id, id))
      return salvar(c)
    }
    await sincronizarPendentes({ db, cliente: f.cliente })
    expect((await linha(id)).syncStatus).toBe('pendente')
  })

  it('deveParar interrompe por tempo', async () => {
    const id = await criar('a@example.com')
    const r = await sincronizarPendentes({ db, cliente: resendContatosFalso().cliente, deveParar: () => true })
    expect(r).toMatchObject({ enviados: 0, interrompido: INTERROMPIDO_POR_TEMPO })
    expect((await linha(id)).syncStatus).toBe('pendente')
  })

  it('pendente antes de erro; teto por execução; quem falhou não repete na fase erro', async () => {
    const velho = await criar('velho@example.com', { syncStatus: 'erro' })
    await criar('novo@example.com')
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente, limite: 1, registrar: false })
    expect(f.de('salvar').map((c) => (c.op === 'salvar' ? c.corpo.email : ''))).toEqual(['novo@example.com'])
    expect((await linha(velho)).syncStatus).toBe('erro')
    expect(await db.select().from(sincronizacoes)).toHaveLength(0)

    const g = resendContatosFalso()
    g.falhar('salvar', 'velho@example.com', new ErroResend('invalido'))
    await sincronizarPendentes({ db, cliente: g.cliente, registrar: false })
    expect(g.de('salvar')).toHaveLength(1)
  })

  it('`ids` limita aos contatos pedidos', async () => {
    const a = await criar('a@example.com')
    await criar('b@example.com')
    const f = resendContatosFalso()
    await sincronizarPendentes({ db, cliente: f.cliente, ids: [a], registrar: false })
    expect(f.de('salvar')).toHaveLength(1)
    f.chamadas.length = 0
    await sincronizarPendentes({ db, cliente: f.cliente, ids: [], registrar: false })
    expect(f.chamadas).toHaveLength(0)
  })
})

describe('estadoIntegracao', () => {
  it('conta pendentes e erros, devolve o último sync e o acesso público', async () => {
    await criar('a@example.com', { syncStatus: 'pendente' })
    await criar('b@example.com', { syncStatus: 'erro' })
    await criar('c@example.com', { syncStatus: 'sincronizado' })
    const vazio = await estadoIntegracao({ db, conectado: false, acessoPublico: async () => true })
    expect(vazio).toEqual({ conectado: false, acessoPublico: true, pendentes: 1, erros: 1, ultimoSync: null })

    await sincronizarPendentes({ db, cliente: resendContatosFalso().cliente })
    const e = await estadoIntegracao({ db, conectado: true, acessoPublico: async () => false })
    expect(e).toMatchObject({ conectado: true, acessoPublico: false, pendentes: 0, erros: 0 })
    expect(e.ultimoSync).toMatchObject({ fonte: 'resend-contatos' })
  })

  it('acessoPublico nulo quando a checagem falha', async () => {
    const e = await estadoIntegracao({ db, conectado: true, acessoPublico: async () => { throw new Error('x') } })
    expect(e.acessoPublico).toBeNull()
  })
})
