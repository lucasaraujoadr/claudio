/**
 * Mapa da navegação do painel. Item sem `href` é tela que ainda não existe: aparece
 * desabilitado com "em breve", nunca como link quebrado. Quem criar a tela só precisa
 * preencher o `href` aqui.
 */
export type ItemNavegacao = {
  rotulo: string
  href?: string
}

export type GrupoNavegacao = {
  /** Sem título = grupo de topo (Visão geral). */
  titulo?: string
  itens: ItemNavegacao[]
}

export const NAVEGACAO: GrupoNavegacao[] = [
  { itens: [{ rotulo: 'Visão geral', href: '/' }] },
  {
    titulo: 'SEO',
    itens: [
      { rotulo: 'Oportunidades', href: '/oportunidades' },
      { rotulo: 'Temas', href: '/temas' },
      { rotulo: 'Briefings', href: '/briefings' },
      { rotulo: 'Tendências', href: '/tendencias' },
      { rotulo: 'Auditoria', href: '/auditoria' },
    ],
  },
  { titulo: 'Dados', itens: [{ rotulo: 'Tráfego', href: '/trafego' }] },
  {
    titulo: 'CRM',
    itens: [
      { rotulo: 'Contatos', href: '/crm/contatos' },
      { rotulo: 'Funis' },
      { rotulo: 'Importar', href: '/crm/importar' },
      { rotulo: 'Integração', href: '/crm/integracao' },
    ],
  },
]

/** `/` só casa com a raiz; os demais casam com a rota e suas subrotas (`/temas/123`). */
export function itemAtivo(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
