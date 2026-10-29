import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asc, eq } from 'drizzle-orm'
import { contatos, eventosContato, funilInscricoes } from '@/lib/db/schema'
import type { BancoCrm } from '@/lib/crm/banco'
import { upsertContato } from '@/lib/crm/contatos'
import { garantirFunis, inscrever } from '@/lib/crm/funis'
import { apagarDadosAPedido } from '@/lib/crm/apagar-dados'
import { criarBancoTesteFunis } from '@/lib/crm/__tests__/banco-teste-funis'
import type { ClienteResend } from '@/lib/resend'
import {
  descadastrarPorToken,
  gerarTokenDescadastro,
  lerTokenDescadastro,
  responderDescadastro,
  urlDescadastro,
} from '../descadastro'

const SEGREDO = 'segredo-de-teste-descadastro'
const AGORA = new Date('2026-10-29T15:00:00Z')
const DIA = 86_400_000

let db: BancoCrm
let fechar: () => Promise<void>
beforeEach(async () => {
  ;({ db, fechar } = await criarBancoTesteFunis())
  await garantirFunis({ db })
})
afterEach(async () => {
  await fechar()
  vi.unstubAllEnvs()
})

async function criar(email = 'ana@example.com') {
  const r = await upsertContato({ email, nome: 'Ana', baseLegal: 'consentimento' }, 'manual', { db })
  if (r.acao !== 'criado') throw new Error('não criou')
  await db.update(contatos).set({ syncStatus: 'sincronizado' }).where(eq(contatos.id, r.contatoId))
  return r.contatoId
}
async function linha(id: number) {
  const [c] = await db.select().from(contatos).where(eq(contatos.id, id))
  return c
}
async function eventos(id: number) {
  return db.select().from(eventosContato).where(eq(eventosContato.contatoId, id)).orderBy(asc(eventosContato.id))
}
function clienteFalso(falha = false) {
  const chamadas: { email: string; nome: string | null; descadastrado: boolean }[] = []
  const cliente = {
    salvarContato: async (c: { email: string; nome: string | null; descadastrado: boolean }) => {
      chamadas.push(c)
      if (falha) throw new Error('falhou')
      return { id: 'c1' }
    },
  } as unknown as ClienteResend
  return { cliente, chamadas }
}

describe('token de descadastro', () => {
  it('token válido volta o id', () => {
    const t = gerarTokenDescadastro(42, AGORA, SEGREDO)
    expect(lerTokenDescadastro(t, AGORA, SEGREDO)).toEqual({ contatoId: 42 })
    expect(lerTokenDescadastro(t, new Date(AGORA.getTime() + 364 * DIA), SEGREDO)).toEqual({ contatoId: 42 })
  })
  it('token adulterado → null', () => {
    const t = gerarTokenDescadastro(42, AGORA, SEGREDO)
    const [corpo, assinatura] = t.split('.')
    const outro = Buffer.from(`43.${Math.floor(AGORA.getTime() / 1000) + 365 * 86400}`).toString('base64url')
    expect(lerTokenDescadastro(`${outro}.${assinatura}`, AGORA, SEGREDO)).toBeNull()
    expect(lerTokenDescadastro(`${corpo}.${assinatura.slice(0, -2)}AA`, AGORA, SEGREDO)).toBeNull()
    expect(lerTokenDescadastro(t, AGORA, 'outro-segredo')).toBeNull()
    expect(lerTokenDescadastro('lixo', AGORA, SEGREDO)).toBeNull()
    expect(lerTokenDescadastro('', AGORA, SEGREDO)).toBeNull()
  })
  it('expirado → null', () => {
    const t = gerarTokenDescadastro(42, AGORA, SEGREDO)
    expect(lerTokenDescadastro(t, new Date(AGORA.getTime() + 366 * DIA), SEGREDO)).toBeNull()
  })
  it('sem segredo → null', () => {
    const t = gerarTokenDescadastro(42, AGORA, SEGREDO)
    expect(lerTokenDescadastro(t, AGORA, '')).toBeNull()
    expect(lerTokenDescadastro(t, AGORA, undefined)).toBeNull()
  })
  it('urlDescadastro usa a URL pública e o segredo do ambiente', () => {
    vi.stubEnv('DESCADASTRO_SEGREDO', SEGREDO)
    vi.stubEnv('URL_PUBLICA_PAINEL', '')
    const url = urlDescadastro(7, AGORA)
    expect(url.startsWith('https://claudio-psi-lime.vercel.app/descadastro?t=')).toBe(true)
    const t = new URL(url).searchParams.get('t')!
    expect(lerTokenDescadastro(t, AGORA, SEGREDO)).toEqual({ contatoId: 7 })
  })
})

