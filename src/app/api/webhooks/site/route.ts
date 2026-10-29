import { tratarWebhookSite } from '@/lib/crm/webhook-site'

export const runtime = 'nodejs'

/** Formulário do site (Elementor Forms → Webhook). Público no proxy: o token é a única barreira. */
export async function POST(request: Request) {
  try {
    return await tratarWebhookSite(request)
  } catch (e) {
    console.error('webhook site: falhou:', e instanceof Error ? e.name : 'erro')
    return Response.json({ erro: 'Falha interna; tente de novo' }, { status: 500 })
  }
}
