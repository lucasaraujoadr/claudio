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

  it('telas que não existem são "em breve", não são links e são anunciadas como indisponíveis', () => {
    desenhar('/')
    const lateral = screen.getAllByRole('navigation', { name: 'Módulos' }).at(-1)!
    for (const rotulo of ['Funis']) {
      expect(within(lateral).queryByRole('link', { name: new RegExp(rotulo) })).toBeNull()
      const item = within(lateral).getByText(rotulo).closest('[data-indisponivel]')!
      expect(item.textContent).toContain('em breve')
      // O leitor de tela ouve "(indisponível)"; o selo visual fica oculto para ele.
      const sr = item.querySelector('.sr-only')
      expect(sr?.textContent).toContain('(indisponível)')
      expect(item.querySelector('[aria-hidden="true"]')?.textContent).toBe('em breve')
      expect(item.querySelector('[aria-disabled]')).toBeNull()
    }
    const hrefs = within(lateral).getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/', '/oportunidades', '/temas', '/briefings', '/tendencias', '/auditoria', '/trafego', '/crm/contatos', '/crm/importar'])
  })

  it('o selo "em breve" tem pelo menos 11 px (acima de 10 px)', () => {
    desenhar('/')
    const lateral = screen.getAllByRole('navigation', { name: 'Módulos' }).at(-1)!
    const selo = within(lateral).getAllByText('em breve')[0]
    expect(selo.className).toContain('text-[0.6875rem]')
    expect(selo.className).not.toContain('text-[0.625rem]')
  })

  it('Tráfego é um link ativo em /trafego', () => {
    desenhar('/trafego')
    const lateral = screen.getAllByRole('navigation', { name: 'Módulos' }).at(-1)!
    expect(within(lateral).getByRole('link', { name: 'Tráfego' }).getAttribute('aria-current')).toBe('page')
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
