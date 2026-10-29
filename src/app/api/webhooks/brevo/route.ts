import { tratarWebhookBrevo } from '@/lib/crm/webhook-brevo'

export const runtime = 'nodejs'

/** Eventos do Brevo. Público no proxy: o token (`?token=`) é a única barreira. */
export async function POST(request: Request) {
  try {
    return await tratarWebhookBrevo(request)
  } catch (e) {
    // Falha do banco, não da entrada: 500 faz o Brevo tentar de novo (a dedupe evita duplicata).
    console.error('webhook brevo: falhou:', e instanceof Error ? e.name : 'erro')
    return Response.json({ erro: 'Falha interna; tente de novo' }, { status: 500 })
  }
}
