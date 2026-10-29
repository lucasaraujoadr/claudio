import { describe, expect, it } from 'vitest'
import {
  aplicarMarcadores,
  BLOCO_LGPD_PROSPECCAO,
  comporCampanhaBlog,
  DEFINICOES_FUNIS,
  duracaoSequenciaDias,
  EMAILS_FUNIS,
  linkComUtm,
  linkWhatsapp,
  LINHA_DESCADASTRO,
  marcadoresPendentes,
  passosAutomacao,
} from '../funis-conteudo'
import { SLUGS_FUNIS } from '../funis-regras'

describe('textos dos funis', () => {
  it('quatro funis definidos; só a prospecção fria nasce desligada', () => {
    expect(DEFINICOES_FUNIS.map((d) => d.slug)).toEqual([...SLUGS_FUNIS])
    expect(DEFINICOES_FUNIS.filter((d) => !d.ativoInicial).map((d) => d.slug)).toEqual(['prospeccao-fria'])
  })

  for (const slug of SLUGS_FUNIS) {
    describe(slug, () => {
      const emails = EMAILS_FUNIS[slug]
      it('três emails com assunto, pré-cabeçalho e corpo', () => {
        expect(emails).toHaveLength(3)
        for (const e of emails) {
          expect(e.assunto.length).toBeGreaterThan(5)
          expect(e.preCabecalho.length).toBeGreaterThan(5)
          expect(e.corpo.length).toBeGreaterThan(200)
        }
        expect(emails[0].esperarDias).toBe(0)
        expect(emails[1].esperarDias).toBeGreaterThan(0)
      })
      it('todo email tem descadastro e chamada para documentos ou WhatsApp', () => {
        for (const e of emails) {
          expect(e.corpo).toContain('{{ unsubscribe }}')
          expect(e.corpo).toContain(slug === 'prospeccao-fria' ? BLOCO_LGPD_PROSPECCAO : LINHA_DESCADASTRO)
          expect(e.corpo).toMatch(/\[link do WhatsApp\]|documentos/)
        }
      })
      it('sem promessa de resultado, sem números, leis ou decisões inventados', () => {
        for (const e of emails) {
          const t = `${e.assunto} ${e.preCabecalho} ${e.corpo}`
          expect(t).not.toMatch(/garant(imos|ia de) (ganho|êxito|resultado|vitória)/i)
          expect(t).not.toMatch(/\b(art\.|artigo \d|lei n|súmula|tema \d|stj|stf|tst)\b/i)
          expect(t).not.toMatch(/R\$|\d+ ?%|\d{2,} (clientes|processos|anos|casos)/)
          // Linguagem que um advogado leria como promessa ou como afirmação sobre ele.
          expect(t).not.toMatch(/resiste à impugnação|seu escritório atua|é público/i)
        }
      })
    })
  }

  it('prospecção fria: bloco de LGPD com base legal, fonte, apagar/parar e descadastro', () => {
    expect(BLOCO_LGPD_PROSPECCAO).toContain('legítimo interesse')
    expect(BLOCO_LGPD_PROSPECCAO).toContain('[fonte do contato]')
    expect(BLOCO_LGPD_PROSPECCAO).toMatch(/apagamos o seu cadastro/)
    expect(BLOCO_LGPD_PROSPECCAO).toMatch(/paramos de enviar/)
  })

  it('nutrição não diz que só envia com artigo novo antes dos emails fixos', () => {
    expect(EMAILS_FUNIS['nutricao-blog'][0].corpo).not.toContain('só quando há artigo novo')
  })

  it('duração da sequência: soma das esperas + 3; nutrição não conclui', () => {
    expect(duracaoSequenciaDias('boas-vindas')).toBe(0 + 3 + 7 + 3)
    expect(duracaoSequenciaDias('reativacao')).toBe(0 + 7 + 14 + 3)
    expect(duracaoSequenciaDias('nutricao-blog')).toBeNull()
  })

  it('marcadores: WHATSAPP_LINK substitui; pendentes listados sem repetir', () => {
    const corpo = EMAILS_FUNIS['prospeccao-fria'][0].corpo
    expect(marcadoresPendentes([corpo, corpo])).toEqual(['[link do WhatsApp]', '[fonte do contato]'])
    const resolvido = aplicarMarcadores(corpo, { whatsapp: 'https://wa.me/550000' })
    expect(resolvido).toContain('https://wa.me/550000')
    expect(marcadoresPendentes([resolvido])).toEqual(['[fonte do contato]'])
    expect(aplicarMarcadores(corpo, { whatsapp: null })).toBe(corpo)
    expect(linkWhatsapp({ WHATSAPP_LINK: 'javascript:alert(1)' })).toBeNull()
    expect(linkWhatsapp({ WHATSAPP_LINK: ' https://wa.me/55 ' })).toBe('https://wa.me/55')
    expect(linkWhatsapp({})).toBeNull()
  })

  it('passo a passo da reativação não promete reentrada que o código não faz', () => {
    const p = passosAutomacao('reativacao', 'L').join('\n')
    expect(p).toContain('concluiu a sequência há mais de 180 dias')
    expect(p).toContain('nunca quem foi removido à mão')
    expect(passosAutomacao('boas-vindas', 'L').join('\n')).toContain('envie um email de teste')
  })

  it('passo a passo cita a lista e os atrasos', () => {
    const p = passosAutomacao('boas-vindas', 'Painel OG — Boas-vindas')
    expect(p.join('\n')).toContain('Contato adicionado a uma lista" → escolha a lista "Painel OG — Boas-vindas"')
    expect(p.filter((x) => x.startsWith('Adicione um atraso'))).toHaveLength(2)
    expect(p.filter((x) => x.startsWith('Enviar email'))).toHaveLength(3)
  })
})

