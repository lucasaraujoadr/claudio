import type { ReactNode } from 'react'
import { connection } from 'next/server'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, Selo, type TipoAviso } from '@/components/ui'
import { brevoConfigurado, ATRIBUTOS_BREVO } from '@/lib/brevo'
import { BASES_LEGAIS, ROTULO_BASE_LEGAL } from '@/lib/crm/campos'
import { estadoIntegracao, type EstadoIntegracao } from '@/lib/crm/sincronizar'
import { formatarQuando } from '../contatos/_compartilhado'
import { UrlSecreta } from './url-secreta'
import { LIMITE_POR_MINUTO } from '@/lib/crm/webhook-site'

export const metadata = { title: 'Integração' }

/** Endereço público do painel em produção (é o que o Brevo e o Elementor chamam). */
const URL_PRODUCAO = 'https://claudio-psi-lime.vercel.app'

const AVISOS: Record<string, { texto: string; tipo: TipoAviso }> = {
  'sync-ok': { texto: 'Sincronização concluída: nada pendente.', tipo: 'sucesso' },
  'sync-parcial': { texto: 'Sincronização feita, mas ainda há contatos pendentes ou com erro. Veja o resumo abaixo.', tipo: 'alerta' },
  'sync-interrompida': { texto: 'A sincronização parou no meio. Veja a mensagem em "Última sincronização".', tipo: 'erro' },
  'nao-conectado': { texto: 'Brevo não conectado: configure BREVO_API_KEY na Vercel e faça um novo deploy.', tipo: 'alerta' },
  'base-legal': { texto: 'Escolha a base legal dos contatos que vêm do Brevo.', tipo: 'erro' },
  'importacao-ok': { texto: 'Contatos do Brevo importados.', tipo: 'sucesso' },
  'importacao-parcial': { texto: 'Importação parou no teto por execução; clique de novo para continuar.', tipo: 'alerta' },
  'importacao-erro': { texto: 'A importação do Brevo parou com erro. Veja "Última importação".', tipo: 'erro' },
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

function Execucao({ titulo, e }: { titulo: string; e: EstadoIntegracao['ultimaSincronizacao'] }) {
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
  const conectado = brevoConfigurado()
  const tokenBrevo = process.env.BREVO_WEBHOOK_TOKEN?.trim() || null
  const tokenSite = process.env.SITE_WEBHOOK_TOKEN?.trim() || null
  const estado = await carregar()

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CabecalhoPagina
        secao="CRM"
        titulo="Integração"
        subtitulo="Brevo (envio dos emails) e formulário do site. O CRM continua sendo a fonte da verdade dos contatos."
      />

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      <Aviso tipo="alerta" titulo="Hoje o Brevo e o site não conseguem chamar os webhooks" role={null}>
        A produção está atrás da proteção de login da Vercel (Deployment Protection / SSO). O Vercel Cron passa, mas o Brevo e o
        Elementor recebem a tela de login da Vercel em <code>/api/webhooks/*</code>. Para ligar, escolha uma das duas saídas no
        painel da Vercel (Settings → Deployment Protection): <strong>restringir a proteção às prévias</strong> (Preview), deixando a
        produção aberta — o painel continua exigindo a senha própria —, ou criar um <strong>Protection Bypass for Automation</strong>{' '}
        e acrescentar <code>&amp;x-vercel-protection-bypass=…</code> às duas URLs abaixo. Os webhooks já exigem token próprio.
      </Aviso>

      <Cartao titulo="Brevo" descricao="Conexão pela chave de API (BREVO_API_KEY).">
        <div className="space-y-5">
          {conectado ? (
            <p className="text-sm text-tinta"><Selo variante="sucesso">Conectado</Selo> A chave do Brevo está configurada.</p>
          ) : (
            <Aviso tipo="info" titulo="Brevo não conectado" role={null}>
              O CRM funciona por completo sem o Brevo: os contatos ficam como &quot;pendente&quot; e são enviados quando a chave for
              configurada. Crie a conta, gere a chave em Brevo → SMTP e API → Chaves de API, cadastre <code>BREVO_API_KEY</code> na
              Vercel (Production) e faça um novo deploy.
            </Aviso>
          )}

          {estado ? (
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium text-tinta-suave">Pendentes</dt>
                <dd className="font-titulo text-2xl font-semibold tabular-nums text-tinta">{estado.porSync.pendente.toLocaleString('pt-BR')}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-tinta-suave">Sincronizados</dt>
                <dd className="font-titulo text-2xl font-semibold tabular-nums text-tinta">{estado.porSync.sincronizado.toLocaleString('pt-BR')}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-tinta-suave">Com erro</dt>
                <dd className="font-titulo text-2xl font-semibold tabular-nums text-tinta">{estado.porSync.erro.toLocaleString('pt-BR')}</dd>
              </div>
              <Execucao titulo="Última sincronização" e={estado.ultimaSincronizacao} />
              <Execucao titulo="Última importação do Brevo" e={estado.ultimaImportacao} />
            </dl>
          ) : (
            <Aviso tipo="erro" titulo="Não foi possível ler o estado da integração">O banco não respondeu. Recarregue a página.</Aviso>
          )}

          <form method="POST" action="/api/crm/brevo/sincronizar" className="flex flex-wrap items-center gap-3">
            <BotaoEnviar rotuloEnviando="Sincronizando…">Sincronizar agora</BotaoEnviar>
            <span className="text-xs text-tinta-suave">
              Envia até 200 contatos pendentes por vez. Descadastrados vão bloqueados e nunca entram em lista.
            </span>
          </form>

          <details className="rounded-lg border border-borda p-4">
            <summary className="cursor-pointer text-sm font-medium text-tinta">Importar contatos que já estão no Brevo</summary>
            <form method="POST" action="/api/crm/brevo/importar" className="mt-3 space-y-3">
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium text-tinta">Base legal desses contatos (obrigatória)</legend>
                {BASES_LEGAIS.map((b) => (
                  <label key={b} className="flex items-center gap-2 text-sm text-tinta">
                    <input type="radio" name="baseLegal" value={b} required /> {ROTULO_BASE_LEGAL[b]}
                  </label>
                ))}
              </fieldset>
              <p className="text-xs text-tinta-suave">
                Entram com origem &quot;Brevo&quot;; quem está bloqueado no Brevo entra como descadastrado; contatos que já existem no CRM
                só têm os campos vazios completados. Até 10.000 por vez.
              </p>
              <BotaoEnviar rotuloEnviando="Importando…" variante="secundario">Importar do Brevo</BotaoEnviar>
            </form>
          </details>

          <details className="rounded-lg border border-borda p-4">
            <summary className="cursor-pointer text-sm font-medium text-tinta">Atributos que precisam existir no Brevo</summary>
            <div className="mt-3 space-y-2 text-sm text-tinta">
              <p>
                Em Brevo → Contatos → Configurações → Atributos de contato, crie como <strong>Texto</strong> (categoria normal) os que
                ainda não existirem:
              </p>
              <ul className="flex flex-wrap gap-2">
                {ATRIBUTOS_BREVO.map((a) => <li key={a}><code className="rounded bg-elevada px-1.5 py-0.5">{a}</code></li>)}
              </ul>
              <p className="text-xs text-tinta-suave">
                O telefone vai em TELEFONE (texto), não no atributo SMS do Brevo, que recusa o contato inteiro se o número não estiver
                no formato internacional. Campos vazios no CRM não são enviados.
              </p>
            </div>
          </details>
        </div>
      </Cartao>

      <Cartao titulo="Webhook do Brevo" descricao="Descadastros, bounces, spam, aberturas e cliques voltam para a linha do tempo.">
        <div className="space-y-4">
          {tokenBrevo ? (
            <UrlSecreta rotulo="URL para colar no Brevo" base={`${URL_PRODUCAO}/api/webhooks/brevo`} token={tokenBrevo} />
          ) : (
            <Aviso tipo="erro" role={null}>BREVO_WEBHOOK_TOKEN não está configurado: o webhook recusa tudo (401) até ele existir.</Aviso>
          )}
          <Passos
            itens={[
              'No Brevo, abra Configurações (engrenagem) → Webhooks → Adicionar novo webhook.',
              'Tipo: Marketing. Cole a URL acima (com o token) no campo URL.',
              'Marque os eventos: Descadastro, Hard bounce, Marcado como spam, Aberto, Clicado e Entregue.',
              'Salve. Repita com o tipo Transacional se for enviar emails transacionais pelo Brevo.',
              'Descadastro, hard bounce e spam viram "Descadastrado" no CRM e tiram o contato de todos os funis. Eventos repetidos não duplicam nada.',
            ]}
          />
        </div>
      </Cartao>

      <Cartao titulo="Webhook do formulário do site" descricao="Cada envio do formulário vira (ou atualiza) um lead com consentimento.">
        <div className="space-y-4">
          {tokenSite ? (
            <UrlSecreta rotulo="URL para colar no Elementor" base={`${URL_PRODUCAO}/api/webhooks/site`} token={tokenSite} />
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
