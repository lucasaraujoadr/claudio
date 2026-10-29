import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { contatos, importacoesContatos } from '@/lib/db/schema'
import type { BancoCrm } from '../banco'
import { mudarStatus, upsertContato } from '../contatos'
import { lerCsv } from '../csv'
import {
  adivinharMapeamento,
  confirmarLote,
  prepararImportacao,
  relatorioCsv,
  salvarLote,
  type Mapeamento,
} from '../importacao'
import { criarBancoTeste } from './banco-teste'

describe('adivinharMapeamento', () => {
  it('reconhece os cabeçalhos usuais, com e sem acento', () => {
    expect(adivinharMapeamento(['Nome', 'E-mail', 'Telefone', 'Escritório', 'Cidade', 'UF', 'Tags', 'Observações'])).toEqual({
      nome: 0, email: 1, telefone: 2, escritorio: 3, cidade: 4, uf: 5, tags: 6, notas: 7,
    })
    expect(adivinharMapeamento(['EMAIL', 'Nome completo', 'Celular', 'Estado', 'Coluna X'])).toMatchObject({
      email: 0, nome: 1, telefone: 2, uf: 3, escritorio: null, cidade: null,
    })
  })

  it('não usa a mesma coluna para dois campos', () => {
    const m = adivinharMapeamento(['Email', 'email'])
    expect(m.email).toBe(0)
    expect(Object.values(m).filter((v) => v === 1)).toHaveLength(0)
  })
})

describe('prepararImportacao', () => {
  const csv = [
    'Nome;E-mail;Cidade',
    'Ana;ana@example.com;Natal',
    'Ana de novo;ANA@Example.com ;Recife',
    'Sem email;;',
    'Inválido;nao-e-email;',
    '',
    'Bia;bia@example.com;',
  ].join('\n')

  it('pula vazios, inválidos e duplicados do próprio arquivo, citando a linha da planilha', () => {
    const r = lerCsv(csv)
    if (!r.ok) throw new Error('csv')
    const p = prepararImportacao(r, adivinharMapeamento(r.cabecalho), { baseLegal: 'legitimo_interesse', tags: ['Lote outubro'] })
    expect(p.itens.map((i) => [i.linha, i.dados.email])).toEqual([[2, 'ana@example.com'], [7, 'bia@example.com']])
    expect(p.itens[0].dados).toMatchObject({ nome: 'Ana', cidade: 'Natal', baseLegal: 'legitimo_interesse', tags: ['lote outubro'] })
    expect(p.ignorados).toEqual([
      { linha: 3, email: 'ANA@Example.com', motivo: 'duplicado', linhaOriginal: 2 },
      { linha: 4, email: '', motivo: 'email_vazio' },
      { linha: 5, email: 'nao-e-email', motivo: 'email_invalido' },
    ])
  })
})

