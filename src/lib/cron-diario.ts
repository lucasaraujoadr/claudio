import { getDb } from '@/lib/db'
import { sincronizacoes } from '@/lib/db/schema'

export type StatusFonte = 'ok' | 'nao_configurado' | 'sem_permissao' | 'erro'
export type FonteDiaria = 'gsc' | 'ga4'

export type RelatorioFonte = {
  status: StatusFonte
  /** Linhas gravadas (apenas em `ok`). */
  linhas?: number
  detalhes?: Record<string, number | string>
  /** Só a classe do erro, nunca a mensagem original. */
  erro?: string
  mensagem?: string
}
export type RelatorioDiario = Record<FonteDiaria, RelatorioFonte>

/** Uma fonte pronta para rodar; `null` = não configurada. */
export type ExecutorFonte = () => Promise<{ linhas: number; detalhes?: Record<string, number | string> }>

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
    return { status: 'ok', linhas: r.linhas, detalhes: r.detalhes }
  } catch (e) {
    // Mensagem só no log do servidor: nunca na resposta HTTP nem em `sincronizacoes`.
    console.error(
      `cron diario: ${fonte} falhou:`,
      e instanceof Error ? `${e.name}: ${e.message}` : 'erro',
    )
    return classificarErro(e)
  }
}

export async function executarCronDiario(d: {
  hoje: Date
  gsc: ExecutorFonte | null
  ga4: ExecutorFonte | null
  registrar: (r: RegistroSincronizacao) => Promise<void>
}): Promise<RelatorioDiario> {
  const fontes: [FonteDiaria, ExecutorFonte | null][] = [
    ['gsc', d.gsc],
    ['ga4', d.ga4],
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
