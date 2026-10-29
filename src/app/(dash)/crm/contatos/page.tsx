import Link from 'next/link'
import { connection } from 'next/server'
import { Aviso, CabecalhoPagina, Cartao, EstadoVazio, Selo, Tabela, classesBotao, cx } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import { ORIGENS, ROTULO_ORIGEM, ROTULO_STATUS, STATUS_CONTATO, type StatusContato } from '@/lib/crm/campos'
import { contarPorStatus, listarContatos, POR_PAGINA, tagsEmUso } from '@/lib/crm/consultas'
import { lerFiltro, queryDoFiltro, type FiltroContatos } from '@/lib/crm/filtros'
import type { Contato } from '@/lib/db/schema'
import { SeloStatus, formatarQuando } from './_compartilhado'

export const metadata = { title: 'Contatos' }

type Dados = { itens: Contato[]; total: number; contagem: Record<StatusContato, number>; tags: string[] }

async function carregar(f: FiltroContatos): Promise<Dados | null> {
  try {
    const [lista, contagem, tags] = await Promise.all([listarContatos(f), contarPorStatus(), tagsEmUso()])
    return { ...lista, contagem, tags }
  } catch (e) {
    console.error('crm: lista de contatos falhou:', e instanceof Error ? e.name : 'erro')
    return null
  }
}

function href(f: FiltroContatos, extra: Partial<FiltroContatos> = {}): string {
  const q = queryDoFiltro(f, extra)
  return q ? `/crm/contatos?${q}` : '/crm/contatos'
}

function Contagens({ f, contagem }: { f: FiltroContatos; contagem: Record<StatusContato, number> }) {
  const total = STATUS_CONTATO.reduce((s, k) => s + contagem[k], 0)
  const item = (rotulo: string, n: number, status: StatusContato | null) => {
    const ativo = f.status === status
    return (
      <li key={rotulo}>
        <Link
          href={href(f, { status, pagina: 1 })}
          aria-current={ativo ? 'true' : undefined}
          className={cx(
            'flex min-w-28 flex-col rounded-lg border px-4 py-2.5 transition-colors',
            ativo ? 'border-acento bg-acento-suave' : 'border-borda bg-superficie hover:bg-elevada',
          )}
        >
          <span className="text-xs font-medium text-tinta-suave">{rotulo}</span>
          <span className="font-titulo text-2xl font-semibold tabular-nums text-tinta">{n.toLocaleString('pt-BR')}</span>
        </Link>
      </li>
    )
  }
  return (
    <nav aria-label="Contatos por status">
      <ul className="flex flex-wrap gap-2">
        {item('Todos', total, null)}
        {STATUS_CONTATO.map((s) => item(ROTULO_STATUS[s], contagem[s], s))}
      </ul>
    </nav>
  )
}

function Filtros({ f, tags }: { f: FiltroContatos; tags: string[] }) {
  return (
    <form method="GET" action="/crm/contatos" className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto] sm:items-end">
      <div className="space-y-1">
        <label htmlFor="f-q" className={CLASSES_ROTULO}>Buscar</label>
        <input id="f-q" name="q" type="search" defaultValue={f.q} placeholder="Nome, e-mail ou escritório" className={classesCampo()} />
      </div>
      <div className="space-y-1">
        <label htmlFor="f-status" className={CLASSES_ROTULO}>Status</label>
        <select id="f-status" name="status" defaultValue={f.status ?? ''} className={classesCampo()}>
          <option value="">Todos</option>
          {STATUS_CONTATO.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="f-origem" className={CLASSES_ROTULO}>Origem</label>
        <select id="f-origem" name="origem" defaultValue={f.origem ?? ''} className={classesCampo()}>
          <option value="">Todas</option>
          {ORIGENS.map((o) => <option key={o} value={o}>{ROTULO_ORIGEM[o]}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="f-tag" className={CLASSES_ROTULO}>Tag</label>
        <select id="f-tag" name="tag" defaultValue={f.tag ?? ''} className={classesCampo()}>
          <option value="">Todas</option>
          {f.tag && !tags.includes(f.tag) && <option value={f.tag}>{f.tag}</option>}
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={classesBotao('secundario')}>Filtrar</button>
      </div>
    </form>
  )
}

function Paginacao({ f, total }: { f: FiltroContatos; total: number }) {
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA))
  if (paginas <= 1) return null
  return (
    <nav aria-label="Paginação" className="flex items-center justify-between gap-3 px-5 py-3 text-sm text-tinta-suave">
      <span>Página {f.pagina.toLocaleString('pt-BR')} de {paginas.toLocaleString('pt-BR')}</span>
      <span className="flex gap-2">
        {f.pagina > 1 && <Link href={href(f, { pagina: f.pagina - 1 })} className={classesBotao('secundario', 'sm')}>Anterior</Link>}
        {f.pagina < paginas && <Link href={href(f, { pagina: f.pagina + 1 })} className={classesBotao('secundario', 'sm')}>Próxima</Link>}
      </span>
    </nav>
  )
}

