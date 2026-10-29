import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AA_GRAFICO, AA_TEXTO, razaoContraste, tokensDoBloco } from '../contraste'

const css = readFileSync(path.resolve(__dirname, '../../../app/globals.css'), 'utf8')
const claro = tokensDoBloco(css, '[data-theme="claro"] {')
const escuro = tokensDoBloco(css, '[data-theme="escuro"] {')
const escuroSistema = tokensDoBloco(css, ':root:not([data-theme]) {')

/** Cor do logo em cada tema (os PNGs em public/ são monocromáticos nessas cores). */
const LOGO = { claro: '#7a580c', escuro: '#daa522' }

type Par = { texto: string; fundo: string; minimo: number }

const FUNDOS = ['fundo', 'superficie', 'elevada']
const STATUS = ['critico', 'aviso', 'info', 'sucesso']

function pares(): Par[] {
  const lista: Par[] = []
  for (const f of FUNDOS) {
    lista.push({ texto: 'tinta', fundo: f, minimo: AA_TEXTO })
    lista.push({ texto: 'tinta-suave', fundo: f, minimo: AA_TEXTO })
    lista.push({ texto: 'acento-texto', fundo: f, minimo: AA_TEXTO })
    lista.push({ texto: 'foco', fundo: f, minimo: AA_GRAFICO })
    for (const s of STATUS) lista.push({ texto: s, fundo: f, minimo: AA_TEXTO })
    // Contorno de campo (WCAG 1.4.11, componente de interface) e séries de gráfico.
    lista.push({ texto: 'borda-campo', fundo: f, minimo: AA_GRAFICO })
    lista.push({ texto: 'serie-1', fundo: f, minimo: AA_GRAFICO })
    lista.push({ texto: 'serie-2', fundo: f, minimo: AA_GRAFICO })
  }
  lista.push({ texto: 'tinta', fundo: 'acento-suave', minimo: AA_TEXTO })
  lista.push({ texto: 'acento-texto', fundo: 'acento-suave', minimo: AA_TEXTO })
  lista.push({ texto: 'sobre-acento', fundo: 'acento', minimo: AA_TEXTO })
  lista.push({ texto: 'sobre-acento', fundo: 'acento-forte', minimo: AA_TEXTO })
  for (const s of STATUS) {
    lista.push({ texto: s, fundo: `${s}-fundo`, minimo: AA_TEXTO })
    lista.push({ texto: 'tinta', fundo: `${s}-fundo`, minimo: AA_TEXTO })
  }
  return lista
}

describe('tokens de cor', () => {
  it('cada token existe nos dois temas', () => {
    expect(Object.keys(claro).length).toBeGreaterThan(20)
    expect(Object.keys(escuro).sort()).toEqual(Object.keys(claro).sort())
  })

  it('o bloco do sistema (sem JS) é cópia exata do tema escuro', () => {
    expect(escuroSistema).toEqual(escuro)
  })

  for (const [nome, tokens] of [
    ['claro', claro],
    ['escuro', escuro],
  ] as const) {
    describe(`tema ${nome}`, () => {
      for (const p of pares()) {
        it(`${p.texto} sobre ${p.fundo} ≥ ${p.minimo}`, () => {
          const r = razaoContraste(tokens[p.texto], tokens[p.fundo])
          if (process.env.MOSTRAR_CONTRASTE) {
            console.log(`| ${nome} | ${p.texto} | ${p.fundo} | ${tokens[p.texto]} / ${tokens[p.fundo]} | ${r.toFixed(2)} | ${p.minimo} |`)
          }
          expect(r).toBeGreaterThanOrEqual(p.minimo)
        })
      }

      it('o logo do tema é legível como texto sobre o fundo e a superfície', () => {
        for (const f of ['fundo', 'superficie']) {
          const r = razaoContraste(LOGO[nome], tokens[f])
          if (process.env.MOSTRAR_CONTRASTE) {
            console.log(`| ${nome} | logo | ${f} | ${LOGO[nome]} / ${tokens[f]} | ${r.toFixed(2)} | ${AA_TEXTO} |`)
          }
          expect(r).toBeGreaterThanOrEqual(AA_TEXTO)
        }
      })
    })
  }
})

describe('razaoContraste', () => {
  it('reproduz os valores de referência do WCAG', () => {
    expect(razaoContraste('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(razaoContraste('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    expect(razaoContraste('#777', '#fff')).toBeCloseTo(4.48, 2)
    expect(razaoContraste('#fff', '#777')).toBe(razaoContraste('#777', '#fff'))
  })

  it('rejeita cor inválida', () => {
    expect(() => razaoContraste('vermelho', '#fff')).toThrow()
  })
})
