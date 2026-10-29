// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Aviso,
  Botao,
  BotaoEnviar,
  CabecalhoPagina,
  Cartao,
  EstadoVazio,
  Indicador,
  Selo,
  Tabela,
  formatarVariacao,
} from '..'

afterEach(cleanup)

describe('Indicador', () => {
  it('mostra o número formatado em pt-BR', () => {
    render(<Indicador rotulo="Cliques" valor={12345} />)
    expect(screen.getByText('12.345')).toBeTruthy()
  })

  it('zero de verdade aparece como 0', () => {
    const { container } = render(<Indicador rotulo="Cliques" valor={0} />)
    expect(container.textContent).toContain('0')
    expect(container.textContent).not.toMatch(/sem dado/)
  })

  it.each([null, undefined, Number.NaN, ''])('valor %s vira "sem dado" e nunca 0', (valor) => {
    const { container } = render(
      <Indicador rotulo="Cliques" valor={valor} variacao={{ delta: 0, percentual: 0 }} />,
    )
    expect(container.textContent).toMatch(/sem dado/)
    expect(container.textContent).not.toMatch(/\b0\b/)
    expect(container.querySelector('[data-sem-dado]')).not.toBeNull()
  })

  it('variação: sinal, percentual e sentido de melhora', () => {
    const { container } = render(
      <Indicador rotulo="Cliques" valor={120} variacao={{ delta: 20, percentual: 20 }} comparacao="vs. 28 dias antes" />,
    )
    expect(container.textContent).toContain('+20 (+20%)')
    expect(container.textContent).toContain('(melhora)')
    expect(container.textContent).toContain('vs. 28 dias antes')
  })

  it('menor-melhor inverte a leitura da variação', () => {
    const { container } = render(
      <Indicador rotulo="Erros" valor={5} sentido="menor-melhor" variacao={{ delta: 3, percentual: 150 }} />,
    )
    expect(container.textContent).toContain('(piora)')
  })

  it('variação null diz "sem comparação"', () => {
    const { container } = render(<Indicador rotulo="Cliques" valor={5} variacao={null} />)
    expect(container.textContent).toContain('sem comparação')
  })

  it('formatarVariacao lida com queda e sem base', () => {
    expect(formatarVariacao({ delta: -1500, percentual: -12.345 })).toBe('−1.500 (−12,3%)')
    expect(formatarVariacao({ delta: 7, percentual: null })).toBe('+7 (sem base de comparação)')
    expect(formatarVariacao({ delta: 0, percentual: 0 })).toBe('0 (0%)')
  })
})

describe('Selo', () => {
  it('traz texto, e ícone nos tons de status', () => {
    const { container } = render(<Selo variante="critico">Crítico</Selo>)
    expect(container.textContent).toBe('Crítico')
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it('neutro não tem ícone', () => {
    const { container } = render(<Selo>ideia</Selo>)
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('Tabela', () => {
  it('é uma região rolável nomeada e focável, com caption', () => {
    render(
      <Tabela legenda="Oportunidades abertas">
        <thead>
          <tr>
            <th scope="col">Termo</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>perícia trabalhista</td>
          </tr>
        </tbody>
      </Tabela>,
    )
    const regiao = screen.getByRole('region', { name: 'Oportunidades abertas' })
    expect(regiao.getAttribute('tabindex')).toBe('0')
    expect(regiao.className).toContain('overflow-x-auto')
    expect(within(regiao).getByRole('table', { name: 'Oportunidades abertas' })).toBeTruthy()
  })
})

describe('Aviso', () => {
  it('erro é anunciado como alert; info como status', () => {
    render(
      <>
        <Aviso tipo="erro" titulo="Falhou">Detalhe</Aviso>
        <Aviso tipo="info">Nota</Aviso>
      </>,
    )
    expect(screen.getByRole('alert').textContent).toContain('Falhou')
    expect(screen.getByRole('status').textContent).toContain('Nota')
  })

  it('role null deixa o aviso estático', () => {
    const { container } = render(<Aviso tipo="alerta" role={null}>Estático</Aviso>)
    expect(container.querySelector('[role]')).toBeNull()
  })
})

describe('EstadoVazio, Cartao, CabecalhoPagina', () => {
  it('EstadoVazio mostra título, explicação e ação', () => {
    render(<EstadoVazio titulo="Nenhuma auditoria ainda" explicacao="Rode a primeira." acao={<Botao>Rodar</Botao>} />)
    expect(screen.getByRole('heading', { name: 'Nenhuma auditoria ainda' })).toBeTruthy()
    expect(screen.getByText('Rode a primeira.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rodar' })).toBeTruthy()
  })

  it('Cartao com título vira seção rotulada', () => {
    render(<Cartao titulo="Search Console">corpo</Cartao>)
    expect(screen.getByRole('region', { name: 'Search Console' })).toBeTruthy()
  })

  it('CabecalhoPagina tem um h1 e as ações', () => {
    render(<CabecalhoPagina titulo="Temas" subtitulo="Pautas" secao="SEO" acoes={<Botao>Pesquisar</Botao>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Temas' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Pesquisar' })).toBeTruthy()
  })
})

describe('Botao', () => {
  it('padrão é type="button" e aceita variante', () => {
    render(<Botao variante="secundario">Ok</Botao>)
    const b = screen.getByRole('button', { name: 'Ok' }) as HTMLButtonElement
    expect(b.type).toBe('button')
    expect(b.className).toContain('border-borda-forte')
  })
})

describe('BotaoEnviar (sistema de design)', () => {
  function formulario() {
    render(
      <form method="POST" action="/api/temas/pesquisar" onSubmit={(e) => e.preventDefault()}>
        <BotaoEnviar rotuloEnviando="Gerando…">Pesquisar temas</BotaoEnviar>
      </form>,
    )
    return screen.getByRole('button') as HTMLButtonElement
  }

  it('desabilita e mostra "Gerando…" ao enviar; volta no bfcache', () => {
    const b = formulario()
    expect(b.textContent).toBe('Pesquisar temas')
    fireEvent.submit(b.closest('form')!)
    expect(b.disabled).toBe(true)
    expect(b.textContent).toBe('Gerando…')
    expect(b.getAttribute('aria-busy')).toBe('true')
    act(() => {
      const e = new Event('pageshow') as Event & { persisted: boolean }
      Object.defineProperty(e, 'persisted', { value: true })
      window.dispatchEvent(e)
    })
    expect(b.disabled).toBe(false)
  })

  it('não trava quando o formulário não é enviado', () => {
    const espiao = vi.fn()
    render(
      <form onSubmit={espiao}>
        <BotaoEnviar rotuloEnviando="Gerando…">Ir</BotaoEnviar>
      </form>,
    )
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false)
  })
})