export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const f = lerFiltro(await searchParams)
  const dados = await carregar(f)
  const filtrando = Boolean(f.q || f.status || f.origem || f.tag)
  const qExport = queryDoFiltro(f, { pagina: 1 })

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="CRM"
        titulo="Contatos"
        subtitulo="Leads e clientes num lugar só. Os dados de contato ficam aqui e nunca vão para a IA."
        acoes={
          <>
            <Link href="/crm/importar" className={classesBotao('secundario')}>Importar planilha</Link>
            <Link href="/crm/contatos/novo" className={classesBotao('primario')}>Novo contato</Link>
          </>
        }
      />

      {!dados ? (
        <Aviso tipo="erro" titulo="Não foi possível ler os contatos">
          O banco não respondeu. Recarregue a página em alguns instantes.
        </Aviso>
      ) : (
        <>
          <Contagens f={f} contagem={dados.contagem} />
          <Cartao>
            <Filtros f={f} tags={dados.tags} />
          </Cartao>

          <Cartao
            titulo={filtrando ? 'Resultado' : 'Todos os contatos'}
            descricao={`${dados.total.toLocaleString('pt-BR')} ${dados.total === 1 ? 'contato' : 'contatos'}${filtrando ? ' com esses filtros' : ''}`}
            acoes={
              dados.total > 0 ? (
                <a href={`/api/crm/contatos/exportar${qExport ? `?${qExport}` : ''}`} className={classesBotao('secundario', 'sm')} download>
                  Exportar CSV
                </a>
              ) : undefined
            }
            semPreenchimento
          >
            {dados.total === 0 ? (
              <div className="p-5">
                {filtrando ? (
                  <EstadoVazio
                    titulo="Nenhum contato com esses filtros"
                    explicacao="Tente outra busca ou limpe os filtros."
                    acao={<Link href="/crm/contatos" className={classesBotao('secundario', 'sm')}>Limpar filtros</Link>}
                  />
                ) : (
                  <EstadoVazio
                    titulo="Nenhum contato ainda"
                    explicacao="Cadastre um contato ou importe uma planilha do Excel salva como CSV. Os leads do formulário do site entram aqui quando o webhook for ligado."
                    acao={
                      <>
                        <Link href="/crm/contatos/novo" className={classesBotao('primario', 'sm')}>Novo contato</Link>
                        <Link href="/crm/importar" className={classesBotao('secundario', 'sm')}>Importar planilha</Link>
                      </>
                    }
                  />
                )}
              </div>
            ) : (
              <>
                <Tabela legenda="Contatos" className="rounded-none border-x-0 border-b-0">
                  <thead>
                    <tr>
                      <th scope="col">Nome</th>
                      <th scope="col">E-mail</th>
                      <th scope="col">Escritório</th>
                      <th scope="col">Cidade</th>
                      <th scope="col">Status</th>
                      <th scope="col">Origem</th>
                      <th scope="col">Tags</th>
                      <th scope="col">Atualizado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dados.itens.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/crm/contatos/${c.id}`} className="font-medium text-acento-texto underline-offset-2 hover:underline">
                            {c.nome || <span className="italic">(sem nome)</span>}
                          </Link>
                        </td>
                        <td className="break-all">{c.email}</td>
                        <td>{c.escritorio ?? '—'}</td>
                        <td className="whitespace-nowrap">{c.cidade ? `${c.cidade}${c.uf ? `/${c.uf}` : ''}` : (c.uf ?? '—')}</td>
                        <td><SeloStatus status={c.status} /></td>
                        <td>{ROTULO_ORIGEM[c.origem]}</td>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {c.tags.slice(0, 3).map((t) => <Selo key={t}>{t}</Selo>)}
                            {c.tags.length > 3 && <span className="text-xs text-tinta-suave">+{c.tags.length - 3}</span>}
                          </span>
                        </td>
                        <td className="whitespace-nowrap text-tinta-suave">{formatarQuando(c.atualizadoEm)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Tabela>
                <Paginacao f={f} total={dados.total} />
              </>
            )}
          </Cartao>
        </>
      )}
    </div>
  )
}
