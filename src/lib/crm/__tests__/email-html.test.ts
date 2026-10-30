import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { montarEmail } from '../email-html'
import { BLOCO_LGPD_PROSPECCAO, EMAILS_FUNIS, marcadoresPendentes } from '../funis-conteudo'
import { SLUGS_FUNIS } from '../funis-regras'

const ORIGINAL = { ...process.env }
beforeEach(() => {
  process.env.URL_PUBLICA_PAINEL = 'https://painel.example.com/'
})
afterEach(() => {
  process.env = { ...ORIGINAL }
})

const URL_DESC = 'https://painel.example.com/descadastro?t=abc.def&x=1'
const ctx = { nome: 'Ana Souza', urlDescadastro: URL_DESC, whatsapp: null }

describe('montarEmail', () => {
  it('montarEmail escapa <script> no nome e remove a frase do WhatsApp sem link', () => {
    const e = EMAILS_FUNIS['boas-vindas'][0]
    const m = montarEmail(e, { ...ctx, nome: '<script>alert(1)</script> & "Cia"' })
    expect(m.html).not.toContain('<script>')
    expect(m.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Cia&quot;')
    expect(m.texto).toContain('<script>alert(1)</script>')
    for (const s of [m.html, m.texto]) {
      expect(s).not.toContain('[link do WhatsApp]')
      expect(s).not.toMatch(/WhatsApp/)
    }
    // A frase da chamada para documentos continua.
    expect(m.texto).toContain('Para enviar os documentos, basta responder a este email.')
  })

  it('sem link, corta só a alternativa do WhatsApp, não um "ou" anterior da frase', () => {
    const r = montarEmail(EMAILS_FUNIS.reativacao[0], ctx).texto
    expect(r).toContain('Se houver algum processo em que um cálculo precise ser feito ou revisado, responda a este email com os documentos.')
    const p = montarEmail(EMAILS_FUNIS['prospeccao-fria'][2], ctx).texto
    expect(p).toContain('precisar de cálculos judiciais ou de assistência técnica em perícia contábil, basta responder a este email.')
  })

  for (const slug of SLUGS_FUNIS) {
    it(`${slug}: sem link, nenhum email fica com WhatsApp nem pontuação quebrada; com link, o link entra`, () => {
      for (const e of EMAILS_FUNIS[slug]) {
        const sem = montarEmail(e, ctx)
        expect(sem.html).not.toMatch(/WhatsApp/)
        expect(sem.texto).not.toMatch(/WhatsApp/)
        expect(sem.texto).not.toMatch(/ \.|,\.|\.\.| ,|: \.|\s{3,}|  /)
        const com = montarEmail(e, { ...ctx, whatsapp: 'https://wa.me/5511999999999' })
        expect(com.texto).toContain('https://wa.me/5511999999999')
        expect(com.html).toContain('href="https://wa.me/5511999999999"')
        expect(marcadoresPendentes([com.texto]).filter((x) => x === '[link do WhatsApp]')).toEqual([])
      }
    })
  }

  it('marca: logo pela URL pública, dourado, largura 600, pré-cabeçalho e descadastro no rodapé', () => {
    const e = EMAILS_FUNIS.reativacao[1]
    const m = montarEmail(e, ctx)
    expect(m.assunto).toBe(e.assunto)
    expect(m.html).toContain('src="https://painel.example.com/logo-og.png"')
    expect(m.html).toContain('#DAA522')
    expect(m.html).toContain('width="600"')
    expect(m.html).toMatch(/<table/)
    expect(m.html).toContain(e.preCabecalho)
    expect(m.html).toContain('href="https://painel.example.com/descadastro?t=abc.def&amp;x=1"')
    expect(m.html).toContain('Você recebeu este email porque')
    expect(m.html).toContain('Oliveira Guimarães')
    expect(m.texto).toContain(URL_DESC)
    for (const s of [m.html, m.texto]) {
      expect(s).not.toContain('{{descadastro}}')
      expect(s).not.toContain('{{ unsubscribe }}')
    }
    expect(m.html).toContain('Prezado(a) Dr(a). Ana Souza,')
  })

  it('sem nome, mantém a saudação genérica', () => {
    const m = montarEmail(EMAILS_FUNIS['boas-vindas'][0], { ...ctx, nome: '  ' })
    expect(m.texto.startsWith('Prezado(a) Dr(a).,')).toBe(true)
  })

  it('prospecção fria mantém o bloco de LGPD no corpo, com o link de descadastro', () => {
    const m = montarEmail(EMAILS_FUNIS['prospeccao-fria'][0], ctx)
    expect(m.texto).toContain('com base no legítimo interesse previsto na LGPD')
    expect(m.texto).toContain(`Para não receber mais nenhum email: ${URL_DESC}`)
    expect(m.html).toContain('apagamos o seu cadastro')
    expect(BLOCO_LGPD_PROSPECCAO).toContain('{{descadastro}}')
  })
})
