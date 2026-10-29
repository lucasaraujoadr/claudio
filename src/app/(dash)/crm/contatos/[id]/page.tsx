import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, EstadoVazio, Selo, classesBotao, type TipoAviso } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import {
  ROTULO_BASE_LEGAL,
  ROTULO_CAMPO,
  ROTULO_ORIGEM,
  ROTULO_STATUS,
  STATUS_CONTATO,
  type CampoContato,
  type StatusContato,
} from '@/lib/crm/campos'
import { buscarContato } from '@/lib/crm/consultas'
import { linhaDoTempo } from '@/lib/crm/contatos'
import { lerId, mensagemCampoLongo } from '@/lib/crm/formulario'
import type { Contato, EventoContato } from '@/lib/db/schema'
import { CampoBaseLegal, CamposContato, SeloStatus, SeloSync, formatarQuando } from '../_compartilhado'

export const metadata = { title: 'Contato' }

const AVISOS: Record<string, { texto: string; tipo: TipoAviso }> = {
  criado: { texto: 'Contato criado.', tipo: 'sucesso' },
  existia: { texto: 'Esse e-mail já estava cadastrado: o que você digitou foi gravado neste contato, e o status dele não mudou (a menos que você tenha escolhido um).', tipo: 'info' },
  'existia-descadastrado': { texto: 'Esse e-mail já estava cadastrado e está descadastrado: os dados foram gravados, mas o status continua descadastrado.', tipo: 'alerta' },
  salvo: { texto: 'Alterações salvas.', tipo: 'sucesso' },
  'sem-mudanca': { texto: 'Nada mudou.', tipo: 'info' },
  status: { texto: 'Status alterado.', tipo: 'sucesso' },
  bloqueado: { texto: 'Contato descadastrado não muda de status por aqui. Use a reativação, mais abaixo, se a pessoa pediu para voltar.', tipo: 'erro' },
  reativado: { texto: 'Contato reativado como lead. A reativação ficou registrada na linha do tempo.', tipo: 'sucesso' },
  'sem-motivo': { texto: 'Para reativar, descreva como a pessoa pediu para voltar a receber.', tipo: 'erro' },
  'sem-ciente': { texto: 'Para reativar, confirme que a pessoa pediu para voltar a receber.', tipo: 'erro' },
  'base-legal': { texto: 'A base legal é obrigatória.', tipo: 'erro' },
  uf: { texto: 'UF inválida. Use a sigla do estado (ex.: SP) ou deixe em branco.', tipo: 'erro' },
  erro: { texto: 'Não foi possível concluir a ação. Nada foi alterado; tente novamente.', tipo: 'erro' },
}

const ROTULO_EVENTO: Record<EventoContato['tipo'], string> = {
  criado: 'Contato criado',
  atualizado: 'Dados atualizados',
  importado: 'Importado de planilha',
  mudou_status: 'Mudou de status',
  entrou_funil: 'Entrou em funil',
  saiu_funil: 'Saiu de funil',
  enviado: 'Email enviado',
  aberto: 'Email aberto',
  clicado: 'Clique em email',
  descadastrou: 'Descadastrou-se',
  bounce: 'Bounce',
  spam: 'Marcou como spam',
  formulario: 'Mensagem pelo site',
}

function rotuloOrigem(v: unknown): string | null {
  return typeof v === 'string' && v in ROTULO_ORIGEM ? ROTULO_ORIGEM[v as keyof typeof ROTULO_ORIGEM] : null
}
function rotuloStatus(v: unknown): string {
  return typeof v === 'string' && v in ROTULO_STATUS ? ROTULO_STATUS[v as StatusContato] : String(v)
}