describe('comporCampanhaBlog', () => {
  const base = {
    topicId: 12,
    titulo: 'Liquidação de sentença trabalhista',
    keyword: 'liquidação de sentença',
    urlPublicada: 'https://ogpericiacontabil.com.br/blog/liquidacao/',
  }

  it('usa o título e a descrição do briefing, com link com UTM', () => {
    const c = comporCampanhaBlog({ ...base, briefing: { title: 'Como funciona a liquidação', metaDescription: 'Entenda as etapas.' } })
    expect(c.assunto).toBe('Novo artigo: Como funciona a liquidação')
    expect(c.preCabecalho).toBe('Entenda as etapas.')
    expect(c.link).toBe('https://ogpericiacontabil.com.br/blog/liquidacao/?utm_source=brevo&utm_medium=email&utm_campaign=nutricao-blog-tema-12')
    expect(c.texto).toContain(c.link)
    expect(c.texto).toContain('{{ unsubscribe }}')
    expect(c.html).toContain(`href="${c.link.replace(/&/g, '&amp;')}"`)
    expect(c.html).toContain('href="{{ unsubscribe }}"')
  })

  it('sem briefing, usa o título do tema e uma frase neutra', () => {
    const c = comporCampanhaBlog({ ...base, briefing: null })
    expect(c.assunto).toBe('Novo artigo: Liquidação de sentença trabalhista')
    expect(c.preCabecalho).toBe('Publicamos um artigo novo sobre liquidação de sentença.')
  })

  it('escapa HTML do título e do resumo', () => {
    const c = comporCampanhaBlog({ ...base, briefing: { title: 'A <b>x</b> & "y"', metaDescription: '<script>' } })
    expect(c.html).toContain('A &lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot;')
    expect(c.html).not.toContain('<script>')
  })

  it('mantém parâmetros da URL publicada', () => {
    expect(linkComUtm('https://ogpericiacontabil.com.br/a?p=1', 3)).toBe(
      'https://ogpericiacontabil.com.br/a?p=1&utm_source=brevo&utm_medium=email&utm_campaign=nutricao-blog-tema-3',
    )
  })
})
