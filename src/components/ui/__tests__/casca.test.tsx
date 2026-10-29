// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

let caminho = '/'
vi.mock('next/navigation', () => ({ usePathname: () => caminho }))

const { Casca } = await import('../casca')
const { NAVEGACAO, itemAtivo } = await import('../navegacao')

afterEach(cleanup)

function desenhar(pathname: string) {
  caminho = pathname
  return render(<Casca logo={<span>logo</span>} logoCompacto={<span>logo</span>} />)
}

describe('itemAtivo', () => {
  it('raiz só casa com a raiz; demais casam com subrotas, sem prefixo falso', () => {
    expect(itemAtivo('/', '/')).toBe(true)
    expect(itemAtivo('/temas', '/')).toBe(false)
    expect(itemAtivo('/temas', '/temas')).toBe(true)
    expect(itemAtivo('/temas/42', '/temas')).toBe(true)
    expect(itemAtivo('/temasx', '/temas')).toBe(false)
  })
})

describe('navegação', () => {
  it('tem os grupos e itens pedidos, na ordem', () => {
    expect(NAVEGACAO.map((g) => g.titulo ?? '')).toEqual(['', 'SEO', 'Dados', 'CRM'])
    expect(NAVEGACAO.flatMap((g) => g.itens.map((i) => i.rotulo))).toEqual([
      'Visão geral', 'Oportunidades', 'Temas', 'Briefings', 'Tendências', 'Auditoria', 'Tráfego', 'Contatos', 'Funis', 'Importar',
    ])
  })

  it('telas que não existem são "em breve" e não são links', () => {
    desenhar('/')
    const lateral = screen.getAllByRole('navigation', { name: 'Módulos' }).at(-1)!
    for (const rotulo of ['Tendências', 'Tráfego', 'Contatos', 'Funis', 'Importar']) {
      expect(within(lateral).queryByRole('link', { name: new RegExp(rotulo) })).toBeNull()
      const item = within(lateral).getByText(rotulo).closest('[aria-disabled="true"]')
      expect(item?.textContent).toContain('em breve')
    }
    const hrefs = within(lateral).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/', '/oportunidades', '/temas', '/briefings', '/auditoria'])
  })

  it('marca o item ativo com aria-current', () => {
    desenhar('/temas')
    const lateral = screen.getAllByRole('navigation', { name: 'Módulos' }).at(-1)!
    expect(within(lateral).getByRole('link', { name: 'Temas' }).getAttribute('aria-current')).toBe('page')
    expect(within(lateral).getByRole('link', { name: 'Visão geral' }).getAttribute('aria-current')).toBeNull()
  })

  it('no celular, o menu abre, fecha com Esc e ao navegar', () => {
    desenhar('/')
    const botao = screen.getByRole('button', { name: 'Abrir menu' })
    const menu = document.getElementById(botao.getAttribute('aria-controls')!)!
    expect(menu.hidden).toBe(true)

    fireEvent.click(botao)
    expect(botao.getAttribute('aria-expanded')).toBe('true')
    expect(menu.hidden).toBe(false)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(menu.hidden).toBe(true)

    fireEvent.click(botao)
    fireEvent.click(within(menu).getByRole('link', { name: 'Temas' }))
    expect(menu.hidden).toBe(true)
  })

  it('tem o botão de sair (POST /api/logout) e a alternância de tema', () => {
    const { container } = desenhar('/')
    const forms = container.querySelectorAll('form[action="/api/logout"]')
    expect(forms.length).toBeGreaterThan(0)
    forms.forEach((f) => expect(f.getAttribute('method')).toBe('post'))
    expect(screen.getAllByRole('button', { name: /Mudar para o tema/ }).length).toBeGreaterThan(0)
  })
})