/** Detalhe legível do evento, só com o que a tela conhece; o resto do JSON não aparece. */
function detalheEvento(e: EventoContato): string | null {
  const d = e.dados ?? {}
  const origem = rotuloOrigem(d.origem)
  const via = origem ? ` · via ${origem.toLowerCase()}` : ''
  if (e.tipo === 'mudou_status') {
    const motivo = typeof d.motivo === 'string' ? ` · motivo: ${d.motivo}` : ''
    return `${rotuloStatus(d.de)} → ${rotuloStatus(d.para)}${d.reativacao ? ' (reativação manual)' : ''}${via}${motivo}`
  }
  if (e.tipo === 'atualizado' && Array.isArray(d.campos)) {
    const rotulos = (v: unknown) =>
      Array.isArray(v) ? v.filter((c): c is CampoContato => typeof c === 'string' && c in ROTULO_CAMPO).map((c) => ROTULO_CAMPO[c]) : []
    const campos = rotulos(d.campos)
    const mantidos = rotulos(d.mantidos)
    const kept = mantidos.length > 0 ? ` · mantidos sem trocar (fonte menos confiável): ${mantidos.join(', ')}` : ''
    const bl = d.baseLegal as { de?: string; para?: string } | undefined
    const base = bl?.de && bl.para ? ` · base legal: ${ROTULO_BASE_LEGAL[bl.de as keyof typeof ROTULO_BASE_LEGAL] ?? bl.de} → ${ROTULO_BASE_LEGAL[bl.para as keyof typeof ROTULO_BASE_LEGAL] ?? bl.para}` : ''
    return `Alterados: ${campos.join(', ')}${via}${base}${kept}`
  }
  if (e.tipo === 'importado') {
    const arquivo = typeof d.arquivo === 'string' ? d.arquivo : 'planilha'
    return `${arquivo}${d.acao === 'criado' ? ' · contato novo' : ' · contato já existia (só campos vazios foram preenchidos)'}`
  }
  if (e.tipo === 'criado') return origem ? `Origem: ${origem}` : null
  if (e.tipo === 'formulario') return typeof d.mensagem === 'string' ? d.mensagem : null
  if (['enviado', 'aberto', 'clicado', 'descadastrou', 'bounce', 'spam'].includes(e.tipo)) {
    const partes = [
      typeof d.campanha === 'string' ? `Campanha: ${d.campanha}` : null,
      typeof d.link === 'string' ? `Link: ${d.link}` : null,
      typeof d.motivo === 'string' ? `Motivo: ${d.motivo}` : null,
    ].filter(Boolean)
    return partes.length > 0 ? `${partes.join(' · ')}${via}` : origem ? `Via ${origem.toLowerCase()}` : null
  }
  return null
}

function Dado({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-tinta-suave">{rotulo}</dt>
      <dd className="text-sm text-tinta">{children}</dd>
    </div>
  )
}

function Resumo({ c }: { c: Contato }) {
  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      <Dado rotulo="E-mail"><span className="break-all">{c.email}</span></Dado>
      <Dado rotulo="Origem">{ROTULO_ORIGEM[c.origem]}</Dado>
      <Dado rotulo="Base legal">
        {ROTULO_BASE_LEGAL[c.baseLegal]}
        {c.consentimentoEm && <span className="block text-xs text-tinta-suave">Consentimento registrado em {formatarQuando(c.consentimentoEm)}</span>}
      </Dado>
      <Dado rotulo="Cadastrado em">{formatarQuando(c.criadoEm)}</Dado>
      <Dado rotulo="Atualizado em">{formatarQuando(c.atualizadoEm)}</Dado>
      <Dado rotulo="Sincronização">
        <SeloSync status={c.syncStatus} />
        {c.syncStatus === 'erro' && c.syncErro && <span className="block text-xs text-tinta-suave">{c.syncErro}</span>}
      </Dado>
    </dl>
  )
}

