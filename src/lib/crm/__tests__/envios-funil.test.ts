import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { and, asc, eq } from 'drizzle-orm'
import { contatos, enviosFunil, eventosContato, funilInscricoes, funis, webhookEventosRecebidos, type Contato } from '@/lib/db/schema'
import { ErroResend, type ClienteResend } from '@/lib/resend'
import type { BancoCrm } from '../banco'
import { mudarStatus } from '../contatos'
import { enviarBoasVindasAgora, enviarEtapa, etapasDevidas, executarEnviosFunil } from '../envios-funil'
import { EMAILS_FUNIS } from '../funis-conteudo'
import { definirAtivo, garantirFunis, inscrever, obterFunil, sair } from '../funis'
import { criarBancoTesteFunis } from './banco-teste-funis'

let db: BancoCrm
let fechar: () => Promise<void>
const ORIGINAL = { ...process.env }
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
  process.env.DESCADASTRO_SEGREDO = 'segredo-de-teste-descartavel'
  process.env.URL_PUBLICA_PAINEL = 'https://painel.example.com'
  delete process.env.WHATSAPP_LINK
  delete process.env.RESEND_LIMITE_DIARIO
})
afterEach(async () => {
  await fechar()
  process.env = { ...ORIGINAL }
})

async function inscricao() {
  const [f] = await garantirFunis({ db })
  const [c] = await db
    .insert(contatos)
    .values({ nome: 'A', email: 'a@example.com', emailNormalizado: 'a@example.com', origem: 'site', baseLegal: 'consentimento' })
    .returning()
  const [i] = await db.insert(funilInscricoes).values({ contatoId: c.id, funilId: f.id, origem: 'site' }).returning()
  return i
}

describe('envios_funil', () => {
  it('uma etapa nunca é gravada duas vezes para a mesma inscrição', async () => {
    const i = await inscricao()
    await db.insert(enviosFunil).values({ inscricaoId: i.id, etapa: 0, status: 'enviado', resendEmailId: 'r1' })
    await expect(db.insert(enviosFunil).values({ inscricaoId: i.id, etapa: 0, status: 'erro' })).rejects.toThrow()
    await db.insert(enviosFunil).values({ inscricaoId: i.id, etapa: 1, status: 'erro', erro: 'x' })
    expect(await db.select().from(enviosFunil)).toHaveLength(2)
  })

  it('apagar a inscrição apaga os envios (cascade)', async () => {
    const i = await inscricao()
    await db.insert(enviosFunil).values({ inscricaoId: i.id, etapa: 0, status: 'enviado' })
    await db.delete(funilInscricoes).where(eq(funilInscricoes.id, i.id))
    expect(await db.select().from(enviosFunil)).toHaveLength(0)
  })
})

