import { after } from 'next/server'
import { criarClienteBrevo } from '@/lib/brevo'
import { enviarBoasVindasAgora } from '@/lib/crm/funis'
import { tratarWebhookSite } from '@/lib/crm/webhook-site'

export const runtime = 'nodejs'

/** Timeout de cada chamada ao Brevo no envio imediato; o que falhar fica para a rotina diária. */
const TIMEOUT_BREVO_IMEDIATO_MS = 5_000

/**
 * Formulário do site (Elementor Forms → Webhook). Público no proxy: o token é a única barreira.
 * O Elementor recebe o 200 na hora; depois da resposta (`after`), o lead vai ao Brevo e à
 * lista de boas-vindas, se a chave e a lista existirem.
 */
export async function POST(request: Request) {
  try {
    return await tratarWebhookSite(request, {
      depoisDeGravar: (contatoId) =>
        after(async () => {
          try {
            await enviarBoasVindasAgora(contatoId, { cliente: criarClienteBrevo({ timeoutMs: TIMEOUT_BREVO_IMEDIATO_MS }) })
          } catch (e) {
            console.error('webhook site: envio imediato às boas-vindas falhou:', e instanceof Error ? e.name : 'erro')
          }
        }),
    })
  } catch (e) {
    console.error('webhook site: falhou:', e instanceof Error ? e.name : 'erro')
    return Response.json({ erro: 'Falha interna; tente de novo' }, { status: 500 })
  }
}