function MudarStatus({ c }: { c: Contato }) {
  if (c.status === 'descadastrado') return null
  return (
    <form method="POST" action={`/api/crm/contatos/${c.id}/status`} className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <label htmlFor="s-para" className={CLASSES_ROTULO}>Mudar status</label>
        <select id="s-para" name="para" defaultValue={c.status} className={classesCampo('w-48')}>
          {STATUS_CONTATO.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
        </select>
      </div>
      <BotaoEnviar rotuloEnviando="Salvando…" variante="secundario">Aplicar</BotaoEnviar>
      <p className="w-full text-xs text-tinta-suave">
        Marcar como descadastrado é definitivo: o contato sai de todos os envios e só volta por uma reativação registrada.
      </p>
    </form>
  )
}

function Reativar({ c }: { c: Contato }) {
  return (
    <Cartao titulo="Reativar contato descadastrado" descricao="Só use se a própria pessoa pediu, por escrito, para voltar a receber.">
      <Aviso tipo="alerta" titulo="Esta pessoa pediu para não receber mais emails" role={null}>
        Pela LGPD, o descadastro é a revogação do consentimento. Reativar sem um novo pedido da própria pessoa é tratamento
        irregular de dados pessoais. A reativação fica registrada na linha do tempo com o motivo informado.
      </Aviso>
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium text-acento-texto">A pessoa pediu para voltar — reativar</summary>
        <form method="POST" action={`/api/crm/contatos/${c.id}/reativar`} className="mt-3 space-y-3">
          <div className="space-y-1">
            <label htmlFor="r-motivo" className={CLASSES_ROTULO}>Como e quando a pessoa pediu</label>
            <textarea id="r-motivo" name="motivo" required rows={3} maxLength={1000} className={classesCampo()} placeholder="Ex.: respondeu ao email de 28/10 pedindo para voltar à lista." />
          </div>
          <label className="flex items-start gap-2 text-sm text-tinta">
            <input type="checkbox" name="ciente" value="1" required className="mt-1 accent-acento" />
            Confirmo que a própria pessoa pediu para voltar a receber comunicações.
          </label>
          <BotaoEnviar rotuloEnviando="Reativando…" variante="perigo">Reativar como lead</BotaoEnviar>
        </form>
      </details>
    </Cartao>
  )
}

export default async function ContatoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const id = lerId((await params).id)
  if (!id) notFound()
  const sp = await searchParams
  const aviso =
    sp.aviso === 'longo'
      ? { texto: mensagemCampoLongo(typeof sp.campo === 'string' ? sp.campo : undefined), tipo: 'erro' as const }
      : typeof sp.aviso === 'string'
        ? AVISOS[sp.aviso]
        : undefined

  let c: Contato | null
  let eventos: EventoContato[]
  try {
    ;[c, eventos] = await Promise.all([buscarContato(id), linhaDoTempo(id)])
  } catch (e) {
    console.error('crm: detalhe falhou:', e instanceof Error ? e.name : 'erro')
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <CabecalhoPagina secao="CRM" titulo="Contato" />
        <Aviso tipo="erro" titulo="Não foi possível ler o contato">O banco não respondeu. Recarregue a página em alguns instantes.</Aviso>
      </div>
    )
  }
  if (!c) notFound()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CabecalhoPagina
        secao="CRM"
        titulo={c.nome || '(sem nome)'}
        subtitulo={[c.escritorio, c.cidade && `${c.cidade}${c.uf ? `/${c.uf}` : ''}`].filter(Boolean).join(' · ') || undefined}
        acoes={
          <>
            <SeloStatus status={c.status} />
            <Link href="/crm/contatos" className={classesBotao('fantasma')}>Voltar à lista</Link>
          </>
        }
      />
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {c.status === 'descadastrado' && aviso?.texto !== AVISOS.bloqueado.texto && (
        <Aviso tipo="alerta" titulo="Contato descadastrado">
          Não recebe nenhum email e não entra em nenhuma lista do Brevo. Importações e formulários não mudam isso.
        </Aviso>
      )}

      <Cartao titulo="Resumo" acoes={c.tags.length > 0 ? <span className="flex flex-wrap gap-1">{c.tags.map((t) => <Selo key={t}>{t}</Selo>)}</span> : undefined}>
        <div className="space-y-5">
          <Resumo c={c} />
          <MudarStatus c={c} />
        </div>
      </Cartao>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Cartao titulo="Editar dados" descricao="Campo deixado em branco é apagado. O e-mail identifica o contato e não muda aqui.">
          <form method="POST" action={`/api/crm/contatos/${c.id}/editar`} className="space-y-5">
            <CamposContato v={c} />
            <CampoBaseLegal atual={c.baseLegal} />
            <p className="text-xs text-tinta-suave">Trocar a base legal fica registrado na linha do tempo, com a anterior e a nova.</p>
            <div className="flex justify-end border-t border-borda pt-4">
              <BotaoEnviar rotuloEnviando="Salvando…">Salvar alterações</BotaoEnviar>
            </div>
          </form>
        </Cartao>

        <Cartao titulo="Linha do tempo" descricao="Do mais recente ao mais antigo." semPreenchimento>
          {eventos.length === 0 ? (
            <div className="p-5"><EstadoVazio nivelTitulo={3} titulo="Sem eventos" explicacao="Os envios, aberturas e cliques aparecem aqui quando o Brevo estiver conectado." /></div>
          ) : (
            <ol className="divide-y divide-borda">
              {eventos.map((e) => {
                const detalhe = detalheEvento(e)
                return (
                  <li key={e.id} className="px-5 py-3">
                    <p className="text-sm font-medium text-tinta">{ROTULO_EVENTO[e.tipo]}</p>
                    {detalhe && <p className="text-sm text-tinta-suave">{detalhe}</p>}
                    <p className="text-xs text-tinta-suave"><time dateTime={e.em.toISOString()}>{formatarQuando(e.em)}</time></p>
                  </li>
                )
              })}
            </ol>
          )}
        </Cartao>
      </div>

      {c.status === 'descadastrado' && <Reativar c={c} />}
    </div>
  )
}