describe('webhook_eventos_recebidos', () => {
  it('o mesmo svix-id não grava duas vezes', async () => {
    await db.insert(webhookEventosRecebidos).values({ id: 'msg_1' }).onConflictDoNothing()
    await db.insert(webhookEventosRecebidos).values({ id: 'msg_1' }).onConflictDoNothing()
    expect(await db.select().from(webhookEventosRecebidos)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Motor dos funis (Task 4)
// ---------------------------------------------------------------------------

const AGORA = new Date('2026-10-29T12:00:00Z')
const DIA = 86_400_000
const depois = (dias: number) => new Date(AGORA.getTime() + dias * DIA)

type Enviado = Parameters<ClienteResend['enviarEmail']>[0]

/** Cliente do Resend falso: só `enviarEmail`; o resto falha se for chamado. */
function resendFalso(opts: { falhar?: () => Error | null; antes?: (e: Enviado) => Promise<void> } = {}) {
  const enviados: Enviado[] = []
  let n = 0
  const cliente = new Proxy({} as ClienteResend, {
    get(_t, prop) {
      if (prop === 'enviarEmail') {
        return async (e: Enviado) => {
          await opts.antes?.(e)
          const erro = opts.falhar?.()
          if (erro) throw erro
          enviados.push(e)
          return { id: `re_${++n}` }
        }
      }
      if (prop === 'then') return undefined
      return () => {
        throw new Error(`chamada inesperada: ${String(prop)}`)
      }
    },
  })
  return { cliente, enviados }
}

let seq = 0
async function contato(extra: Partial<typeof contatos.$inferInsert> = {}): Promise<Contato> {
  seq++
  const email = `pessoa${seq}@example.com`
  const [c] = await db
    .insert(contatos)
    .values({ nome: `Pessoa ${seq}`, email, emailNormalizado: email, origem: 'site', baseLegal: 'consentimento', status: 'lead', ...extra })
    .returning()
  return c
}
async function lead(agora = AGORA) {
  const c = await contato()
  await inscrever('boas-vindas', [c.id], { db, caminho: 'site', agora })
  return c
}
async function cliente(agora = AGORA) {
  const c = await contato({ status: 'cliente', baseLegal: 'contrato', origem: 'planilha' })
  await inscrever('reativacao', [c.id], { db, caminho: 'manual', agora })
  return c
}
async function inscricaoDe(contatoId: number, slug: string) {
  const [f] = await db.select().from(funis).where(eq(funis.slug, slug))
  const [i] = await db.select().from(funilInscricoes).where(and(eq(funilInscricoes.contatoId, contatoId), eq(funilInscricoes.funilId, f.id)))
  return i
}
const base = (cliente: ClienteResend, agora = AGORA) => ({ db, cliente, agora, acessoPublico: true })

describe('etapasDevidas', () => {
  it('etapa 0 devida no dia da entrada', async () => {
    const c = await lead()
    const d = await etapasDevidas(AGORA, { db })
    expect(d).toEqual([{ inscricaoId: (await inscricaoDe(c.id, 'boas-vindas')).id, contatoId: c.id, slug: 'boas-vindas', etapa: 0 }])
    // Antes da entrada, nada é devido.
    expect(await etapasDevidas(new Date(AGORA.getTime() - 60_000), { db })).toEqual([])
  })

  it('etapa 1 só depois de esperarDias do envio da 0', async () => {
    const c = await lead()
    const r = resendFalso()
    await executarEnviosFunil({ ...base(r.cliente) })
    const espera = EMAILS_FUNIS['boas-vindas'][1].esperarDias
    expect(await etapasDevidas(depois(espera - 0.01), { db })).toEqual([])
    expect(await etapasDevidas(depois(espera), { db })).toMatchObject([{ contatoId: c.id, etapa: 1 }])
    // A referência é o envio, não a entrada: a 0 atrasada empurra a 1.
    const atrasado = await lead()
    await executarEnviosFunil({ ...base(r.cliente, depois(2)) })
    expect((await etapasDevidas(depois(espera), { db })).map((x) => x.contatoId)).toEqual([c.id])
    expect((await etapasDevidas(depois(espera + 2), { db })).map((x) => x.contatoId)).toContain(atrasado.id)
  })

  it('funil desligado não envia', async () => {
    await lead()
    await definirAtivo('boas-vindas', false, { db })
    expect(await etapasDevidas(AGORA, { db })).toEqual([])
    const r = resendFalso()
    expect(await executarEnviosFunil({ ...base(r.cliente) })).toEqual({ enviados: 0, pulados: 0, erros: 0, restantes: 0 })
    expect(r.enviados).toHaveLength(0)
  })

  it('nutrição com o blog não tem sequência; inscrição que saiu não é devida', async () => {
    const n = await contato({ status: 'cliente', baseLegal: 'contrato' })
    await inscrever('nutricao-blog', [n.id], { db, caminho: 'manual', agora: AGORA })
    const c = await lead()
    await sair((await obterFunil('boas-vindas', { db })).id, [c.id], { db, motivo: 'x', agora: AGORA })
    expect(await etapasDevidas(depois(30), { db })).toEqual([])
  })
})

describe('enviarEtapa', () => {
  it('descadastrado entre a seleção e o envio é pulado e nada é enviado', async () => {
    const c = await lead()
    const [item] = await etapasDevidas(AGORA, { db })
    // Direto no banco (como uma planilha faria): a inscrição continua ativa, só o contato mudou.
    await db.update(contatos).set({ status: 'descadastrado' }).where(eq(contatos.id, c.id))
    const r = resendFalso()
    expect(await enviarEtapa(item, base(r.cliente))).toBe('pulado')
    expect(r.enviados).toHaveLength(0)
    expect(await db.select().from(enviosFunil)).toHaveLength(0)
  })

  it('descadastrado durante a rotina: o contato seguinte da mesma rodada não recebe', async () => {
    const a = await lead()
    const b = await lead()
    const r = resendFalso({
      // O primeiro envio "demora"; nesse meio tempo o segundo contato se descadastra.
      antes: async (e) => {
        if (e.para === a.email) await mudarStatus(b.id, 'descadastrado', { db, origem: 'descadastro', motivo: 'link' })
      },
    })
    expect(await executarEnviosFunil({ ...base(r.cliente) })).toMatchObject({ enviados: 1, pulados: 1 })
    expect(r.enviados.map((e) => e.para)).toEqual([a.email])
  })

  it('dados apagados é pulado', async () => {
    const c = await lead()
    const [item] = await etapasDevidas(AGORA, { db })
    await db.update(contatos).set({ dadosApagadosEm: AGORA }).where(eq(contatos.id, c.id))
    const r = resendFalso()
    expect(await enviarEtapa(item, base(r.cliente))).toBe('pulado')
    expect(r.enviados).toHaveLength(0)
  })

  it('inscrição que deixou de estar ativa, ou funil desligado depois da seleção, é pulado', async () => {
    const c = await lead()
    const [item] = await etapasDevidas(AGORA, { db })
    await definirAtivo('boas-vindas', false, { db })
    const r = resendFalso()
    expect(await enviarEtapa(item, base(r.cliente))).toBe('pulado')
    await definirAtivo('boas-vindas', true, { db })
    await sair((await obterFunil('boas-vindas', { db })).id, [c.id], { db, motivo: 'x', agora: AGORA })
    expect(await enviarEtapa(item, base(r.cliente))).toBe('pulado')
    expect(r.enviados).toHaveLength(0)
  })

  it('List-Unsubscribe e Idempotency-Key presentes', async () => {
    const c = await lead()
    const [item] = await etapasDevidas(AGORA, { db })
    const r = resendFalso()
    expect(await enviarEtapa(item, base(r.cliente))).toBe('enviado')
    const [e] = r.enviados
    expect(e.para).toBe(c.email)
    expect(e.chaveIdempotencia).toBe(`funil-${item.inscricaoId}-0`)
    expect(e.cabecalhos?.['List-Unsubscribe']).toMatch(/^<https:\/\/painel\.example\.com\/api\/publico\/descadastro\?t=[^>]+>$/)
    expect(e.cabecalhos?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
    expect(e.tags).toContainEqual({ name: 'funil', value: 'boas-vindas' })
    expect(e.assunto).toBe(EMAILS_FUNIS['boas-vindas'][0].assunto)
    expect(e.html).toContain('https://painel.example.com/descadastro?t=')
    const [envio] = await db.select().from(enviosFunil)
    expect(envio).toMatchObject({ inscricaoId: item.inscricaoId, etapa: 0, status: 'enviado', resendEmailId: 're_1', erro: null })
    const evs = await db.select().from(eventosContato).where(and(eq(eventosContato.contatoId, c.id), eq(eventosContato.tipo, 'enviado')))
    expect(evs).toHaveLength(1)
    expect(JSON.stringify(evs[0].dados)).not.toContain('example.com')
    expect(JSON.stringify(evs[0].dados)).not.toContain('Pessoa')
  })

  it('erro do Resend fica gravado sem dado pessoal e a etapa é tentada de novo depois', async () => {
    await lead()
    const [item] = await etapasDevidas(AGORA, { db })
    let falhar = true
    const r = resendFalso({ falhar: () => (falhar ? new ErroResend('servidor') : null) })
    expect(await enviarEtapa(item, base(r.cliente))).toBe('erro')
    const [envio] = await db.select().from(enviosFunil)
    expect(envio).toMatchObject({ status: 'erro', erro: 'o Resend está indisponível; tente de novo' })
    expect(await etapasDevidas(depois(1), { db })).toMatchObject([{ etapa: 0 }])
    falhar = false
    expect(await enviarEtapa(item, base(r.cliente, depois(1)))).toBe('enviado')
    expect(await db.select().from(enviosFunil)).toMatchObject([{ status: 'enviado', erro: null }])
  })

  it('última etapa conclui inscrição', async () => {
    const c = await lead()
    const r = resendFalso()
    let dia = 0
    for (const e of EMAILS_FUNIS['boas-vindas']) {
      dia += e.esperarDias
      expect(await executarEnviosFunil({ ...base(r.cliente, depois(dia)) })).toMatchObject({ enviados: 1 })
    }
    expect(r.enviados).toHaveLength(3)
    expect(await inscricaoDe(c.id, 'boas-vindas')).toMatchObject({ status: 'concluido', motivoSaida: 'sequência concluída', saiuEm: depois(dia) })
    const [ultimo] = await db.select().from(eventosContato).where(eq(eventosContato.contatoId, c.id)).orderBy(asc(eventosContato.id)).then((l) => l.slice(-1))
    expect(ultimo).toMatchObject({ tipo: 'saiu_funil', dados: { concluido: true } })
    expect(await etapasDevidas(depois(100), { db })).toEqual([])
  })

  it('reentrada recomeça a sequência do email 1', async () => {
    const c = await lead()
    const r = resendFalso()
    await executarEnviosFunil({ ...base(r.cliente) })
    const f = await obterFunil('boas-vindas', { db })
    await sair(f.id, [c.id], { db, motivo: 'x', agora: depois(1) })
    await inscrever('boas-vindas', [c.id], { db, caminho: 'manual', agora: depois(40) })
    expect(await etapasDevidas(depois(40), { db })).toMatchObject([{ contatoId: c.id, etapa: 0 }])
    expect(await executarEnviosFunil({ ...base(r.cliente, depois(40)) })).toMatchObject({ enviados: 1 })
  })
})

describe('executarEnviosFunil', () => {
  it('índice único impede segundo envio da mesma etapa (dois executarEnviosFunil seguidos)', async () => {
    await lead()
    await lead()
    const r = resendFalso()
    expect(await executarEnviosFunil({ ...base(r.cliente) })).toEqual({ enviados: 2, pulados: 0, erros: 0, restantes: 0 })
    expect(await executarEnviosFunil({ ...base(r.cliente) })).toEqual({ enviados: 0, pulados: 0, erros: 0, restantes: 0 })
    expect(r.enviados).toHaveLength(2)
    // A mesma etapa reenviada à mão (corrida entre duas execuções) bate no índice único.
    const [i] = await db.select().from(funilInscricoes).orderBy(asc(funilInscricoes.id))
    const item = { inscricaoId: i.id, contatoId: i.contatoId, slug: 'boas-vindas' as const, etapa: 0 }
    expect(await enviarEtapa(item, base(r.cliente))).toBe('pulado')
    expect(r.enviados).toHaveLength(2)
    expect(await db.select().from(enviosFunil)).toHaveLength(2)
  })

  it('limite 2 com 3 devidas envia 2 boas-vindas antes da reativação e deixa 1 restante', async () => {
    const reat = await cliente(new Date(AGORA.getTime() - 3_600_000))
    const a = await lead()
    const b = await lead()
    const r = resendFalso()
    expect(await executarEnviosFunil({ ...base(r.cliente), limite: 2 })).toEqual({ enviados: 2, pulados: 0, erros: 0, restantes: 1 })
    expect(r.enviados.map((e) => e.para).sort()).toEqual([a.email, b.email].sort())
    // No dia seguinte, a que sobrou sai.
    expect(await executarEnviosFunil({ ...base(r.cliente, depois(1)), limite: 2 })).toMatchObject({ enviados: 1, restantes: 0 })
    expect(r.enviados.at(-1)?.para).toBe(reat.email)
  })

  it('o limite vem de RESEND_LIMITE_DIARIO e conta o que já saiu hoje', async () => {
    process.env.RESEND_LIMITE_DIARIO = '2'
    const a = await lead()
    const r = resendFalso()
    expect(await enviarBoasVindasAgora(a.id, base(r.cliente))).toBe('enviado')
    await lead()
    await lead()
    expect(await executarEnviosFunil({ ...base(r.cliente) })).toEqual({ enviados: 1, pulados: 0, erros: 0, restantes: 1 })
  })

  it('sem acesso público não envia', async () => {
    const a = await lead()
    await lead()
    const r = resendFalso()
    expect(await executarEnviosFunil({ ...base(r.cliente), acessoPublico: false })).toEqual({ enviados: 0, pulados: 0, erros: 0, restantes: 2 })
    expect(await enviarBoasVindasAgora(a.id, { ...base(r.cliente), acessoPublico: false })).toBe('pulado')
    expect(r.enviados).toHaveLength(0)
    expect(await db.select().from(enviosFunil)).toHaveLength(0)
  })

  it('para no meio quando o prazo acaba; o resto fica restante', async () => {
    await lead()
    await lead()
    const r = resendFalso()
    let chamadas = 0
    expect(await executarEnviosFunil({ ...base(r.cliente), deveParar: () => ++chamadas > 1 })).toMatchObject({ enviados: 1, restantes: 1 })
  })
})

describe('enviarBoasVindasAgora', () => {
  it('envia a etapa 0 na hora, uma vez só; sem inscrição não faz nada', async () => {
    const c = await lead()
    const r = resendFalso()
    expect(await enviarBoasVindasAgora(c.id, base(r.cliente))).toBe('enviado')
    expect(await enviarBoasVindasAgora(c.id, base(r.cliente))).toBe('nada_devido')
    const sem = await contato()
    expect(await enviarBoasVindasAgora(sem.id, base(r.cliente))).toBe('nada_devido')
    expect(r.enviados).toHaveLength(1)
  })

  it('descadastrado não recebe a boas-vindas imediata', async () => {
    const c = await lead()
    await mudarStatus(c.id, 'descadastrado', { db, origem: 'descadastro', motivo: 'link' })
    const r = resendFalso()
    await enviarBoasVindasAgora(c.id, base(r.cliente))
    expect(r.enviados).toHaveLength(0)
  })
})
