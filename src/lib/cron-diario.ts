import { getDb } from '@/lib/db'
import { sincronizacoes } from '@/lib/db/schema'

export type StatusFonte = 'ok' | 'nao_configurado' | 'sem_permissao' | 'erro'
export type FonteDiaria = 'gsc' | 'ga4' | 'funis' | 'artigos'

export type RelatorioFonte = {
  status: StatusFonte
  /** Linhas gravadas (apenas em `ok`). */
  linhas?: number
  detalhes?: Record<string, number | string>
  /** Só a classe do erro, nunca a mensagem original. */
  erro?: string
  mensagem?: string
}
export type RelatorioDiario = Record<'gsc' | 'ga4', RelatorioFonte> & { funis?: RelatorioFonte; artigos?: RelatorioFonte }

/** Uma fonte pronta para rodar; `null` = não configurada. `mensagem` não pode ter dado pessoal. */
export type ExecutorFonte = () => Promise<{
  linhas: number
  detalhes?: Record<string, number | string>
  mensagem?: string
  /** A fonte rodou o que podia sem a credencial: registra `nao_configurado` em vez de `ok`. */
  status?: 'nao_configurado'
}>

/** Erro que traz uma frase própria, já sem dado pessoal, para gravar em `sincronizacoes`. */
function mensagemSegura(e: unknown): string | null {
  if (typeof e !== 'object' || e === null || !('mensagemSegura' in e)) return null
  const m = (e as { mensagemSegura: unknown }).mensagemSegura
  return typeof m === 'string' ? m.slice(0, 500) : null
}

export type RegistroSincronizacao = {
  fonte: FonteDiaria
  status: StatusFonte
  mensagem: string | null
  executadoEm: Date
  linhas: number | null
}

const MSG_SEM_PERMISSAO = 'a conta de serviço ainda não tem acesso a esta propriedade'
const MSG_NAO_CONFIGURADO = 'fonte não configurada neste ambiente'
const MSG_ERRO = 'falha ao sincronizar; veja os logs do servidor'

function codigoHttp(e: unknown): number | undefined {
  if (typeof e !== 'object' || e === null) return undefined
  const o = e as { code?: unknown; status?: unknown; response?: { status?: unknown } }
  for (const c of [o.code, o.status, o.response?.status]) {
    const n = typeof c === 'string' ? Number(c) : c
    if (typeof n === 'number' && Number.isInteger(n)) return n
  }
  return undefined
}

/** Traduz um erro em status e frase fixa em pt-BR; nunca repassa a mensagem do Google. */
export function classificarErro(e: unknown): RelatorioFonte {
  const nome = e instanceof Error ? e.name : 'erro'
  const msg = e instanceof Error ? e.message : ''
  if (codigoHttp(e) === 403 && /permission|forbidden|not have access|insufficient/i.test(msg)) {
    return { status: 'sem_permissao', erro: nome, mensagem: MSG_SEM_PERMISSAO }
  }
  return { status: 'erro', erro: nome, mensagem: MSG_ERRO }
}

async function rodar(fonte: FonteDiaria, executor: ExecutorFonte | null): Promise<RelatorioFonte> {
  if (!executor) return { status: 'nao_configurado', mensagem: MSG_NAO_CONFIGURADO }
  try {
    const r = await executor()
    return { status: r.status ?? 'ok', linhas: r.linhas, detalhes: r.detalhes, ...(r.mensagem ? { mensagem: r.mensagem } : {}) }
  } catch (e) {
    // Mensagem só no log do servidor: nunca na resposta HTTP nem em `sincronizacoes`.
    // Nos funis, nem no log: um erro do banco pode ecoar dado de contato.
    console.error(
      `cron diario: ${fonte} falhou:`,
      e instanceof Error ? (fonte === 'funis' ? e.name : `${e.name}: ${e.message}`) : 'erro',
    )
    const c = classificarErro(e)
    const propria = mensagemSegura(e)
    return propria ? { ...c, mensagem: propria } : c
  }
}

export async function executarCronDiario(d: {
  hoje: Date
  gsc: ExecutorFonte | null
  ga4: ExecutorFonte | null
  /** Etapa dos funis do CRM (E9); ausente = não roda (testes antigos). */
  funis?: ExecutorFonte | null
  /** Sincronização dos artigos agendados no WordPress; ausente = não roda. */
  artigos?: ExecutorFonte | null
  registrar: (r: RegistroSincronizacao) => Promise<void>
}): Promise<RelatorioDiario> {
  const fontes: [FonteDiaria, ExecutorFonte | null][] = [
    ['gsc', d.gsc],
    ['ga4', d.ga4],
    ...(d.funis !== undefined ? [['funis', d.funis] as [FonteDiaria, ExecutorFonte | null]] : []),
    ...(d.artigos !== undefined ? [['artigos', d.artigos] as [FonteDiaria, ExecutorFonte | null]] : []),
  ]
  // Em paralelo: uma chamada do Google pendurada numa fonte não atrasa a outra.
  const resultados = await Promise.all(
    fontes.map(async ([fonte, executor]) => {
      const r = await rodar(fonte, executor)
      try {
        await d.registrar({
          fonte,
          status: r.status,
          mensagem: r.mensagem ?? null,
          executadoEm: d.hoje,
          linhas: r.linhas ?? null,
        })
      } catch (e) {
        // Falha ao registrar não pode derrubar a outra fonte.
        console.error(
          `sincronizacoes: falha ao registrar ${fonte}:`,
          e instanceof Error ? `${e.name}: ${e.message}` : 'erro',
        )
      }
      return [fonte, r] as const
    }),
  )
  const relatorio = Object.fromEntries(resultados) as RelatorioDiario
  return relatorio
}

export async function registrarSincronizacao(r: RegistroSincronizacao): Promise<void> {
  await getDb()
    .insert(sincronizacoes)
    .values(r)
    .onConflictDoUpdate({
      target: sincronizacoes.fonte,
      set: { status: r.status, mensagem: r.mensagem, executadoEm: r.executadoEm, linhas: r.linhas },
    })
}
