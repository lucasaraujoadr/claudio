import { describe, it, expect } from 'vitest'
import {
  sanitizarHtml, removerVerificar, contarVerificar, paraGutenberg,
  extrairPrimeiroParagrafo, extrairH2, contarLinksInternos,
} from '../html'

describe('sanitizarHtml', () => {
  it('remove <script>alert(1)</script> inteiro', () => {
    expect(sanitizarHtml('<p>a</p><script>alert(1)</script>')).toBe('<p>a</p>')
  })
  it('remove onerror e <img>', () => {
    expect(sanitizarHtml('<p onclick="x()">oi<img src=x onerror=alert(1)></p>')).toBe('<p>oi</p>')
  })
  it('a com javascript: vira texto', () => {
    expect(sanitizarHtml('<p><a href="javascript:alert(1)">clique</a></p>')).toBe('<p>clique</p>')
    expect(sanitizarHtml('<p><a href="java&#10;script:alert(1)">x</a></p>')).toBe('<p>x</p>')
    expect(sanitizarHtml('<p><a href="data:text/html,x">y</a></p>')).toBe('<p>y</p>')
  })
  it('mantém a http/https e âncora, só href', () => {
    expect(sanitizarHtml('<p><a href="https://a.com/x?a=1&b=2" target="_blank" onclick="x">l</a> <a href="#topo">t</a></p>')).toBe(
      '<p><a href="https://a.com/x?a=1&amp;b=2">l</a> <a href="#topo">t</a></p>',
    )
  })
  it('preserva texto de <span style> do Word', () => {
    expect(sanitizarHtml('<p><span style="mso-x:1">Texto <o:p></o:p>Word</span></p>')).toBe('<p>Texto Word</p>')
  })
  it('b→strong, i→em, h1→h2, h4→h3, div→p', () => {
    expect(sanitizarHtml('<h1>a</h1><h4>b</h4><h6>c</h6><div><b>x</b><i>y</i></div>')).toBe(
      '<h2>a</h2><h3>b</h3><h3>c</h3><p><strong>x</strong><em>y</em></p>',
    )
  })
  it('mantém data-verificar só em mark', () => {
    expect(sanitizarHtml('<p data-verificar="x"><mark data-verificar="a&quot;b" class="c">t</mark></p>')).toBe(
      '<p><mark data-verificar="a&quot;b">t</mark></p>',
    )
  })
  it('descarta style, iframe, object, embed, noscript, template com conteúdo', () => {
    expect(sanitizarHtml('<style>p{}</style><iframe>x</iframe><object>y</object><embed><noscript>n</noscript><template>t</template><p>ok</p>')).toBe('<p>ok</p>')
  })
  it('escapa texto, remove comentários, mantém br e listas', () => {
    expect(sanitizarHtml('<!-- c --><ul><li>a &lt;b&gt;<br></li></ul>')).toBe('<ul><li>a &lt;b&gt;<br></li></ul>')
  })
})

describe('verificar', () => {
  const h = '<p>a <mark data-verificar="x">b</mark> <mark data-verificar="y">c</mark></p>'
  it('removerVerificar mantém texto', () => {
    expect(removerVerificar(h)).toBe('<p>a b c</p>')
  })
  it('contarVerificar', () => {
    expect(contarVerificar(h)).toBe(2)
    expect(contarVerificar('<p>a</p>')).toBe(0)
  })
})

describe('paraGutenberg', () => {
  it('converte p/h2/h3/ul/ol/blockquote', () => {
    const h = '<p>a</p><h2>b</h2><h3>c</h3><ul><li>d</li><li>e</li></ul><ol><li>f</li></ol><blockquote><p>g</p></blockquote>'
    expect(paraGutenberg(h)).toBe(
      [
        '<!-- wp:paragraph --><p>a</p><!-- /wp:paragraph -->',
        '<!-- wp:heading --><h2 class="wp-block-heading">b</h2><!-- /wp:heading -->',
        '<!-- wp:heading {"level":3} --><h3 class="wp-block-heading">c</h3><!-- /wp:heading -->',
        '<!-- wp:list --><ul class="wp-block-list"><!-- wp:list-item --><li>d</li><!-- /wp:list-item --><!-- wp:list-item --><li>e</li><!-- /wp:list-item --></ul><!-- /wp:list -->',
        '<!-- wp:list {"ordered":true} --><ol class="wp-block-list"><!-- wp:list-item --><li>f</li><!-- /wp:list-item --></ol><!-- /wp:list -->',
        '<!-- wp:quote --><blockquote class="wp-block-quote"><!-- wp:paragraph --><p>g</p><!-- /wp:paragraph --></blockquote><!-- /wp:quote -->',
      ].join('\n\n'),
    )
  })
  it('texto solto vira wp:paragraph', () => {
    expect(paraGutenberg('solto <strong>x</strong><h2>t</h2>')).toBe(
      '<!-- wp:paragraph --><p>solto <strong>x</strong></p><!-- /wp:paragraph -->\n\n' +
        '<!-- wp:heading --><h2 class="wp-block-heading">t</h2><!-- /wp:heading -->',
    )
  })
  it('vazio', () => {
    expect(paraGutenberg('')).toBe('')
  })
})

describe('extratores', () => {
  const h = '<h2>Um</h2><p>Primeiro <strong>par</strong></p><h2>Dois &amp; três</h2><p><a href="https://og.com.br/x">a</a> <a href="/y">b</a> <a href="https://outro.com/z">c</a></p>'
  it('primeiro parágrafo como texto', () => {
    expect(extrairPrimeiroParagrafo(h)).toBe('Primeiro par')
  })
  it('h2', () => {
    expect(extrairH2(h)).toEqual(['Um', 'Dois & três'])
  })
  it('links internos', () => {
    expect(contarLinksInternos(h, 'og.com.br')).toBe(1)
    expect(contarLinksInternos(h, 'www.og.com.br')).toBe(1)
  })
})
