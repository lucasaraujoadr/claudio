import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { executarCronDiario, registrarSincronizacao, type ExecutorFonte } from '@/lib/cron-diario'
import { buscarGa4, executarGa4, transacaoGa4 } from '@/lib/ga4'
import { buscarSearchAnalytics, executarCronGsc, transacaoGsc } from '@/lib/gsc'

export const runtime = 'nodejs'
// Search Console (2 janelas paginadas) + GA4 (série de 90 dias e até 1 000 páginas) em sequência.
export const maxDuration = 120

function sha256(v: string): Buffer {
  return createHash('sha256').update(v).digest()
}

/** O proxy deixa /api/cron/* passar sem cookie: esta é a única barreira. Falha fechada. */
function autorizado(request: Request): boolean {
  const segredo = process.env.CRON_SECRET
  if (!segredo) return false
  const recebido = request.headers.get('authorization') ?? ''
  return timingSafeEqual(sha256(recebido), sha256(`Bearer ${segredo}`))
}

export async function GET(request: Request) {
  if (!autorizado(request)) {
    return NextResponse.json({ erro: 'Não autorizado' }, { status: 401 })
  }
  const hoje = new Date()
  const credenciais = Boolean(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY)
  const property = process.env.GSC_PROPERTY
  const propertyId = process.env.GA4_PROPERTY_ID

  const gsc: ExecutorFonte | null =
    credenciais && property
      ? async () => {
          const r = await executarCronGsc({ hoje, property, buscar: buscarSearchAnalytics, transacao: transacaoGsc })
          return {
            linhas: r.linhasGravadas,
            detalhes: { snapshot: r.snapshotDate, removidasRetencao: r.linhasRemovidasRetencao },
          }
        }
      : null
  const ga4: ExecutorFonte | null =
    credenciais && propertyId
      ? async () => {
          const r = await executarGa4({ hoje, propertyId, buscar: buscarGa4, transacao: transacaoGa4 })
          return { linhas: r.dias + r.paginas, detalhes: { dias: r.dias, paginas: r.paginas, snapshot: r.snapshotDate } }
        }
      : null

  const relatorio = await executarCronDiario({ hoje, gsc, ga4, registrar: registrarSincronizacao })
  return NextResponse.json(relatorio)
}