describe('lote de importação no banco', () => {
  let db: BancoCrm
  let fechar: () => Promise<void>
  beforeEach(async () => {
    ;({ db, fechar } = await criarBancoTeste())
  })
  afterEach(async () => {
    await fechar()
  })

  const texto = [
    'Nome,E-mail,Tags',
    'Ana,ana@example.com,cliente antigo',
    'Bruno,bruno@example.com,',
    'Bruno Dup,BRUNO@example.com,',
    'Quebrado,quebrado@,',
    'Dani,dani@example.com,',
    'Edu,edu@example.com,',
  ].join('\r\n')

  async function preparar() {
    // Dani já existe e se descadastrou; Edu já existe com consentimento.
    const dani = await upsertContato({ email: 'dani@example.com', nome: 'Dani', baseLegal: 'consentimento' }, 'site', { db })
    await mudarStatus(dani.contatoId!, 'descadastrado', { db, origem: 'brevo' })
    await upsertContato({ email: 'edu@example.com', baseLegal: 'consentimento' }, 'site', { db })
    return salvarLote({ nomeArquivo: 'advogados.csv', texto }, { db })
  }
  const mapa: Mapeamento = { nome: 0, email: 1, tags: 2, telefone: null, escritorio: null, cidade: null, uf: null, notas: null }

  it('relata criados, atualizados e ignorados com motivo; descadastrado fica intacto', async () => {
    const salvo = await preparar()
    expect(salvo.ok).toBe(true)
    if (!salvo.ok) return
    const antesDani = (await db.select().from(contatos).where(eq(contatos.emailNormalizado, 'dani@example.com')))[0]

    const r = await confirmarLote(salvo.id, mapa, { baseLegal: 'legitimo_interesse', tags: [] }, { db })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.relatorio).toMatchObject({ criados: 2, atualizados: 1, inalterados: 0, ignorados: 3 })
    expect(r.relatorio.linhas).toEqual([
      { linha: 2, email: 'ana@example.com', resultado: 'criado', motivo: null },
      { linha: 3, email: 'bruno@example.com', resultado: 'criado', motivo: null },
      { linha: 4, email: 'BRUNO@example.com', resultado: 'ignorado', motivo: 'Duplicado no arquivo (mesmo e-mail da linha 3)' },
      { linha: 5, email: 'quebrado@', resultado: 'ignorado', motivo: 'E-mail inválido' },
      { linha: 6, email: 'dani@example.com', resultado: 'ignorado', motivo: 'Contato descadastrado: mantido sem alteração' },
      { linha: 7, email: 'edu@example.com', resultado: 'atualizado', motivo: null },
    ])
    const depoisDani = (await db.select().from(contatos).where(eq(contatos.emailNormalizado, 'dani@example.com')))[0]
    expect(depoisDani).toEqual(antesDani)
    const edu = (await db.select().from(contatos).where(eq(contatos.emailNormalizado, 'edu@example.com')))[0]
    expect(edu.baseLegal).toBe('consentimento') // o lote em legítimo interesse não rebaixa
    expect(edu.nome).toBe('Edu')

    const [lote] = await db.select().from(importacoesContatos).where(eq(importacoesContatos.id, salvo.id))
    expect(lote.status).toBe('concluida')
    expect(lote.conteudo).toBeNull() // a planilha não fica guardada depois de importada
  })

  it('a confirmação só roda uma vez', async () => {
    const salvo = await preparar()
    if (!salvo.ok) throw new Error('lote')
    const [a, b] = await Promise.all([
      confirmarLote(salvo.id, mapa, { baseLegal: 'contrato', tags: [] }, { db }),
      confirmarLote(salvo.id, mapa, { baseLegal: 'contrato', tags: [] }, { db }),
    ])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect([a, b].find((x) => !x.ok)).toMatchObject({ motivo: 'ja_processado' })
    expect(await db.select().from(contatos)).toHaveLength(4) // Dani, Edu, Ana, Bruno
  })

  it('recusa mapeamento sem e-mail ou com coluna fora do arquivo', async () => {
    const salvo = await preparar()
    if (!salvo.ok) throw new Error('lote')
    expect(await confirmarLote(salvo.id, { ...mapa, email: null }, { baseLegal: 'contrato', tags: [] }, { db })).toMatchObject({ ok: false, motivo: 'sem_email' })
    expect(await confirmarLote(salvo.id, { ...mapa, nome: 9 }, { baseLegal: 'contrato', tags: [] }, { db })).toMatchObject({ ok: false, motivo: 'mapa_invalido' })
    // continua pendente: dá para corrigir e confirmar
    expect((await confirmarLote(salvo.id, mapa, { baseLegal: 'contrato', tags: [] }, { db })).ok).toBe(true)
  })

  it('salvarLote recusa arquivo acima do limite de linhas sem gravar', async () => {
    const grande = 'Email\n' + Array.from({ length: 5001 }, (_, i) => `p${i}@example.com`).join('\n')
    const r = await salvarLote({ nomeArquivo: 'grande.csv', texto: grande }, { db })
    expect(r).toMatchObject({ ok: false, erro: 'linhas_demais' })
    expect(await db.select().from(importacoesContatos)).toHaveLength(0)
  })

  it('o relatório baixa como CSV para o Excel', async () => {
    const salvo = await preparar()
    if (!salvo.ok) throw new Error('lote')
    const r = await confirmarLote(salvo.id, mapa, { baseLegal: 'contrato', tags: [] }, { db })
    if (!r.ok) throw new Error('confirmar')
    const csv = relatorioCsv(r.relatorio)
    expect(csv.startsWith('﻿Linha;E-mail;Resultado;Motivo\r\n')).toBe(true)
    expect(csv).toContain('5;quebrado@;Ignorado;E-mail inválido\r\n')
  })
})