describe('descadastrarPorToken', () => {
  it('POST descadastra, sai dos funis e grava evento', async () => {
    const id = await criar()
    await inscrever('boas-vindas', [id], { db, caminho: 'site' })
    const { cliente, chamadas } = clienteFalso()
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    expect(await descadastrarPorToken(t, AGORA, { db, cliente, segredo: SEGREDO })).toBe('ok')

    const c = await linha(id)
    expect(c.status).toBe('descadastrado')
    expect(c.syncStatus).toBe('sincronizado')
    const ins = await db.select().from(funilInscricoes).where(eq(funilInscricoes.contatoId, id))
    expect(ins.length).toBeGreaterThan(0)
    expect(ins.every((i) => i.status === 'saiu')).toBe(true)
    const ev = await eventos(id)
    const tipos = ev.map((e) => e.tipo)
    expect(tipos).toContain('mudou_status')
    expect(tipos).toContain('descadastrou')
    expect(tipos).toContain('saiu_funil')
    expect(ev.find((e) => e.tipo === 'mudou_status')?.dados).toMatchObject({ para: 'descadastrado', origem: 'descadastro', motivo: 'link de descadastro' })
    expect(chamadas).toEqual([{ email: 'ana@example.com', nome: 'Ana', descadastrado: true }])
  })

  it('token inválido não mexe em nada', async () => {
    const id = await criar()
    const { cliente, chamadas } = clienteFalso()
    expect(await descadastrarPorToken('lixo', AGORA, { db, cliente, segredo: SEGREDO })).toBe('invalido')
    expect((await linha(id)).status).toBe('lead')
    expect(chamadas).toEqual([])
  })

  it('token de contato inexistente → invalido', async () => {
    const t = gerarTokenDescadastro(999, AGORA, SEGREDO)
    expect(await descadastrarPorToken(t, AGORA, { db, cliente: null, segredo: SEGREDO })).toBe('invalido')
  })

  it('POST de contato já descadastrado → ja, sem novo evento nem chamada', async () => {
    const id = await criar()
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    await descadastrarPorToken(t, AGORA, { db, cliente: null, segredo: SEGREDO })
    const antes = (await eventos(id)).length
    const { cliente, chamadas } = clienteFalso()
    expect(await descadastrarPorToken(t, AGORA, { db, cliente, segredo: SEGREDO })).toBe('ja')
    expect((await eventos(id)).length).toBe(antes)
    expect(chamadas).toEqual([])
  })

  it('dados_apagados continua descadastrado e responde ja', async () => {
    const id = await criar()
    await apagarDadosAPedido(id, 'pedido do titular', { db })
    const c0 = await linha(id)
    expect(c0.dadosApagadosEm).not.toBeNull()
    expect(c0.status).toBe('descadastrado')
    const { cliente, chamadas } = clienteFalso()
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    expect(await descadastrarPorToken(t, AGORA, { db, cliente, segredo: SEGREDO })).toBe('ja')
    expect((await linha(id)).status).toBe('descadastrado')
    expect(chamadas).toEqual([])
  })

  it('sem cliente do Resend: descadastra localmente e deixa pendente', async () => {
    const id = await criar()
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    expect(await descadastrarPorToken(t, AGORA, { db, cliente: null, segredo: SEGREDO })).toBe('ok')
    const c = await linha(id)
    expect(c.status).toBe('descadastrado')
    expect(c.syncStatus).toBe('pendente')
  })

  it('falha do Resend não derruba o descadastro e deixa pendente', async () => {
    const id = await criar()
    const { cliente, chamadas } = clienteFalso(true)
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    expect(await descadastrarPorToken(t, AGORA, { db, cliente, segredo: SEGREDO })).toBe('ok')
    expect(chamadas.length).toBe(1)
    const c = await linha(id)
    expect(c.status).toBe('descadastrado')
    expect(c.syncStatus).toBe('pendente')
  })
})

describe('responderDescadastro (rota pública)', () => {
  const opts = () => ({ db, cliente: null, segredo: SEGREDO, agora: AGORA })
  const url = (t: string | null) => `http://localhost/api/publico/descadastro${t === null ? '' : `?t=${encodeURIComponent(t)}`}`

  it('GET da página não descadastra', async () => {
    const id = await criar()
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    const r = await responderDescadastro(new Request(url(t), { method: 'GET' }), opts())
    expect(r.status).toBe(405)
    expect((await linha(id)).status).toBe('lead')
    expect(await eventos(id)).not.toContainEqual(expect.objectContaining({ tipo: 'descadastrou' }))
  })

  it('POST com corpo vazio (one-click) descadastra pelo token da query', async () => {
    const id = await criar()
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    const r = await responderDescadastro(new Request(url(t), { method: 'POST' }), opts())
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toContain('text/html')
    expect((await linha(id)).status).toBe('descadastrado')
  })

  it('POST de formulário (urlencoded) com o token no corpo', async () => {
    const id = await criar()
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    const r = await responderDescadastro(
      new Request(url(null), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ t }).toString(),
      }),
      opts(),
    )
    expect(r.status).toBe(200)
    expect((await linha(id)).status).toBe('descadastrado')
  })

  it('POST repetido continua 200', async () => {
    const id = await criar()
    const t = gerarTokenDescadastro(id, AGORA, SEGREDO)
    await responderDescadastro(new Request(url(t), { method: 'POST' }), opts())
    const r = await responderDescadastro(new Request(url(t), { method: 'POST' }), opts())
    expect(r.status).toBe(200)
  })

  it('token inválido ou ausente → 400, sem eco do token', async () => {
    const r = await responderDescadastro(new Request(url('abc<script>'), { method: 'POST' }), opts())
    expect(r.status).toBe(400)
    expect(await r.text()).not.toContain('abc<script>')
    const r2 = await responderDescadastro(new Request(url(null), { method: 'POST' }), opts())
    expect(r2.status).toBe(400)
  })
})
