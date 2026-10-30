import type { ReactNode } from 'react'
import { connection } from 'next/server'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, Selo, type TipoAviso } from '@/components/ui'
import { estadoIntegracao, type EstadoIntegracao } from '@/lib/crm/sincronizar'
import { formatarQuando } from '../contatos/_compartilhado'
import { UrlSecreta } from './url-secreta'
import { LIMITE_POR_MINUTO } from '@/lib/crm/webhook-site'
import { urlPublicaPainel } from '@/lib/acesso-publico'
import { configResend } from '@/lib/resend'

export const metadata = { title: 'Integração' }

/** Domínio que envia os emails; o usuário o adiciona no Resend e copia os registros DNS para a Hostinger. */
const DOMINIO_REMETENTE = 'ogpericiacontabil.com.br'

/** Eventos a assinar no webhook do Resend (o `email.delivered` é ignorado pelo painel). */
const EVENTOS_WEBHOOK = ['email.opened', 'email.clicked', 'email.bounced', 'email.complained', 'contact.updated'] as const

/** Domínio do remetente configurado (`Nome <a@dominio>` ou `a@dominio`), ou `null`. */
function dominioDoRemetente(remetente: string | undefined): string | null {
  const m = remetente?.match(/@([^\s>]+)/)
  return m ? m[1].toLowerCase() : null
}

const AVISOS: Record<string, { texto: string; tipo: TipoAviso }> = {
  'sync-ok': { texto: 'Sincronização concluída: nada pendente.', tipo: 'sucesso' },
  'sync-parcial': { texto: 'Sincronização feita, mas ainda há contatos pendentes ou com erro. Veja o resumo abaixo.', tipo: 'alerta' },
  'sync-interrompida': { texto: 'A sincronização parou no meio. Veja a mensagem em "Última sincronização".', tipo: 'erro' },
  'nao-conectado': { texto: 'Resend não configurado: configure RESEND_API_KEY na Vercel e faça um novo deploy.', tipo: 'alerta' },
  erro: { texto: 'Algo falhou no servidor. Tente de novo em instantes.', tipo: 'erro' },
}

async function carregar(): Promise<EstadoIntegracao | null> {
  try {
    return await estadoIntegracao()
  } catch (e) {
    console.error('crm: estado da integração falhou:', e instanceof Error ? e.name : 'erro')
    return null
  }
}

function Execucao({ titulo, e }: { titulo: string; e: EstadoIntegracao['ultimoSync'] }) {
  return (
    <div>
      <dt className="text-xs font-medium text-tinta-suave">{titulo}</dt>
      <dd className="text-sm text-tinta">
        {e ? (
          <>
            <Selo variante={e.status === 'ok' ? 'sucesso' : e.status === 'parcial' ? 'aviso' : 'critico'}>
              {e.status === 'ok' ? 'ok' : e.status === 'parcial' ? 'parcial' : 'erro'}
            </Selo>{' '}
            {formatarQuando(e.executadoEm)}
            {e.mensagem && <span className="block text-xs text-tinta-suave">{e.mensagem}</span>}
          </>
        ) : (
          <span className="text-tinta-suave">Nunca executada</span>
        )}
      </dd>
    </div>
  )
}

function Passos({ itens }: { itens: ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-tinta">
      {itens.map((p, i) => <li key={i}>{p}</li>)}
    </ol>
  )
}

