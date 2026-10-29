import { describe, expect, it } from 'vitest'
import {
  inicioDoDiaBrasilia,
  MAX_REATIVACAO_POR_DIA,
  podeEntrar,
  validarLigarProspeccao,
  vagasHoje,
  type ContatoParaRegra,
  type FunilParaRegra,
  type SlugFunil,
} from '../funis-regras'

const AGORA = new Date('2026-10-29T15:00:00Z')
const DIA = 86_400_000

const funil = (slug: SlugFunil, extra: Partial<FunilParaRegra> = {}): FunilParaRegra => ({
  slug,
  ativo: true,
  tetoDiario: null,
  exigeBaseLegal: slug === 'prospeccao-fria' ? 'legitimo_interesse' : null,
  checklistLgpdEm: slug === 'prospeccao-fria' ? AGORA : null,
  ...(slug === 'prospeccao-fria' ? { tetoDiario: 10 } : {}),
  ...extra,
})
const contato = (extra: Partial<ContatoParaRegra> = {}): ContatoParaRegra => ({
  status: 'lead',
  baseLegal: 'consentimento',
  origem: 'site',
  ultimaInteracaoEm: AGORA,
  ...extra,
})
const ctx = (caminho: 'site' | 'manual' | 'cron', inscritosHoje = 0) => ({ caminho, agora: AGORA, inscritosHoje })

describe('podeEntrar', () => {
  it('descadastrado nunca entra em nenhum funil, por nenhum caminho', () => {
    for (const slug of ['boas-vindas', 'nutricao-blog', 'reativacao', 'prospeccao-fria'] as const) {
      for (const c of ['site', 'manual', 'cron'] as const) {
        const r = podeEntrar(funil(slug), contato({ status: 'descadastrado', baseLegal: 'legitimo_interesse' }), ctx(c))
        expect(r).toEqual({ ok: false, motivo: 'descadastrado' })
      }
    }
  })

  it('funil desligado não recebe ninguém', () => {
    expect(podeEntrar(funil('boas-vindas', { ativo: false }), contato(), ctx('site'))).toEqual({ ok: false, motivo: 'funil_inativo' })
  })

  describe('boas-vindas', () => {
    it('lead do formulário do site entra', () => {
      expect(podeEntrar(funil('boas-vindas'), contato(), ctx('site'))).toEqual({ ok: true })
    })
    it('pela tela, só contato de origem site', () => {
      expect(podeEntrar(funil('boas-vindas'), contato({ origem: 'site' }), ctx('manual')).ok).toBe(true)
      expect(podeEntrar(funil('boas-vindas'), contato({ origem: 'planilha' }), ctx('manual'))).toEqual({ ok: false, motivo: 'caminho_nao_permitido' })
    })
    it('cliente que preenche o formulário não recebe boas-vindas; rotina diária não inscreve', () => {
      expect(podeEntrar(funil('boas-vindas'), contato({ status: 'cliente' }), ctx('site'))).toEqual({ ok: false, motivo: 'status' })
      expect(podeEntrar(funil('boas-vindas'), contato(), ctx('cron'))).toEqual({ ok: false, motivo: 'caminho_nao_permitido' })
    })
  })

  describe('nutricao-blog', () => {
    it('lead ou cliente com consentimento ou contrato, pela tela', () => {
      expect(podeEntrar(funil('nutricao-blog'), contato({ baseLegal: 'consentimento' }), ctx('manual')).ok).toBe(true)
      expect(podeEntrar(funil('nutricao-blog'), contato({ status: 'cliente', baseLegal: 'contrato', origem: 'planilha' }), ctx('manual')).ok).toBe(true)
    })
    it('legítimo interesse não entra; inativo não entra; site e rotina não inscrevem', () => {
      expect(podeEntrar(funil('nutricao-blog'), contato({ baseLegal: 'legitimo_interesse' }), ctx('manual'))).toEqual({ ok: false, motivo: 'base_legal' })
      expect(podeEntrar(funil('nutricao-blog'), contato({ status: 'inativo' }), ctx('manual'))).toEqual({ ok: false, motivo: 'status' })
      expect(podeEntrar(funil('nutricao-blog'), contato(), ctx('site'))).toEqual({ ok: false, motivo: 'caminho_nao_permitido' })
      expect(podeEntrar(funil('nutricao-blog'), contato(), ctx('cron'))).toEqual({ ok: false, motivo: 'caminho_nao_permitido' })
    })
  })

  describe('reativacao', () => {
    const cliente = (dias: number) => contato({ status: 'cliente', baseLegal: 'contrato', ultimaInteracaoEm: new Date(AGORA.getTime() - dias * DIA) })
    it('cliente sem interação há 180 dias entra pela rotina; 179 dias não', () => {
      expect(podeEntrar(funil('reativacao'), cliente(180), ctx('cron'))).toEqual({ ok: true })
      expect(podeEntrar(funil('reativacao'), cliente(179), ctx('cron'))).toEqual({ ok: false, motivo: 'sem_interacao_recente_exigida' })
    })
    it('só clientes', () => {
      expect(podeEntrar(funil('reativacao'), contato({ status: 'lead', ultimaInteracaoEm: new Date(0) }), ctx('cron'))).toEqual({ ok: false, motivo: 'status' })
    })
    it(`no máximo ${MAX_REATIVACAO_POR_DIA} por dia pela rotina`, () => {
      expect(podeEntrar(funil('reativacao'), cliente(400), ctx('cron', MAX_REATIVACAO_POR_DIA - 1)).ok).toBe(true)
      expect(podeEntrar(funil('reativacao'), cliente(400), ctx('cron', MAX_REATIVACAO_POR_DIA))).toEqual({ ok: false, motivo: 'teto_diario' })
    })
    it('pela tela, qualquer cliente (sem a regra dos 180 dias)', () => {
      expect(podeEntrar(funil('reativacao'), cliente(1), ctx('manual')).ok).toBe(true)
    })
  })

  describe('prospeccao-fria', () => {
    const frio = (extra: Partial<ContatoParaRegra> = {}) => contato({ baseLegal: 'legitimo_interesse', origem: 'planilha', ...extra })
    it('lead com legítimo interesse entra quando ligada, com checklist e teto', () => {
      expect(podeEntrar(funil('prospeccao-fria'), frio(), ctx('cron'))).toEqual({ ok: true })
    })
    it('desligada por padrão: ninguém entra', () => {
      expect(podeEntrar(funil('prospeccao-fria', { ativo: false }), frio(), ctx('cron'))).toEqual({ ok: false, motivo: 'funil_inativo' })
    })
    it('outra base legal ou outro status não entra', () => {
      expect(podeEntrar(funil('prospeccao-fria'), frio({ baseLegal: 'consentimento' }), ctx('manual'))).toEqual({ ok: false, motivo: 'base_legal' })
      expect(podeEntrar(funil('prospeccao-fria'), frio({ status: 'cliente' }), ctx('manual'))).toEqual({ ok: false, motivo: 'status' })
    })
    it('sem checklist ou sem teto não entra, mesmo ligada', () => {
      expect(podeEntrar(funil('prospeccao-fria', { checklistLgpdEm: null }), frio(), ctx('cron'))).toEqual({ ok: false, motivo: 'checklist_lgpd' })
      expect(podeEntrar(funil('prospeccao-fria', { tetoDiario: null }), frio(), ctx('cron'))).toEqual({ ok: false, motivo: 'checklist_lgpd' })
    })
    it('teto diário vale para a rotina e para a tela', () => {
      expect(podeEntrar(funil('prospeccao-fria', { tetoDiario: 3 }), frio(), ctx('cron', 2)).ok).toBe(true)
      expect(podeEntrar(funil('prospeccao-fria', { tetoDiario: 3 }), frio(), ctx('cron', 3))).toEqual({ ok: false, motivo: 'teto_diario' })
      expect(podeEntrar(funil('prospeccao-fria', { tetoDiario: 3 }), frio(), ctx('manual', 3))).toEqual({ ok: false, motivo: 'teto_diario' })
    })
  })
})

