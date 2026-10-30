import { tratarWebhookResend } from '@/lib/crm/webhook-resend'

export const runtime = 'nodejs'

/** Eventos do Resend. Público no proxy: a assinatura Svix é a única barreira. */
export async function POST(request: Request) {
  try {
    return await tratarWebhookResend(request)
  } catch (e) {
    // Falha do banco, não da entrada: 500 faz o Resend tentar de novo (a dedupe evita duplicata).
    console.error('webhook resend: falhou:', e instanceof Error ? e.name : 'erro')
    return Response.json({ erro: 'Falha interna; tente de novo' }, { status: 500 })
  }
}
