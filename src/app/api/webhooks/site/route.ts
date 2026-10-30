import { after } from 'next/server'
import { acessoPublicoOk } from '@/lib/acesso-publico'
import { enviarBoasVindasAgora } from '@/lib/crm/envios-funil'
import { tratarWebhookSite } from '@/lib/crm/webhook-site'
import { configResend, criarClienteResend } from '@/lib/resend'

export const runtime = 'nodejs'

/**
 * Formulário do site (Elementor Forms → Webhook). Público no proxy: o token é a única barreira.
 * O Elementor recebe o 200 na hora; depois da resposta (`after`), o painel envia pelo Resend o
 * primeiro email da boas-vindas, se a chave existir e o painel tiver acesso público. O que não
 * sair aqui (falha, limite do dia) fica para a rotina diária.
 */
export async function POST(request: Request) {
  try {
    return await tratarWebhookSite(request, {
      depoisDeGravar: (contatoId) =>
        after(async () => {
          try {
            const cfg = configResend()
            if (!cfg) return
            await enviarBoasVindasAgora(contatoId, {
              cliente: criarClienteResend(cfg),
              agora: new Date(),
              acessoPublico: await acessoPublicoOk(),
            })
          } catch (e) {
            console.error('webhook site: envio imediato da boas-vindas falhou:', e instanceof Error ? e.name : 'erro')
          }
        }),
    })
  } catch (e) {
    console.error('webhook site: falhou:', e instanceof Error ? e.name : 'erro')
    return Response.json({ erro: 'Falha interna; tente de novo' }, { status: 500 })
  }
}
