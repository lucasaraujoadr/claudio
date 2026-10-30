import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, EstadoVazio, Selo, Tabela, classesBotao, type TipoAviso } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import { urlPublicaPainel } from '@/lib/acesso-publico'
import { bancoPadrao } from '@/lib/crm/banco'
import { montarEmail } from '@/lib/crm/email-html'
import { resumoEnviosFunil, type ResumoEnviosFunil } from '@/lib/crm/envios-painel'
import {
  aplicarMarcadores,
  definicaoFunil,
  EMAILS_FUNIS,
  etapasDaSequencia,
  linkWhatsapp,
  marcadoresPendentes,
} from '@/lib/crm/funis-conteudo'
import { MAX_CONTATOS_POR_TAG, membrosDoFunil, MEMBROS_POR_PAGINA, obterFunil, type MembroFunil } from '@/lib/crm/funis'
import { MAX_EMAILS_INSCRICAO } from '@/lib/crm/funis-formulario'
import { DEFINICAO_SEM_INTERACAO, ehSlugFunil, ROTULO_RECUSA, TETO_MAXIMO_PROSPECCAO, type MotivoRecusa, type SlugFunil } from '@/lib/crm/funis-regras'
import type { Funil, FunilInscricao } from '@/lib/db/schema'
import { formatarQuando, SeloStatus } from '../../contatos/_compartilhado'
import { ROTULO_CAMINHO, ROTULO_INSCRICAO, SeloFunil } from '../_compartilhado'

export const metadata = { title: 'Funil' }

const AVISOS: Record<string, { texto: string; tipo: TipoAviso }> = {
  ligado: { texto: 'Funil ligado.', tipo: 'sucesso' },
  desligado: { texto: 'Funil desligado: ninguém novo entra; quem já está continua até sair.', tipo: 'info' },
  checklist: { texto: 'Para ligar a prospecção fria, confirme os quatro itens do checklist de LGPD.', tipo: 'erro' },
  teto: { texto: `Defina um teto diário entre 1 e ${TETO_MAXIMO_PROSPECCAO}.`, tipo: 'erro' },
  removido: { texto: 'Contato removido do funil.', tipo: 'sucesso' },
  'nada-para-inscrever': { texto: 'Informe emails (um por linha) ou uma tag.', tipo: 'erro' },
  erro: { texto: 'Não foi possível concluir a ação. Tente de novo.', tipo: 'erro' },
}


function numero(v: string | string[] | undefined): number {
  const n = typeof v === 'string' ? Number.parseInt(v, 10) : NaN
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/** Resumo da inscrição manual, a partir da URL (`inscritos`, `ja`, `nao`, `motivos=a:1,b:2`). */
function avisoInscricao(sp: Record<string, string | string[] | undefined>): { texto: string; tipo: TipoAviso } | null {
  if (sp.aviso !== 'inscricao') return null
  const inscritos = numero(sp.inscritos)
  const partes = [`${inscritos} inscrito${inscritos === 1 ? '' : 's'}`]
  if (numero(sp.ja) > 0) partes.push(`${numero(sp.ja)} já estava(m) no funil`)
  if (numero(sp.nao) > 0) partes.push(`${numero(sp.nao)} email(s) não encontrado(s) no CRM`)
  const motivos = typeof sp.motivos === 'string' ? sp.motivos.split(',') : []
  for (const m of motivos) {
    const [chave, qtd] = m.split(':')
    const rotulo = chave === 'ja_passou' ? 'já passou por este funil' : chave in ROTULO_RECUSA ? ROTULO_RECUSA[chave as MotivoRecusa] : null
    if (rotulo && numero(qtd) > 0) partes.push(`${numero(qtd)} recusado(s): ${rotulo}`)
  }
  if (sp.excedeu_emails === '1') partes.push(`só os primeiros ${MAX_EMAILS_INSCRICAO.toLocaleString('pt-BR')} emails colados foram tratados; envie o resto em outra vez`)
  if (sp.excedeu_tag === '1') partes.push(`a tag tem mais de ${MAX_CONTATOS_POR_TAG.toLocaleString('pt-BR')} contatos; só os primeiros foram tratados — repita para os demais`)
  const excedeu = sp.excedeu_emails === '1' || sp.excedeu_tag === '1'
  return { texto: `${partes.join('; ')}.`, tipo: inscritos > 0 && !excedeu ? 'sucesso' : 'alerta' }
}

async function carregar(slug: SlugFunil, status: FunilInscricao['status'] | undefined, pagina: number) {
  try {
    const db = bancoPadrao()
    const funil = await obterFunil(slug, { db })
    const membros = await membrosDoFunil(funil.id, { db, status, pagina })
    const envios = await resumoEnviosFunil(slug, { db }).catch((e): ResumoEnviosFunil | null => {
      console.error('crm: envios do funil falharam:', e instanceof Error ? e.name : 'erro')
      return null
    })
    return { funil, membros, envios }
  } catch (e) {
    console.error('crm: leitura do funil falhou:', e instanceof Error ? e.name : 'erro')
    return null
  }
}

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div>
      <dt className="text-xs font-medium text-tinta-suave">{rotulo}</dt>
      <dd className="font-titulo text-xl font-semibold tabular-nums text-tinta">{valor.toLocaleString('pt-BR')}</dd>
    </div>
  )
}

