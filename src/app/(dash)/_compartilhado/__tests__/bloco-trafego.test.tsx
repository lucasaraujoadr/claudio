// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { datasEntre } from '@/components/graficos/serie'
import { IndicadoresTrafego } from '../bloco-trafego'
import { resumirTrafego, type DiaGa4 } from '../trafego'

afterEach(cleanup)

const dias: DiaGa4[] = datasEntre('2026-07-31', '2026-10-28').map((data) => ({
  data,
  sessoes: 10,
  usuarios: 9,
  sessoesEngajadas: 5,
  eventosChave: 0,
}))
const resumo = resumirTrafego(dias)!

function bloco(rotulo: string): HTMLElement {
  return screen.getByText(rotulo, { selector: 'p' }).parentElement!
}

describe('IndicadoresTrafego', () => {
  it('usuários vêm dos totais deduplicados, com período e variação', () => {
    render(
      <IndicadoresTrafego
        resumo={resumo}
        usuarios={{ inicioAtual: '2026-10-01', fimAtual: '2026-10-28', inicioAnterior: '2026-09-03', fimAnterior: '2026-09-30', usuariosAtual: 909, usuariosAnterior: 1060 }}
      />,
    )
    const u = bloco('Usuários')
    expect(u.textContent).toContain('909')
    expect(u.textContent).toContain('−151')
    expect(u.textContent).toContain('Usuários únicos de 01/10/2026 a 28/10/2026')
  })

  it('sem totais: "sem dado" — nunca a soma dos usuários diários (9 × 28 = 252)', () => {
    render(<IndicadoresTrafego resumo={resumo} usuarios={null} />)
    const u = bloco('Usuários')
    expect(u.textContent).toContain('sem dado')
    expect(u.textContent).not.toContain('252')
    expect(u.hasAttribute('data-sem-dado')).toBe(true)
  })

  it('falha de leitura dos totais é dita como tal', () => {
    render(<IndicadoresTrafego resumo={resumo} usuarios={null} falhaUsuarios />)
    expect(bloco('Usuários').textContent).toContain('não foi possível carregar')
  })

  it('eventos-chave zerados nas duas janelas explicam a provável causa', () => {
    render(<IndicadoresTrafego resumo={resumo} usuarios={null} />)
    expect(bloco('Eventos-chave').textContent).toMatch(/nenhum evento está marcado como chave no GA4/)
  })
})
