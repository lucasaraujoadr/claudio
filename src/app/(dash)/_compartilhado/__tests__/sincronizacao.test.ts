import { describe, expect, it } from 'vitest'
import { seriesSearchConsole } from '../search-console'
import {
  EMAIL_CONTA_SERVICO_PADRAO,
  emailContaServico,
  estadoFonte,
  explicarSearchConsole,
  linhaUltimaSincronizacao,
  ultimaSincronizacaoOk,
  type RegistroSincronizacao,
} from '../sincronizacao'

const reg = (status: string, linhas: number | null = null): RegistroSincronizacao => ({
  fonte: 'gsc',
  status,
  mensagem: null,
  executadoEm: new Date('2026-10-29T06:37:46Z'),
  linhas,
})

describe('estadoFonte', () => {
  it('reconhece os quatro status; desconhecido é erro; ausente é nunca', () => {
    for (const s of ['ok', 'sem_permissao', 'nao_configurado', 'erro']) expect(estadoFonte(reg(s))).toBe(s)
    expect(estadoFonte(reg('???'))).toBe('erro')
    expect(estadoFonte(null)).toBe('nunca')
    expect(estadoFonte(undefined)).toBe('nunca')
  })

  it('última sincronização ok só quando o último registro é ok', () => {
    expect(ultimaSincronizacaoOk(reg('ok'))).toEqual(new Date('2026-10-29T06:37:46Z'))
    expect(ultimaSincronizacaoOk(reg('erro'))).toBeNull()
    expect(ultimaSincronizacaoOk(null)).toBeNull()
  })
})

describe('linhaUltimaSincronizacao', () => {
  it('data e hora de São Paulo, estado e linhas', () => {
    expect(linhaUltimaSincronizacao(reg('ok', 151))).toBe('Última sincronização: 29/10/2026, 03:37 · concluída · 151 linhas.')
    expect(linhaUltimaSincronizacao(reg('sem_permissao'))).toContain('sem permissão de acesso')
    expect(linhaUltimaSincronizacao(null)).toBe('Última sincronização: ainda não executada.')
  })
})

describe('explicarSearchConsole (nunca um "sem dado" seco quando sabemos a causa)', () => {
  it('sem permissão: diz quem precisa fazer o quê e qual conta adicionar como Restrito', () => {
    const e = explicarSearchConsole(reg('sem_permissao'), false)!
    expect(e.tipo).toBe('alerta')
    expect(e.texto).toMatch(/proprietário da propriedade/)
    expect(e.texto).toMatch(/Restrita/)
    expect(e.email).toBe('painel-seo-og@og-painel-seo.iam.gserviceaccount.com')
    expect(e.texto).toMatch(/não há cliques/)
  })

  it('com dados antigos, avisa que os números são da última sincronização boa', () => {
    expect(explicarSearchConsole(reg('erro'), true)!.texto).toMatch(/última sincronização que deu certo/)
  })

  it('ok: nada a explicar; nunca rodou sem dados: explica', () => {
    expect(explicarSearchConsole(reg('ok'), true)).toBeNull()
    expect(explicarSearchConsole(null, true)).toBeNull()
    expect(explicarSearchConsole(null, false)?.titulo).toMatch(/ainda não sincronizado/)
    expect(explicarSearchConsole(reg('nao_configurado'), false)?.tipo).toBe('info')
  })

  it('e-mail da conta de serviço: do ambiente quando válido, senão o padrão', () => {
    expect(emailContaServico({ GOOGLE_SA_EMAIL: 'outra@proj.iam.gserviceaccount.com' })).toBe('outra@proj.iam.gserviceaccount.com')
    expect(emailContaServico({ GOOGLE_SA_EMAIL: '  ' })).toBe(EMAIL_CONTA_SERVICO_PADRAO)
    expect(emailContaServico({})).toBe(EMAIL_CONTA_SERVICO_PADRAO)
  })
})

describe('seriesSearchConsole', () => {
  it('sem linhas: null (o gráfico mostra "sem dado", não um eixo em zero)', () => {
    expect(seriesSearchConsole([])).toBeNull()
  })

  it('dia sem sincronização é lacuna (null); zero sincronizado continua zero', () => {
    const s = seriesSearchConsole([
      { data: '2026-10-03', cliques: 0, impressoes: 40 },
      { data: '2026-10-01', cliques: 5, impressoes: 100 },
    ])!
    expect(s.datas).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    expect(s.cliques.map((p) => p.valor)).toEqual([5, null, 0])
    expect(s.impressoes.map((p) => p.valor)).toEqual([100, null, 40])
  })
})