export default async function IntegracaoPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const sp = await searchParams
  const aviso = typeof sp.aviso === 'string' ? AVISOS[sp.aviso] : undefined
  const tokenSite = process.env.SITE_WEBHOOK_TOKEN?.trim() || null
  const estado = await carregar()
  const conectado = estado?.conectado ?? false
  const remetente = configResend()?.remetente
  const dominio = dominioDoRemetente(remetente)
  const urlPublica = urlPublicaPainel()
  const segredoWebhook = Boolean(process.env.RESEND_WEBHOOK_SECRET?.trim())

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CabecalhoPagina
        secao="CRM"
        titulo="Integração"
        subtitulo="Resend (envio dos emails) e formulário do site. O CRM continua sendo a fonte da verdade dos contatos."
      />

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <Cartao titulo="Resend" descricao="Contatos e segmento da newsletter (RESEND_API_KEY).">
        <div className="space-y-5">
          {conectado ? (
            <p className="text-sm text-tinta">
              <Selo variante="sucesso">Conectado</Selo> A chave do Resend está configurada. Domínio remetente: <strong>{dominio ?? DOMINIO_REMETENTE}</strong>.
            </p>
          ) : (
            <Aviso tipo="info" titulo="Resend não conectado" role={null}>
              O CRM funciona por completo sem o Resend: os contatos ficam como &quot;pendente&quot; e são sincronizados quando a chave for
              configurada (<code>RESEND_API_KEY</code> e <code>RESEND_REMETENTE</code> na Vercel, Production, e um novo deploy).
            </Aviso>
          )}

          {estado ? (
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-tinta-suave">Pendentes</dt>
                <dd className="font-titulo text-2xl font-semibold tabular-nums text-tinta">{estado.pendentes.toLocaleString('pt-BR')}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-tinta-suave">Com erro</dt>
                <dd className="font-titulo text-2xl font-semibold tabular-nums text-tinta">{estado.erros.toLocaleString('pt-BR')}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-tinta-suave">Acesso público do painel</dt>
                <dd className="text-sm text-tinta">
                  {estado.acessoPublico === null ? 'Não verificado' : estado.acessoPublico ? <Selo variante="sucesso">Liberado</Selo> : <Selo variante="aviso">Bloqueado</Selo>}
                </dd>
              </div>
              <Execucao titulo="Última sincronização" e={estado.ultimoSync} />
            </dl>
          ) : (
            <Aviso tipo="erro" titulo="Não foi possível ler o estado da integração">O banco não respondeu. Recarregue a página.</Aviso>
          )}

          <form method="POST" action="/api/crm/funis/sincronizar" className="flex flex-wrap items-center gap-3">
            <BotaoEnviar rotuloEnviando="Sincronizando…">Sincronizar agora</BotaoEnviar>
            <span className="text-xs text-tinta-suave">
              Envia até 200 contatos pendentes por vez. Só email e nome vão ao Resend; descadastrados e apagados nunca entram no segmento.
            </span>
          </form>
        </div>
      </Cartao>

      {estado?.acessoPublico === false && (
        <Aviso tipo="alerta" titulo="O painel está bloqueado para acesso público: nenhum email de funil ou newsletter sai" role={null}>
          O link de descadastro, os webhooks do Resend e o formulário do site precisam alcançar <code>{urlPublica}</code> sem o login da
          Vercel. Hoje a produção está atrás do Deployment Protection. No painel da Vercel (Settings → Deployment Protection), troque para{' '}
          <strong>Standard Protection</strong>: ela protege só as prévias, e a produção fica acessível — o painel continua todo atrás da
          própria senha. Essa mudança de segurança é sua; até ela, os envios ficam parados (a verificação roda a cada poucos minutos).
        </Aviso>
      )}

      <Cartao titulo="Domínio remetente (DNS)" descricao="Sem o domínio verificado no Resend, os emails não saem (ou caem no spam).">
        <Passos
          itens={[
            <>No Resend, abra Domains → Add Domain e adicione <code>{DOMINIO_REMETENTE}</code>.</>,
            'O Resend mostra os registros DNS (SPF, DKIM e, se quiser, DMARC). Copie cada um exatamente como aparece.',
            'Na Hostinger, abra o domínio → DNS / Zona DNS e crie os registros um a um (tipo, nome e valor).',
            'Volte ao Resend e clique em Verify. A propagação pode levar de minutos a algumas horas.',
            <>Defina <code>RESEND_REMETENTE</code> (por exemplo, <code>Oliveira Guimarães &lt;contato@{DOMINIO_REMETENTE}&gt;</code>) na Vercel e faça um novo deploy.</>,
          ]}
        />
      </Cartao>

      <Cartao titulo="Webhook do Resend" descricao="Aberturas, cliques, bounces, reclamações de spam e descadastros voltam para a linha do tempo.">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-tinta">URL para colar no Resend</p>
            <code className="block rounded-md border border-borda bg-elevada px-3 py-2 font-mono text-xs break-all text-tinta">{urlPublica}/api/webhooks/resend</code>
          </div>
          {segredoWebhook ? (
            <p className="text-sm text-tinta"><Selo variante="sucesso">Segredo configurado</Selo> <code>RESEND_WEBHOOK_SECRET</code> está definido.</p>
          ) : (
            <Aviso tipo="erro" role={null}>RESEND_WEBHOOK_SECRET não está configurado: o webhook recusa tudo até ele existir.</Aviso>
          )}
          <Passos
            itens={[
              'No Resend, abra Webhooks → Add Webhook e cole a URL acima.',
              <>Assine estes eventos: {EVENTOS_WEBHOOK.map((e, i) => <span key={e}>{i > 0 && ', '}<code>{e}</code></span>)}.</>,
              <>Copie o <em>Signing Secret</em> (começa com <code>whsec_</code>) para <code>RESEND_WEBHOOK_SECRET</code> na Vercel e faça um novo deploy.</>,
              'Reclamação de spam e descadastro pela página do Resend viram "Descadastrado" no CRM e tiram o contato dos funis; hard bounce só tira dos funis. Eventos repetidos não duplicam nada.',
            ]}
          />
        </div>
      </Cartao>

      <Cartao titulo="Webhook do formulário do site" descricao="Cada envio do formulário vira (ou atualiza) um lead com consentimento.">
        <div className="space-y-4">
          {tokenSite ? (
            <UrlSecreta rotulo="URL para colar no Elementor" base={`${urlPublica}/api/webhooks/site`} token={tokenSite} />
          ) : (
            <Aviso tipo="erro" role={null}>SITE_WEBHOOK_TOKEN não está configurado: o webhook recusa tudo (401) até ele existir.</Aviso>
          )}
          <Passos
            itens={[
              'No WordPress, edite a página do formulário com o Elementor e clique no widget Formulário.',
              'Em Ações após envio, adicione "Webhook".',
              'Na nova seção Webhook, cole a URL acima (com o token). "Dados avançados" pode ficar ligado ou desligado: os dois formatos são aceitos.',
              'Confira os rótulos dos campos: Nome, E-mail, Telefone (ou WhatsApp), Escritório (ou Empresa) e Mensagem são reconhecidos.',
              'Atualize a página e faça um envio de teste: o contato aparece em Contatos com origem "Site" e a mensagem fica na linha do tempo.',
            ]}
          />
          <p className="text-xs text-tinta-suave">
            Proteções: token obrigatório, até {LIMITE_POR_MINUTO} envios por minuto por IP e corpo de até 64 KB. E-mail inválido ou acima do limite responde 200 com <code>{'{ok: false}'}</code> sem gravar nada (o Elementor mostra sucesso ao visitante; o envio simplesmente não aparece no CRM).
          </p>
        </div>
      </Cartao>
    </div>
  )
}