function Envios({ r }: { r: ResumoEnviosFunil }) {
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-3">
        <Numero rotulo="Enviados (30 dias)" valor={r.enviados} />
        <Numero rotulo="Erros (30 dias)" valor={r.erros} />
        <Numero rotulo="Fila de hoje" valor={r.fila} />
      </dl>
      {r.incertos.length > 0 && (
        <Aviso tipo="alerta" titulo="Envios a conferir no Resend: o resultado não voltou; não são repetidos automaticamente" role={null}>
          <ul className="mt-1 space-y-1">
            {r.incertos.map((e) => (
              <li key={`${e.contatoId}-${e.etapa}-${e.quando.getTime()}`} className="text-sm">
                <Link href={`/crm/contatos/${e.contatoId}`} className="font-medium underline-offset-2 hover:underline">{e.nome || e.email}</Link>
                {e.nome ? ` (${e.email})` : ''} · email {e.etapa + 1} · {formatarQuando(e.quando)}
              </li>
            ))}
          </ul>
        </Aviso>
      )}
    </div>
  )
}

function Situacao({ f }: { f: Funil }) {
  if (f.slug !== 'prospeccao-fria' || f.ativo) {
    return (
      <div className="space-y-3">
        <p className="flex flex-wrap items-center gap-2 text-sm text-tinta">
          <SeloFunil f={f} />
          {f.ativo ? 'Recebe inscrições.' : 'Não recebe inscrições.'}
          {f.slug === 'prospeccao-fria' && f.checklistLgpdEm && (
            <span className="text-tinta-suave">
              Checklist de LGPD confirmado em {formatarQuando(f.checklistLgpdEm)} · teto de {f.tetoDiario}/dia.
            </span>
          )}
        </p>
        <form method="POST" action={`/api/crm/funis/${f.slug}/ativo`}>
          <input type="hidden" name="ativo" value={f.ativo ? '0' : '1'} />
          <BotaoEnviar rotuloEnviando="Salvando…" variante={f.ativo ? 'secundario' : 'primario'} tamanho="sm">
            {f.ativo ? 'Desligar funil' : 'Ligar funil'}
          </BotaoEnviar>
        </form>
      </div>
    )
  }
  return (
    <form method="POST" action={`/api/crm/funis/${f.slug}/ativo`} className="space-y-4">
      <input type="hidden" name="ativo" value="1" />
      <Aviso tipo="alerta" titulo="Prospecção fria é desligada por padrão" role={null}>
        Só entram leads com base legal de legítimo interesse. Antes de ligar, confirme cada item abaixo e defina um teto diário.
      </Aviso>
      <fieldset className="space-y-2">
        <legend className={CLASSES_ROTULO}>Checklist de LGPD (todos obrigatórios)</legend>
        <label className="flex items-start gap-2 text-sm text-tinta">
          <input type="checkbox" name="avaliacao" value="1" required className="mt-1 accent-acento" />
          A avaliação de legítimo interesse está documentada (finalidade, necessidade, expectativa do titular e salvaguardas).
        </label>
        <label className="flex items-start gap-2 text-sm text-tinta">
          <input type="checkbox" name="fonte" value="1" required className="mt-1 accent-acento" />
          A fonte dos contatos está documentada, e o marcador [fonte do contato] dos emails foi trocado por ela.
        </label>
        <label className="flex items-start gap-2 text-sm text-tinta">
          <input type="checkbox" name="descadastro" value="1" required className="mt-1 accent-acento" />
          Todo email da automação tem link de descadastro, e quem se descadastra sai de tudo.
        </label>
        <label className="flex items-start gap-2 text-sm text-tinta">
          <input type="checkbox" name="volume" value="1" required className="mt-1 accent-acento" />
          O volume será baixo e aquecido aos poucos (começar com poucos por dia e subir conforme a entrega).
        </label>
      </fieldset>
      <div className="max-w-48 space-y-1">
        <label htmlFor="teto" className={CLASSES_ROTULO}>Teto diário de inscrições</label>
        <input id="teto" name="teto" type="number" min={1} max={TETO_MAXIMO_PROSPECCAO} required defaultValue={f.tetoDiario ?? 10} className={classesCampo()} />
      </div>
      <BotaoEnviar rotuloEnviando="Ligando…">Ligar prospecção fria</BotaoEnviar>
    </form>
  )
}

