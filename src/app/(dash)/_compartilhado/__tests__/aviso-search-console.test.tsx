// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AvisoSearchConsole } from '../aviso-search-console'
import { explicarSearchConsole } from '../sincronizacao'

afterEach(cleanup)

describe('AvisoSearchConsole', () => {
  it('sem permissão: aviso com o passo a passo e o e-mail da conta de serviço', () => {
    const e = explicarSearchConsole(
      { fonte: 'gsc', status: 'sem_permissao', mensagem: null, executadoEm: new Date('2026-10-29T06:37:46Z'), linhas: null },
      false,
    )!
    render(<AvisoSearchConsole explicacao={e} />)
    const aviso = screen.getByRole('status')
    expect(aviso.textContent).toContain('O Search Console ainda não liberou acesso ao painel')
    expect(aviso.textContent).toContain('painel-seo-og@og-painel-seo.iam.gserviceaccount.com')
    expect(aviso.textContent).toContain('Restrita')
  })
})
