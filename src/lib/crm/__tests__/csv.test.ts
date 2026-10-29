import { describe, it, expect } from 'vitest'
import { escreverCsv, lerCsv, decodificarArquivo, LIMITE_LINHAS_IMPORTACAO } from '../csv'

describe('lerCsv', () => {
  it('lê separador vírgula com cabeçalho', () => {
    const r = lerCsv('Nome,E-mail\nAna,ana@example.com\nBia,bia@example.com\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.separador).toBe(',')
    expect(r.cabecalho).toEqual(['Nome', 'E-mail'])
    expect(r.linhas).toEqual([['Ana', 'ana@example.com'], ['Bia', 'bia@example.com']])
  })

  it('detecta ponto e vírgula (Excel pt-BR) e ignora BOM', () => {
    const r = lerCsv('﻿Nome;E-mail;Cidade\r\nJoão;joao@example.com;São Paulo\r\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.separador).toBe(';')
    expect(r.cabecalho).toEqual(['Nome', 'E-mail', 'Cidade'])
    expect(r.linhas).toEqual([['João', 'joao@example.com', 'São Paulo']])
  })

  it('campos entre aspas com separador, aspas escapadas e quebra de linha dentro', () => {
    const texto = 'Nome;Escritório;Notas\r\n"Silva; Souza";"Advocacia ""Lima""";"linha 1\r\nlinha 2"\r\nAna;X;\n'
    const r = lerCsv(texto)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.linhas).toEqual([
      ['Silva; Souza', 'Advocacia "Lima"', 'linha 1\r\nlinha 2'],
      ['Ana', 'X', ''],
    ])
  })

  it('o separador é decidido fora das aspas', () => {
    const r = lerCsv('"Nome; completo",Email\n"A; B",a@example.com')
    expect(r.ok && r.separador).toBe(',')
    expect(r.ok && r.linhas[0]).toEqual(['A; B', 'a@example.com'])
  })

  it('pula linhas totalmente vazias e completa linhas curtas', () => {
    const r = lerCsv('a;b;c\n\n1;2\n;;\n3;4;5')
    expect(r.ok && r.linhas).toEqual([['1', '2', ''], ['3', '4', '5']])
  })

  it('arquivo sem dados ou com aspas não fechadas é recusado com motivo', () => {
    expect(lerCsv('')).toMatchObject({ ok: false, erro: 'vazio' })
    expect(lerCsv('Nome;Email\n')).toMatchObject({ ok: false, erro: 'sem_linhas' })
    expect(lerCsv('Nome;Email\n"Ana;ana@example.com\n')).toMatchObject({ ok: false, erro: 'aspas_abertas' })
  })

  it(`aceita ${LIMITE_LINHAS_IMPORTACAO} linhas e recusa ${LIMITE_LINHAS_IMPORTACAO + 1} com mensagem`, () => {
    const corpo = (n: number) => 'Email\n' + Array.from({ length: n }, (_, i) => `p${i}@example.com`).join('\n')
    const ok = lerCsv(corpo(LIMITE_LINHAS_IMPORTACAO))
    expect(ok.ok && ok.linhas.length).toBe(5000)
    const demais = lerCsv(corpo(LIMITE_LINHAS_IMPORTACAO + 1))
    expect(demais).toMatchObject({ ok: false, erro: 'linhas_demais' })
    if (!demais.ok) expect(demais.mensagem).toContain('5.000')
  })
})

describe('decodificarArquivo', () => {
  it('UTF-8 com e sem BOM', () => {
    const semBom = new TextEncoder().encode('Nome\nJoão')
    expect(decodificarArquivo(semBom)).toEqual({ texto: 'Nome\nJoão', codificacao: 'utf-8' })
    const comBom = new Uint8Array([0xef, 0xbb, 0xbf, ...semBom])
    expect(decodificarArquivo(comBom).texto).toBe('Nome\nJoão')
  })

  it('cai para Windows-1252 quando o arquivo não é UTF-8 válido (Excel "CSV" antigo)', () => {
    // "João" em Windows-1252: ã = 0xE3
    const bytes = new Uint8Array([0x4a, 0x6f, 0xe3, 0x6f])
    expect(decodificarArquivo(bytes)).toEqual({ texto: 'João', codificacao: 'windows-1252' })
  })
})

describe('escreverCsv', () => {
  it('começa com BOM, usa ; e CRLF, e escapa o que precisa', () => {
    const csv = escreverCsv(['Nome', 'Notas'], [['Ana; Bia', 'disse "oi"\nfim'], ['São Paulo', '']])
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toBe('﻿Nome;Notas\r\n"Ana; Bia";"disse ""oi""\nfim"\r\nSão Paulo;\r\n')
  })

  it('neutraliza fórmulas (injeção de CSV no Excel)', () => {
    const csv = escreverCsv(['a', 'b', 'c', 'd'], [['=SOMA(A1)', '+55 11', '-x', '@cmd']])
    expect(csv.split('\r\n')[1]).toBe("'=SOMA(A1);'+55 11;'-x;'@cmd")
  })

  it('volta pelo próprio leitor com acentos intactos', () => {
    const csv = escreverCsv(['Nome', 'Cidade'], [['Conceição', 'Goiânia'], ['x;y', 'a\r\nb']])
    const bytes = new TextEncoder().encode(csv)
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    const r = lerCsv(decodificarArquivo(bytes).texto)
    expect(r.ok && r.linhas).toEqual([['Conceição', 'Goiânia'], ['x;y', 'a\r\nb']])
  })
})
