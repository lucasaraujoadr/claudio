import { createHash, timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import {
  buscarSearchAnalytics,
  executarCronGsc,
  gravarSnapshots,
  removerSnapshotsAntigos,
} from '@/lib/gsc'

export const maxDuration = 60

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
  const ausentes = ['GOOGLE_SA_EMAIL', 'GOOGLE_SA_PRIVATE_KEY', 'GSC_PROPERTY'].filter(
    (nome) => !process.env[nome],
  )
  if (ausentes.length > 0) {
    return NextResponse.json(
      { erro: `Variáveis de ambiente ausentes: ${ausentes.join(', ')}` },
      { status: 500 },
    )
  }
  try {
    const resultado = await executarCronGsc({
      hoje: new Date(),
      property: process.env.GSC_PROPERTY as string,
      buscar: buscarSearchAnalytics,
      gravar: gravarSnapshots,
      reter: removerSnapshotsAntigos,
    })
    return NextResponse.json(resultado)
  } catch (e) {
    // Só o nome da classe: a mensagem pode ecoar credenciais.
    console.error('cron gsc falhou:', e instanceof Error ? e.name : 'erro')
    // Sem detalhes: a mensagem de erro de bibliotecas pode ecoar credenciais.
    return NextResponse.json({ erro: 'Falha ao sincronizar o Search Console' }, { status: 502 })
  }
}
