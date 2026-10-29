/**
 * Estado de cada fonte da rotina diária (tabela `sincronizacoes`) traduzido para a tela.
 * Puro: o carregamento fica em `carregar.ts`.
 */

export type RegistroSincronizacao = {
  fonte: string
  status: string
  mensagem: string | null
  executadoEm: Date
  linhas: number | null
}

/** `nunca` = a rotina ainda não registrou esta fonte. Status desconhecido conta como erro. */
export type EstadoFonte = 'ok' | 'sem_permissao' | 'nao_configurado' | 'erro' | 'nunca'

export function estadoFonte(r: RegistroSincronizacao | null | undefined): EstadoFonte {
  if (!r) return 'nunca'
  if (r.status === 'ok' || r.status === 'sem_permissao' || r.status === 'nao_configurado' || r.status === 'erro') {
    return r.status
  }
  return 'erro'
}

/** Quando a fonte sincronizou com sucesso pela última vez (só se o último registro é `ok`). */
export function ultimaSincronizacaoOk(r: RegistroSincronizacao | null | undefined): Date | null {
  return r && estadoFonte(r) === 'ok' ? r.executadoEm : null
}

/** Conta de serviço que precisa de acesso ao Search Console (não é segredo: é um e-mail). */
export const EMAIL_CONTA_SERVICO_PADRAO = 'painel-seo-og@og-painel-seo.iam.gserviceaccount.com'

export function emailContaServico(env: Record<string, string | undefined> = process.env): string {
  const e = env.GOOGLE_SA_EMAIL?.trim()
  return e && /^[^\s@]+@[^\s@]+$/.test(e) ? e : EMAIL_CONTA_SERVICO_PADRAO
}

const formatoDataHora = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
})

export function formatarDataHora(d: Date): string {
  return formatoDataHora.format(d)
}

const ROTULO_ESTADO: Record<EstadoFonte, string> = {
  ok: 'concluída',
  sem_permissao: 'sem permissão de acesso',
  nao_configurado: 'fonte não configurada',
  erro: 'falhou',
  nunca: 'ainda não executada',
}

/** "Última sincronização: 29/10/2026, 03:37 · concluída · 151 linhas". */
export function linhaUltimaSincronizacao(r: RegistroSincronizacao | null | undefined): string {
  const estado = estadoFonte(r)
  if (!r) return 'Última sincronização: ainda não executada.'
  const linhas = estado === 'ok' && typeof r.linhas === 'number' ? ` · ${r.linhas.toLocaleString('pt-BR')} linhas` : ''
  return `Última sincronização: ${formatarDataHora(r.executadoEm)} · ${ROTULO_ESTADO[estado]}${linhas}.`
}

export type ExplicacaoGsc = {
  tipo: 'alerta' | 'erro' | 'info'
  titulo: string
  /** O que aconteceu e o que fazer, em pt-BR simples. */
  texto: string
  /** E-mail a liberar, quando a ação é dar acesso. */
  email?: string
}

/**
 * Por que o Search Console não tem dado (ou está parado), dito com a causa quando a
 * sabemos — nunca um "sem dado" seco. Null quando está tudo certo.
 */
export function explicarSearchConsole(
  r: RegistroSincronizacao | null | undefined,
  temDados: boolean,
  email: string = EMAIL_CONTA_SERVICO_PADRAO,
): ExplicacaoGsc | null {
  const estado = estadoFonte(r)
  const quando = r ? ` (última tentativa em ${formatarDataHora(r.executadoEm)})` : ''
  const sobreDados = temDados
    ? ' Os números abaixo são da última sincronização que deu certo.'
    : ' Enquanto isso, não há cliques, impressões nem oportunidades para mostrar.'
  switch (estado) {
    case 'ok':
      return null
    case 'sem_permissao':
      return {
        tipo: 'alerta',
        titulo: 'O Search Console ainda não liberou acesso ao painel',
        texto:
          `O proprietário da propriedade no Search Console precisa adicionar a conta abaixo como usuário com permissão Restrita ` +
          `(Configurações → Usuários e permissões → Adicionar usuário). A sincronização volta a funcionar sozinha na rotina diária seguinte${quando}.${sobreDados}`,
        email,
      }
    case 'nao_configurado':
      return {
        tipo: 'info',
        titulo: 'Search Console não conectado neste ambiente',
        texto: `As credenciais do Google não estão configuradas aqui${quando}.${sobreDados}`,
      }
    case 'erro':
      return {
        tipo: 'erro',
        titulo: 'A última sincronização do Search Console falhou',
        texto: `A rotina diária tenta de novo automaticamente; se continuar falhando, veja os logs do servidor${quando}.${sobreDados}`,
      }
    case 'nunca':
      return temDados
        ? null
        : {
            tipo: 'info',
            titulo: 'Search Console ainda não sincronizado',
            texto: 'A rotina diária ainda não rodou para o Search Console. Os dados aparecem depois da primeira sincronização.',
          }
  }
}