function Membros({ f, itens, total, status, pagina }: { f: Funil; itens: MembroFunil[]; total: number; status?: string; pagina: number }) {
  const paginas = Math.max(1, Math.ceil(total / MEMBROS_POR_PAGINA))
  const link = (p: number, s = status) => `/crm/funis/${f.slug}?${new URLSearchParams({ ...(s ? { status: s } : {}), pagina: String(p) })}`
  return (
    <div className="space-y-3">
      <nav aria-label="Filtro de membros" className="flex flex-wrap gap-2 text-sm">
        {(['ativo', 'saiu', 'concluido'] as const).map((s) => (
          <Link key={s} href={link(1, s)} aria-current={status === s ? 'page' : undefined} className={classesBotao(status === s ? 'primario' : 'secundario', 'sm')}>
            {ROTULO_INSCRICAO[s]}
          </Link>
        ))}
        <Link href={`/crm/funis/${f.slug}?status=todos`} aria-current={!status ? 'page' : undefined} className={classesBotao(!status ? 'primario' : 'secundario', 'sm')}>
          Todos
        </Link>
      </nav>
      {itens.length === 0 ? (
        <EstadoVazio titulo="Ninguém aqui" explicacao="Nenhum contato com esse status neste funil." />
      ) : (
        <Tabela legenda={`Membros do funil ${f.nome}`} compacta>
          <thead>
            <tr>
              <th>Contato</th>
              <th>Situação</th>
              <th>Entrou em</th>
              <th>Por</th>
              <th><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {itens.map(({ inscricao: i, contato: c }) => (
              <tr key={i.id}>
                <td>
                  <Link href={`/crm/contatos/${c.id}`} className="font-medium text-tinta hover:underline">{c.nome || '(sem nome)'}</Link>
                  <span className="block text-xs text-tinta-suave">{c.email}</span>
                </td>
                <td>
                  <span className="flex flex-wrap items-center gap-1">
                    <Selo variante={i.status === 'ativo' ? 'sucesso' : 'neutro'}>{ROTULO_INSCRICAO[i.status]}</Selo>
                    <SeloStatus status={c.status} />
                  </span>
                  {i.saiuEm && (
                    <span className="block text-xs text-tinta-suave">
                      {formatarQuando(i.saiuEm)}
                      {i.motivoSaida ? ` · ${i.motivoSaida}` : ''}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap">{formatarQuando(i.entrouEm)}</td>
                <td>{ROTULO_CAMINHO[i.origem] ?? i.origem}</td>
                <td className="text-right">
                  {i.status === 'ativo' && (
                    <form method="POST" action={`/api/crm/funis/${f.slug}/remover`}>
                      <input type="hidden" name="contato_id" value={c.id} />
                      <button type="submit" className={classesBotao('fantasma', 'sm')}>Remover</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
      {paginas > 1 && (
        <p className="flex items-center gap-3 text-sm text-tinta-suave">
          {pagina > 1 && <Link href={link(pagina - 1)} className="underline">Anterior</Link>}
          Página {pagina} de {paginas} · {total.toLocaleString('pt-BR')} no total
          {pagina < paginas && <Link href={link(pagina + 1)} className="underline">Próxima</Link>}
        </p>
      )}
    </div>
  )
}

export default async function FunilPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const { slug } = await params
  if (!ehSlugFunil(slug)) notFound()
  const sp = await searchParams
  const status = sp.status === 'todos' ? undefined : sp.status === 'saiu' || sp.status === 'concluido' ? sp.status : 'ativo'
  const pagina = Math.max(1, numero(sp.pagina) || 1)
  const aviso = avisoInscricao(sp) ?? (typeof sp.aviso === 'string' ? AVISOS[sp.aviso] : undefined)
  const def = definicaoFunil(slug)
  const dados = await carregar(slug, status, pagina)
  const whatsapp = linkWhatsapp()
  const emails = EMAILS_FUNIS[slug].map((e) => ({ ...e, corpo: aplicarMarcadores(e.corpo, { whatsapp }) }))
  const urlExemplo = `${urlPublicaPainel()}/descadastro?token=exemplo-de-previa`
  const previas = EMAILS_FUNIS[slug].map((e) => ({ ...e, ...montarEmail(e, { nome: 'Maria Souza', urlDescadastro: urlExemplo, whatsapp }) }))
  const temSequencia = etapasDaSequencia(slug).length > 0
  const pendentes = !temSequencia ? [] : marcadoresPendentes(emails.flatMap((e) => [e.assunto, e.preCabecalho, e.corpo]))

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CabecalhoPagina
        secao={<Link href="/crm/funis" className="hover:underline">CRM · Funis</Link>}
        titulo={def.nome}
        subtitulo={def.descricao}
      />
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {!dados ? (
        <Aviso tipo="erro" titulo="Não foi possível ler o funil">O banco não respondeu. Recarregue a página.</Aviso>
      ) : (
        <>
          <Cartao titulo="Situação" descricao={slug === 'reativacao' ? `${def.quemEntra} ${DEFINICAO_SEM_INTERACAO}` : def.quemEntra}>
            <Situacao f={dados.funil} />
          </Cartao>

          <Cartao titulo="Inscrever contatos" descricao={slug === 'boas-vindas' ? 'Só contatos que vieram pelo formulário do site.' : 'As regras do funil valem também aqui; quem não se encaixa é recusado e contado.'}>
            <form method="POST" action={`/api/crm/funis/${slug}/inscrever`} className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="emails" className={CLASSES_ROTULO}>Emails (um por linha)</label>
                <textarea id="emails" name="emails" rows={4} className={classesCampo('h-auto')} placeholder="nome@escritorio.com.br" />
              </div>
              <div className="space-y-1">
                <label htmlFor="tag" className={CLASSES_ROTULO}>Ou todos os contatos com a tag</label>
                <input id="tag" name="tag" className={classesCampo()} placeholder="ex.: importacao-outubro" maxLength={100} />
                <p className="text-xs text-tinta-suave">Útil para um lote importado de planilha com uma tag.</p>
              </div>
              <div className="sm:col-span-2">
                <BotaoEnviar rotuloEnviando="Inscrevendo…" tamanho="sm">Inscrever</BotaoEnviar>
              </div>
            </form>
          </Cartao>

          <Cartao titulo="Membros" descricao="Do mais recente ao mais antigo.">
            <Membros f={dados.funil} itens={dados.membros.itens} total={dados.membros.total} status={status} pagina={pagina} />
          </Cartao>
        </>
      )}

      {pendentes.length > 0 && (
        <Aviso tipo="alerta" titulo="Marcadores a resolver" role={null}>
          Os emails ainda têm {pendentes.length === 1 ? 'um marcador' : 'marcadores'} a resolver: {pendentes.join(', ')}.
          {pendentes.includes('[link do WhatsApp]') && ' Defina WHATSAPP_LINK na Vercel para o link entrar sozinho; sem ele, a frase do WhatsApp sai do email.'}
          {pendentes.includes('[fonte do contato]') && ' Troque [fonte do contato] pela origem real dos contatos (a mesma registrada na avaliação de legítimo interesse): email com esse marcador não é enviado.'}
        </Aviso>
      )}

      {dados?.envios && (
        <Cartao titulo="Envios" descricao="Últimos 30 dias e o que a rotina de hoje deve enviar (dentro do limite diário do plano).">
          <Envios r={dados.envios} />
        </Cartao>
      )}

      <Cartao
        titulo="Envio pelo painel"
        descricao={
          temSequencia
            ? 'A rotina diária envia pelo Resend cada email quando chega a hora (o primeiro na entrada; os outros, os dias indicados depois do anterior), até o limite diário do plano, com a boas-vindas na frente. Quem se descadastra, sai do funil ou tem o funil desligado não recebe. Depois do último email, a sequência fica concluída.'
            : 'Este funil não tem sequência: a inscrição define quem recebe a newsletter dos artigos novos.'
        }
      >
        <p className="text-sm text-tinta-suave">Todo email leva o link de descadastro próprio do contato.</p>
      </Cartao>

      {temSequencia && (
        <Cartao titulo="Etapas" descricao="Prévia de cada email como o contato recebe (com um nome de exemplo e o link de descadastro de teste). Marcadores entre colchetes aparecem como estão.">
          <div className="space-y-6">
            {previas.map((e, i) => (
              <article key={i} className="space-y-3 rounded-lg border border-borda p-4">
                <h3 className="font-titulo text-base font-semibold text-tinta">
                  Etapa {i + 1}{' '}
                  <span className="text-sm font-normal text-tinta-suave">
                    · {i === 0 ? 'logo ao entrar no funil' : `${e.esperarDias} ${e.esperarDias === 1 ? 'dia' : 'dias'} depois do anterior`}
                  </span>
                </h3>
                <p className="text-sm text-tinta"><span className="font-medium">Assunto:</span> {e.assunto}</p>
                <iframe
                  title={`Prévia da etapa ${i + 1}: ${e.assunto}`}
                  srcDoc={e.html}
                  sandbox=""
                  className="h-[34rem] w-full rounded-md border border-borda bg-white"
                />
              </article>
            ))}
          </div>
        </Cartao>
      )}
    </div>
  )
}
