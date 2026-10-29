import { normalizarKeyword } from '../keyword'
import { hostSite } from '../site'
import { contarVerificar, extrairPrimeiroParagrafo, extrairH2, contarLinksInternos } from './html'
import { slugValido, contarPalavras } from './formato'

export type ItemConferencia = { id: string; nivel: 'ok' | 'aviso' | 'bloqueia'; texto: string }

export type EntradaConferencia = {
  titulo: string
  slug: string
  metaDescription: string
  conteudoHtml: string
  keyword: string
  categoriaId: number | null
  capaMediaId: number | null
  revisado: boolean
  slugEmUso?: string | null
}

/** Lista de conferência de SEO. Pura: o mesmo artigo sempre gera a mesma lista. */
export function conferir(a: EntradaConferencia): ItemConferencia[] {
  const kw = normalizarKeyword(a.keyword ?? '')
  const tem = (texto: string) => kw !== '' && normalizarKeyword(texto).includes(kw)
  const titulo = (a.titulo ?? '').trim()
  const meta = (a.metaDescription ?? '').trim().length
  const verificar = contarVerificar(a.conteudoHtml)
  const links = contarLinksInternos(a.conteudoHtml, hostSite())
  const palavras = contarPalavras(a.conteudoHtml)
  const h2 = extrairH2(a.conteudoHtml)
  const h2Norm = h2.map(normalizarKeyword)
  const repetido = new Set(h2Norm).size < h2Norm.length

  const item = (id: string, falha: boolean, nivelFalha: 'aviso' | 'bloqueia', ok: string, ruim: string): ItemConferencia =>
    ({ id, nivel: falha ? nivelFalha : 'ok', texto: falha ? ruim : ok })

  let slugItem: ItemConferencia
  if (a.slugEmUso) {
    slugItem = { id: 'slug', nivel: 'bloqueia', texto: `Slug: endereço já usado em ${a.slugEmUso}.` }
  } else {
    slugItem = item('slug', !slugValido(a.slug ?? ''), 'bloqueia', 'Slug válido.',
      'Slug inválido: use só letras minúsculas, números e hífens.')
  }

  return [
    item('verificar', verificar > 0, 'bloqueia', 'Nenhum trecho marcado para verificar.',
      verificar === 1 ? '1 trecho ainda precisa ser verificado.' : `${verificar} trechos ainda precisam ser verificados.`),
    item('titulo_vazio', titulo === '', 'bloqueia', 'Título preenchido.', 'O título está vazio.'),
    slugItem,
    item('revisado', !a.revisado, 'bloqueia', 'Conteúdo revisado.', 'Marque "revisei o conteúdo" para publicar.'),
    item('kw_titulo', !tem(titulo), 'aviso', 'Palavra-chave no título.', 'A palavra-chave não está no título.'),
    item('kw_primeiro_paragrafo', !tem(extrairPrimeiroParagrafo(a.conteudoHtml)), 'aviso',
      'Palavra-chave no primeiro parágrafo.', 'A palavra-chave não está no primeiro parágrafo.'),
    item('kw_slug', kw === '' || !(a.slug ?? '').includes(kw.replace(/ /g, '-')), 'aviso',
      'Palavra-chave no slug.', 'A palavra-chave não está no slug.'),
    item('titulo_tamanho', titulo.length > 60, 'aviso', 'Título com até 60 caracteres.',
      `Título com ${titulo.length} caracteres: o ideal é até 60.`),
    item('meta_tamanho', meta < 120 || meta > 155, 'aviso', 'Descrição com tamanho ideal.',
      `Descrição com ${meta} caracteres: o ideal é de 120 a 155.`),
    item('links_internos', links < 2, 'aviso', 'Ao menos 2 links internos.',
      `${links} link(s) interno(s): o ideal é ter ao menos 2.`),
    item('palavras', palavras < 900, 'aviso', `Artigo com ${palavras} palavras.`,
      `Artigo com ${palavras} palavras: o ideal é de 1.200 a 2.000.`),
    item('h2', h2.length === 0, 'aviso', 'Artigo com subtítulos (H2).', 'O artigo não tem nenhum subtítulo (H2).'),
    item('h2_repetido', repetido, 'aviso', 'Subtítulos sem repetição.', 'Há subtítulos (H2) repetidos.'),
    item('capa', a.capaMediaId == null, 'aviso', 'Imagem de capa definida.', 'Sem imagem de capa.'),
    item('categoria', a.categoriaId == null, 'aviso', 'Categoria escolhida.', 'Sem categoria: o post irá para "Uncategorized".'),
  ]
}

export function podePublicar(itens: ItemConferencia[]): boolean {
  return !itens.some((i) => i.nivel === 'bloqueia')
}
