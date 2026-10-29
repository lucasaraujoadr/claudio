// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { GraficoBarras } from '../grafico-barras'
import { GraficoLinha } from '../grafico-linha'
import { GraficoSemDado } from '../grafico-sem-dado'

afterEach(cleanup)

const datas = ['2026-10-01', '2026-10-02', '2026-10-03']

describe('GraficoLinha', () => {
  function desenhar() {
    return render(
      <GraficoLinha
        titulo="Sessões por dia"
        resumo="Total de 15 sessões."
        datas={datas}
        unidade="sessões"
        series={[
          { id: 's', rotulo: 'Sessões', cor: 1, valores: [5, null, 10] },
          { id: 'e', rotulo: 'Sessões engajadas', cor: 2, valores: [2, null, 4] },
        ]}
      />,
    )
  }

  it('nome anunciado uma vez (no grupo), resumo em texto e legenda para duas séries', () => {
    const { container } = desenhar()
    const grupo = screen.getByRole('group', { name: /^Sessões por dia\./ })
    expect(document.getElementById(grupo.getAttribute('aria-describedby')!)?.textContent).toBe('Total de 15 sessões.')
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
    const legenda = screen.getByRole('list', { name: 'Legenda' })
    expect(within(legenda).getAllByRole('listitem').map((l) => l.textContent)).toEqual(['Sessões', 'Sessões engajadas'])
  })

  it('a tabela equivalente mostra "sem dado" (nunca 0) onde não há valor, do mais recente ao mais antigo', () => {
    desenhar()
    const tabela = screen.getByRole('table', { name: 'Sessões por dia' })
    const linhas = within(tabela).getAllByRole('row').slice(1).map((r) => r.textContent)
    expect(linhas).toEqual(['03/10/2026104', '02/10/2026sem dadosem dado', '01/10/202652'])
  })

  it('pelo teclado, as setas percorrem os dias e anunciam os valores', () => {
    desenhar()
    const grupo = screen.getByRole('group', { name: /setas/ })
    fireEvent.focus(grupo)
    fireEvent.keyDown(grupo, { key: 'ArrowLeft' })
    expect(grupo.querySelector('[aria-live]')?.textContent).toBe('02/10/2026. Sessões: sem dado; Sessões engajadas: sem dado.')
    fireEvent.keyDown(grupo, { key: 'Home' })
    expect(grupo.querySelector('[aria-live]')?.textContent).toBe('01/10/2026. Sessões: 5 sessões; Sessões engajadas: 2 sessões.')
  })

  it('reserva a altura final antes de medir (sem salto de layout)', () => {
    desenhar()
    expect(screen.getByRole('group', { name: /setas/ }).style.height).toBe('220px')
  })

  it('a lacuna interrompe a linha (não desce a zero)', () => {
    const { container } = desenhar()
    const caminho = container.querySelector('path.stroke-serie-1')!.getAttribute('d')!
    expect(caminho.match(/M/g)).toHaveLength(2)
  })
})

describe('GraficoSemDado', () => {
  it('mostra o motivo, sem eixo, grade nem zero', () => {
    const { container } = render(<GraficoSemDado titulo="Cliques por dia" motivo="O Search Console ainda não liberou acesso." />)
    const g = screen.getByRole('group', { name: 'Cliques por dia' })
    expect(g.textContent).toContain('Sem dado')
    expect(g.textContent).toContain('ainda não liberou acesso')
    expect(container.querySelector('line, text')).toBeNull()
    expect(container.textContent).not.toMatch(/\b0\b/)
  })
})

describe('GraficoBarras', () => {
  it('é uma tabela: cada barra é uma linha com categoria e valor legíveis', () => {
    render(
      <GraficoBarras
        titulo="Problemas por severidade"
        rotuloCategoria="Severidade"
        rotuloValor="Problemas"
        itens={[
          { chave: 'critico', rotulo: 'Críticos', rotuloTexto: 'Críticos', valor: 12, detalhe: '11,5% dos problemas' },
          { chave: 'info', rotulo: 'Informativos', rotuloTexto: 'Informativos', valor: 0 },
        ]}
      />,
    )
    const tabela = screen.getByRole('table', { name: 'Problemas por severidade' })
    const linhas = within(tabela).getAllByRole('row')
    expect(within(linhas[1]).getByRole('rowheader').textContent).toBe('Críticos')
    expect(linhas[1].textContent).toContain('12')
    // Linhas não são paradas de tabulação: o valor já está no texto da célula.
    expect(linhas[1].hasAttribute('tabindex')).toBe(false)
    // Zero real (a auditoria contou) aparece como 0, com um traço no lugar da barra.
    expect(linhas[2].textContent).toContain('0')
  })
})