describe('auxiliares', () => {
  it('início do dia em Brasília', () => {
    expect(inicioDoDiaBrasilia(new Date('2026-10-29T15:00:00Z')).toISOString()).toBe('2026-10-29T03:00:00.000Z')
    // 01:00 UTC ainda é dia 28 em Brasília.
    expect(inicioDoDiaBrasilia(new Date('2026-10-29T01:00:00Z')).toISOString()).toBe('2026-10-28T03:00:00.000Z')
  })
  it('vagas', () => {
    expect(vagasHoje(null, 10)).toBe(Infinity)
    expect(vagasHoje(5, 3)).toBe(2)
    expect(vagasHoje(5, 9)).toBe(0)
  })
  it('ligar a prospecção exige os três itens e teto entre 1 e 200', () => {
    const tudo = { avaliacaoLegitimoInteresse: true, descadastroEmTodoEmail: true, volumeBaixoAquecido: true }
    expect(validarLigarProspeccao(tudo, 20)).toEqual({ ok: true, teto: 20 })
    expect(validarLigarProspeccao({ ...tudo, volumeBaixoAquecido: false }, 20)).toEqual({ ok: false, motivo: 'checklist' })
    expect(validarLigarProspeccao(tudo, null)).toEqual({ ok: false, motivo: 'teto' })
    expect(validarLigarProspeccao(tudo, 0)).toEqual({ ok: false, motivo: 'teto' })
    expect(validarLigarProspeccao(tudo, 201)).toEqual({ ok: false, motivo: 'teto' })
    expect(validarLigarProspeccao(tudo, 2.5)).toEqual({ ok: false, motivo: 'teto' })
  })
})
