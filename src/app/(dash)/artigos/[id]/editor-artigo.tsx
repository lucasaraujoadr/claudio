'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Aviso, Botao, BotaoEnviar, Cartao, IconeTom, Selo, cx, type Tom } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import type { ItemConferencia } from '@/lib/artigos/conferencia'
import { ROTULO_WP, linkSeguro } from '../situacao'
import { Contador } from './contador'
import { formatarBrasilia, isoParaLocal, localParaIso } from './datas'
import { MarcaVerificar } from './marca-verificar'
import { paraTela, semBloqueio, type ArtigoTela } from './tipos'

export type EditorArtigoProps = {
  inicial: ArtigoTela
  wpConfigurado: boolean
  iaConfigurada: boolean
  brevoConfigurado: boolean
  categorias: { id: number; nome: string }[]
  /** Aviso quando as categorias não puderam ser lidas do WordPress. */
  avisoCategorias?: string | null
}

type Patch = Partial<{
  titulo: string
  slug: string
  metaDescription: string
  conteudoHtml: string
  categoriaId: number | null
  revisado: boolean
  agendadoPara: string | null
}>

type EstadoSalvo = 'salvo' | 'pendente' | 'salvando' | 'erro'
type Modo = 'rascunho' | 'agendar' | 'publicar'

type Resultado =
  | { tipo: 'ok'; link: string; metaGravada: boolean }
  | { tipo: 'bloqueado'; itens: ItemConferencia[] }
  | { tipo: 'conflito'; modo: Modo }
  | { tipo: 'erro'; mensagem: string; modo: Modo | null }

const ESPERA_SALVAR_MS = 1500

const ROTULO_SALVO: Record<EstadoSalvo, string> = {
  salvo: 'salvo',
  pendente: 'alterações não salvas',
  salvando: 'salvando…',
  erro: 'erro ao salvar',
}

const TOM_NIVEL: Record<ItemConferencia['nivel'], { tom: Tom; rotulo: string; cor: string }> = {
  ok: { tom: 'sucesso', rotulo: 'ok', cor: 'text-sucesso' },
  aviso: { tom: 'aviso', rotulo: 'aviso', cor: 'text-aviso' },
  bloqueia: { tom: 'critico', rotulo: 'bloqueia', cor: 'text-critico' },
}

/** Tipografia do artigo, no editor e na pré-visualização. "Verificar" é o destaque amarelo. */
const CLASSES_TEXTO = cx(
  'space-y-3 text-[0.95rem] leading-relaxed text-tinta',
  '[&_h2]:mt-6 [&_h2]:font-titulo [&_h2]:text-xl [&_h2]:font-semibold',
  '[&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-semibold',
  '[&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6',
  '[&_blockquote]:border-l-4 [&_blockquote]:border-acento [&_blockquote]:pl-4 [&_blockquote]:text-tinta-suave',
  '[&_a]:text-acento-texto [&_a]:underline [&_a]:break-words',
  '[&_mark]:rounded-sm [&_mark]:bg-aviso-fundo [&_mark]:px-0.5 [&_mark]:text-tinta [&_mark]:outline [&_mark]:outline-1 [&_mark]:outline-aviso-borda',
)

/** Tira as marcas "verificar" do HTML que o servidor já sanitizou: é o que vai para o site. */
function semMarcas(html: string): string {
  if (typeof DOMParser === 'undefined') return ''
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  doc.querySelectorAll('mark').forEach((m) => m.replaceWith(...Array.from(m.childNodes)))
  return doc.body.innerHTML
}

function urlDeLinkValida(url: string): boolean {
  return /^https?:\/\/\S+$/i.test(url) || /^#\S*$/.test(url)
}

async function lerJson(r: Response): Promise<unknown> {
  try {
    return await r.json()
  } catch {
    return null
  }
}

function ehVisao(v: unknown): v is Parameters<typeof paraTela>[0] {
  return typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'number' && 'conferencia' in v
}

export function EditorArtigo({
  inicial,
  wpConfigurado,
  iaConfigurada,
  brevoConfigurado,
  categorias,
  avisoCategorias,
}: EditorArtigoProps) {
  const id = inicial.id
  const [visao, setVisao] = useState<ArtigoTela>(inicial)
  const [titulo, setTitulo] = useState(inicial.titulo ?? '')
  const [slug, setSlug] = useState(inicial.slug ?? '')
  const [meta, setMeta] = useState(inicial.metaDescription ?? '')
  const [categoriaId, setCategoriaId] = useState<number | null>(inicial.categoriaId)
  const [revisado, setRevisado] = useState(inicial.revisado)
  const [agendadoLocal, setAgendadoLocal] = useState(isoParaLocal(inicial.agendadoPara))
  const [aba, setAba] = useState<'editor' | 'previa'>('editor')

  // --- Salvamento automático -------------------------------------------------------------
  const [estado, setEstado] = useState<EstadoSalvo>('salvo')
  const pendente = useRef<Patch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const emVoo = useRef<Promise<boolean> | null>(null)

  const salvar = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    while (emVoo.current) await emVoo.current
    const patch = pendente.current
    if (Object.keys(patch).length === 0) return true
    pendente.current = {}
    setEstado('salvando')
    const p = (async () => {
      try {
        const r = await fetch(`/api/artigos/${id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const json = await lerJson(r)
        if (!r.ok || !ehVisao(json)) throw new Error('falha')
        const v = paraTela(json)
        setVisao(v)
        // O servidor normaliza o slug; só aplica se ninguém digitou outro nesse meio-tempo.
        if (patch.slug !== undefined && pendente.current.slug === undefined) setSlug(v.slug ?? '')
        return true
      } catch {
        pendente.current = { ...patch, ...pendente.current }
        return false
      } finally {
        emVoo.current = null
      }
    })()
    emVoo.current = p
    const ok = await p
    setEstado(ok ? (Object.keys(pendente.current).length > 0 ? 'pendente' : 'salvo') : 'erro')
    return ok
  }, [id])

  const alterar = useCallback(
    (patch: Patch, imediato = false) => {
      pendente.current = { ...pendente.current, ...patch }
      setEstado('pendente')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void salvar(), imediato ? 0 : ESPERA_SALVAR_MS)
    },
    [salvar],
  )

  // Ao sair da tela (navegação interna) com edição pendente, grava com keepalive em vez de perder.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
      const patch = pendente.current
      if (Object.keys(patch).length === 0) return
      pendente.current = {}
      void fetch(`/api/artigos/${id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
        keepalive: true,
      }).catch(() => {})
    },
    [id],
  )

  // Sair da página com alteração não salva: o navegador pergunta (nada de confirm()).
  useEffect(() => {
    if (estado === 'salvo') return
    const antes = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', antes)
    return () => window.removeEventListener('beforeunload', antes)
  }, [estado])

  // --- Editor ---------------------------------------------------------------------------
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        strike: false,
        underline: false,
        horizontalRule: false,
        link: { openOnClick: false, autolink: false, protocols: ['http', 'https'], HTMLAttributes: { rel: null, target: null } },
      }),
      MarcaVerificar,
    ],
    content: inicial.conteudoHtml ?? '',
    editorProps: {
      attributes: {
        class: cx(CLASSES_TEXTO, 'min-h-96 px-5 py-4 focus:outline-none'),
        'aria-label': 'Conteúdo do artigo',
      },
    },
    onUpdate: ({ editor: e }) => alterar({ conteudoHtml: e.getHTML() }),
  })

  // --- Envio ----------------------------------------------------------------------------
  const [enviando, setEnviando] = useState<Modo | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)

  const recarregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/artigos/${id}`)
      const json = await lerJson(r)
      if (r.ok && ehVisao(json)) setVisao(paraTela(json))
    } catch {
      // A tela continua com a última visão; o próximo salvamento atualiza.
    }
  }, [id])

  const enviar = useCallback(
    async (modo: Modo, sobrescrever = false) => {
      setConfirmando(false)
      setResultado(null)
      setEnviando(modo)
      try {
        if (!(await salvar())) {
          setResultado({ tipo: 'erro', mensagem: 'Não foi possível salvar as alterações; nada foi enviado.', modo })
          return
        }
        const r = await fetch(`/api/artigos/${id}/enviar`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(sobrescrever ? { modo, sobrescrever: true } : { modo }),
        })
        const json = (await lerJson(r)) as { tipo?: string; link?: string; metaGravada?: boolean; itens?: ItemConferencia[]; mensagem?: string } | null
        if (json?.tipo === 'ok') {
          setResultado({ tipo: 'ok', link: String(json.link ?? ''), metaGravada: json.metaGravada !== false })
          await recarregar()
        } else if (json?.tipo === 'bloqueado') {
          setResultado({ tipo: 'bloqueado', itens: Array.isArray(json.itens) ? json.itens : [] })
        } else if (json?.tipo === 'conflito') {
          setResultado({ tipo: 'conflito', modo })
        } else {
          setResultado({ tipo: 'erro', mensagem: json?.mensagem || 'O envio falhou. Tente de novo.', modo })
          await recarregar()
        }
      } catch {
        setResultado({ tipo: 'erro', mensagem: 'Sem resposta do servidor. Confira a conexão e tente de novo.', modo })
      } finally {
        setEnviando(null)
      }
    },
    [id, salvar, recarregar],
  )

  // --- Capa -----------------------------------------------------------------------------
  const [capaEstado, setCapaEstado] = useState<{ enviando: boolean; erro: string | null }>({ enviando: false, erro: null })
  async function enviarCapa(arquivo: File) {
    setCapaEstado({ enviando: true, erro: null })
    try {
      const corpo = new FormData()
      corpo.append('arquivo', arquivo)
      const r = await fetch(`/api/artigos/${id}/capa`, { method: 'POST', body: corpo })
      const json = (await lerJson(r)) as { erro?: string } | null
      if (!r.ok) {
        setCapaEstado({ enviando: false, erro: json?.erro || 'Não foi possível enviar a capa.' })
        return
      }
      setCapaEstado({ enviando: false, erro: null })
      await recarregar()
    } catch {
      setCapaEstado({ enviando: false, erro: 'Sem resposta do servidor. Tente de novo.' })
    }
  }

  // --- Derivados ------------------------------------------------------------------------
  const publicado = visao.wpStatus === 'publish'
  const livre = semBloqueio(visao.conferencia)
  const bloqueiaRascunho = visao.conferencia.some((i) => i.nivel === 'bloqueia' && (i.id === 'titulo_vazio' || i.id === 'slug'))
  const travado = !wpConfigurado || enviando !== null
  const alterado = visao.alteradoAposEnvio
  const rotuloRascunho = visao.wpStatus === 'draft' && alterado ? 'Atualizar rascunho no site' : 'Enviar como rascunho'
  const rotuloAgendar = visao.wpStatus === 'future' && alterado ? 'Atualizar agendamento' : 'Agendar'
  const rotuloPublicar = publicado ? 'Atualizar no site' : 'Publicar agora'
  const rotuloConfirmar = publicado ? 'Confirmar atualização' : 'Confirmar publicação'
  const wpLink = linkSeguro(visao.wpLink)
  const capaUrl = linkSeguro(visao.capaUrl)
  const ids = { titulo: useId(), slug: useId(), meta: useId(), categoria: useId(), capa: useId(), agendar: useId() }

  const temCategoriaAtual = categoriaId === null || categorias.some((c) => c.id === categoriaId)

  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* Coluna principal: editor e pré-visualização */}
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="tablist" aria-label="Modo de exibição" className="inline-flex rounded-md border border-borda bg-superficie p-0.5">
            {(
              [
                ['editor', 'Editor'],
                ['previa', 'Pré-visualização'],
              ] as const
            ).map(([valor, rotulo]) => (
              <button
                key={valor}
                type="button"
                role="tab"
                aria-selected={aba === valor}
                onClick={() => setAba(valor)}
                className={cx(
                  'h-8 rounded px-3 text-sm',
                  aba === valor ? 'bg-acento-suave font-semibold text-tinta' : 'text-tinta-suave hover:text-tinta',
                )}
              >
                {rotulo}
              </button>
            ))}
          </div>
          <IndicadorSalvo estado={estado} aoTentar={() => void salvar()} />
        </div>

        <div hidden={aba !== 'editor'} className="min-w-0 rounded-xl border border-borda bg-superficie shadow-cartao">
          <BarraEditor editor={editor} artigoId={id} iaConfigurada={iaConfigurada} />
          <EditorContent editor={editor} />
        </div>

        {aba === 'previa' && (
          <div className="min-w-0 rounded-xl border border-borda bg-superficie shadow-cartao">
            <p className="border-b border-borda px-5 py-2 text-xs text-tinta-suave">
              Como vai para o site: a última versão salva, sem as marcas de &ldquo;verificar&rdquo;.
              {estado !== 'salvo' && ' Há alterações que ainda não foram salvas.'}
            </p>
            <div
              className={cx(CLASSES_TEXTO, 'px-5 py-4')}
              // HTML sanitizado pelo servidor (lista branca) na última resposta da rota; só as marcas saem aqui.
              dangerouslySetInnerHTML={{ __html: semMarcas(visao.conteudoHtml ?? '') }}
            />
          </div>
        )}
      </div>

      {/* Coluna lateral */}
      <aside className="min-w-0 space-y-4" aria-label="Dados do post e envio">
        <Cartao titulo="SEO" nivelTitulo={2}>
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={ids.titulo} className={CLASSES_ROTULO}>
                  Título SEO
                </label>
                <Contador valor={titulo.trim().length} min={1} max={60} />
              </div>
              <input
                id={ids.titulo}
                value={titulo}
                maxLength={300}
                onChange={(e) => {
                  setTitulo(e.target.value)
                  alterar({ titulo: e.target.value })
                }}
                className={classesCampo('mt-1')}
              />
              <p className="mt-1 text-xs text-tinta-suave">Ideal: até 60 caracteres.</p>
            </div>
            <div>
              <label htmlFor={ids.slug} className={CLASSES_ROTULO}>
                Endereço (slug)
              </label>
              <input
                id={ids.slug}
                value={slug}
                maxLength={200}
                onChange={(e) => {
                  setSlug(e.target.value)
                  alterar({ slug: e.target.value })
                }}
                className={classesCampo('mt-1 font-mono text-xs')}
              />
              <p className="mt-1 text-xs text-tinta-suave">Só letras minúsculas, números e hífens; acentos e espaços são ajustados ao salvar.</p>
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={ids.meta} className={CLASSES_ROTULO}>
                  Meta description
                </label>
                <Contador valor={meta.trim().length} min={120} max={155} />
              </div>
              <textarea
                id={ids.meta}
                value={meta}
                rows={4}
                maxLength={500}
                onChange={(e) => {
                  setMeta(e.target.value)
                  alterar({ metaDescription: e.target.value })
                }}
                className={classesCampo('mt-1')}
              />
              <p className="mt-1 text-xs text-tinta-suave">Ideal: de 120 a 155 caracteres.</p>
            </div>
            <div>
              <label htmlFor={ids.categoria} className={CLASSES_ROTULO}>
                Categoria
              </label>
              <select
                id={ids.categoria}
                value={categoriaId === null ? '' : String(categoriaId)}
                onChange={(e) => {
                  const v = e.target.value === '' ? null : Number(e.target.value)
                  setCategoriaId(v)
                  alterar({ categoriaId: v }, true)
                }}
                className={classesCampo('mt-1')}
              >
                <option value="">Sem categoria</option>
                {!temCategoriaAtual && <option value={String(categoriaId)}>Categoria {categoriaId}</option>}
                {categorias.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.nome || `Categoria ${c.id}`}
                  </option>
                ))}
              </select>
              {avisoCategorias && <p className="mt-1 text-xs text-aviso">{avisoCategorias}</p>}
            </div>
            <div>
              <label htmlFor={ids.capa} className={CLASSES_ROTULO}>
                Imagem de capa
              </label>
              {capaUrl && (
                // Mídia do WordPress: endereço externo, sem otimização do Next.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={capaUrl} alt="Capa atual do artigo" className="mt-2 aspect-video w-full rounded-md border border-borda object-cover" />
              )}
              <input
                id={ids.capa}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={!wpConfigurado || capaEstado.enviando}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  e.target.value = ''
                  if (f) void enviarCapa(f)
                }}
                className="mt-2 block w-full min-w-0 text-sm text-tinta-suave file:mr-3 file:rounded-md file:border file:border-borda-forte file:bg-superficie file:px-3 file:py-1.5 file:text-sm file:text-tinta"
              />
              <p className="mt-1 text-xs text-tinta-suave" role="status">
                {capaEstado.enviando ? 'Enviando a capa ao WordPress…' : 'JPEG, PNG ou WebP, até 4 MB. Sobe para a mídia do WordPress.'}
              </p>
              {capaEstado.erro && <p className="mt-1 text-xs font-medium text-critico" role="alert">{capaEstado.erro}</p>}
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Conferência" descricao={`Palavra-chave: ${visao.keyword || '—'}`}>
          <ul className="space-y-2 text-sm">
            {visao.conferencia.map((i) => (
              <li key={i.id} className="flex gap-2">
                <span className={cx('mt-0.5 shrink-0', TOM_NIVEL[i.nivel].cor)}>
                  <IconeTom tom={TOM_NIVEL[i.nivel].tom} className="size-4" />
                </span>
                <span className={cx('min-w-0', i.nivel === 'ok' ? 'text-tinta-suave' : 'text-tinta')}>
                  <span className="sr-only">{TOM_NIVEL[i.nivel].rotulo}: </span>
                  {i.texto}
                </span>
              </li>
            ))}
          </ul>
        </Cartao>

        {visao.fontes.length > 0 && (
          <Cartao titulo="Fontes da pesquisa">
            <ul className="space-y-1.5 text-sm">
              {visao.fontes.map((f, n) => {
                const href = linkSeguro(f.url)
                return (
                  <li key={`${f.url}-${n}`} className="break-words">
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer" className="text-acento-texto underline-offset-2 hover:underline">
                        {f.titulo?.trim() || href}
                        <span className="sr-only"> (abre em nova aba)</span>
                      </a>
                    ) : (
                      <span className="text-tinta-suave">{f.titulo || f.url}</span>
                    )}
                  </li>
                )
              })}
            </ul>
          </Cartao>
        )}

        <Cartao titulo="Envio ao site">
          <div className="space-y-4">
            {visao.wpStatus && (
              <div className="space-y-1 text-sm">
                <p className="flex flex-wrap items-center gap-2">
                  <Selo variante={publicado ? 'sucesso' : 'info'}>{ROTULO_WP[visao.wpStatus] ?? visao.wpStatus}</Selo>
                  {alterado && <Selo variante="aviso">Alterado após o envio</Selo>}
                </p>
                {visao.wpStatus === 'future' && visao.agendadoPara && (
                  <p className="text-tinta-suave">Agendado para {formatarBrasilia(visao.agendadoPara)}</p>
                )}
                {wpLink && (
                  <a href={wpLink} target="_blank" rel="noopener noreferrer" className="font-medium break-all text-acento-texto underline-offset-2 hover:underline">
                    {publicado ? 'Ver no site' : 'Abrir prévia no WordPress'}
                    <span className="sr-only"> (abre em nova aba)</span>
                  </a>
                )}
                {alterado && <p className="text-tinta-suave">Há alterações no painel que ainda não foram para o site.</p>}
              </div>
            )}

            {visao.erro && !resultado && (
              <Aviso tipo="erro" titulo="O último envio falhou">
                {visao.erro}
              </Aviso>
            )}

            <label className="flex items-start gap-2 text-sm text-tinta">
              <input
                type="checkbox"
                checked={revisado}
                onChange={(e) => {
                  setRevisado(e.target.checked)
                  alterar({ revisado: e.target.checked }, true)
                }}
                className="mt-0.5 size-4 accent-acento"
              />
              <span>
                Revisei o conteúdo
                <span className="block text-xs text-tinta-suave">Obrigatório para agendar ou publicar.</span>
              </span>
            </label>

            {!publicado && (
              <div>
                <label htmlFor={ids.agendar} className={CLASSES_ROTULO}>
                  Data e hora do agendamento
                </label>
                <input
                  id={ids.agendar}
                  type="datetime-local"
                  value={agendadoLocal}
                  onChange={(e) => {
                    setAgendadoLocal(e.target.value)
                    alterar({ agendadoPara: e.target.value ? localParaIso(e.target.value) : null })
                  }}
                  className={classesCampo('mt-1')}
                />
                <p className="mt-1 text-xs text-tinta-suave">Horário de Brasília. Ao menos 5 minutos à frente.</p>
              </div>
            )}

            {!wpConfigurado && (
              <Aviso tipo="alerta" role={null}>
                WordPress não configurado. Gerar e editar continuam funcionando; o envio precisa de WP_USUARIO e WP_SENHA_APP.
              </Aviso>
            )}

            <div className="flex flex-col gap-2">
              {!publicado && (
                <>
                  <BotaoAcao rotulo={rotuloRascunho} ocupado={enviando === 'rascunho'} disabled={travado || bloqueiaRascunho} variante="primario" onClick={() => void enviar('rascunho')} />
                  <BotaoAcao
                    rotulo={rotuloAgendar}
                    ocupado={enviando === 'agendar'}
                    disabled={travado || !livre || !agendadoLocal}
                    onClick={() => void enviar('agendar')}
                  />
                </>
              )}
              {!confirmando ? (
                <BotaoAcao
                  rotulo={rotuloPublicar}
                  ocupado={enviando === 'publicar'}
                  disabled={travado || !livre}
                  variante={publicado ? 'primario' : 'secundario'}
                  onClick={() => {
                    setResultado(null)
                    setConfirmando(true)
                  }}
                />
              ) : (
                <div className="space-y-2 rounded-lg border border-acento/50 bg-acento-suave p-3" role="group" aria-label="Confirmar envio">
                  <p className="text-sm text-tinta">
                    {publicado
                      ? 'O post no ar será substituído por esta versão. Confirma?'
                      : 'O artigo fica visível para todos no site agora. Confirma?'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Botao onClick={() => void enviar('publicar')} disabled={travado || !livre}>
                      {rotuloConfirmar}
                    </Botao>
                    <Botao variante="fantasma" onClick={() => setConfirmando(false)}>
                      Cancelar
                    </Botao>
                  </div>
                </div>
              )}
              {!livre && wpConfigurado && (
                <p className="text-xs text-tinta-suave">Agendar e publicar ficam liberados quando a conferência não tiver nenhum item que bloqueia.</p>
              )}
            </div>

            <ResultadoEnvio
              resultado={resultado}
              aoSobrescrever={(modo) => void enviar(modo, true)}
              aoTentar={(modo) => void enviar(modo)}
              aoFechar={() => setResultado(null)}
            />

            {publicado && brevoConfigurado && (
              <form method="POST" action="/api/temas/campanha" className="space-y-1 border-t border-borda pt-4">
                <input type="hidden" name="id" value={visao.topicId} />
                <BotaoEnviar rotuloEnviando="Criando rascunho…" variante="secundario">
                  Criar campanha no Brevo
                </BotaoEnviar>
                <p className="text-xs text-tinta-suave">Cria só o rascunho da campanha; o envio é feito por você, no Brevo.</p>
              </form>
            )}
          </div>
        </Cartao>
      </aside>
    </div>
  )
}

function IndicadorSalvo({ estado, aoTentar }: { estado: EstadoSalvo; aoTentar: () => void }) {
  return (
    <p role="status" aria-live="polite" className="flex items-center gap-2 text-xs">
      <span
        className={cx(
          estado === 'erro' ? 'font-semibold text-critico' : estado === 'salvo' ? 'text-sucesso' : 'text-tinta-suave',
        )}
      >
        {ROTULO_SALVO[estado]}
      </span>
      {estado === 'erro' && (
        <Botao tamanho="sm" variante="secundario" onClick={aoTentar}>
          Tentar salvar de novo
        </Botao>
      )}
    </p>
  )
}

function BotaoAcao({
  rotulo,
  ocupado,
  disabled,
  variante = 'secundario',
  onClick,
}: {
  rotulo: string
  ocupado: boolean
  disabled: boolean
  variante?: 'primario' | 'secundario'
  onClick: () => void
}) {
  return (
    <Botao variante={variante} disabled={disabled} aria-busy={ocupado} onClick={onClick} aria-label={rotulo}>
      {ocupado ? 'Enviando…' : rotulo}
    </Botao>
  )
}

function ResultadoEnvio({
  resultado,
  aoSobrescrever,
  aoTentar,
  aoFechar,
}: {
  resultado: Resultado | null
  aoSobrescrever: (modo: Modo) => void
  aoTentar: (modo: Modo) => void
  aoFechar: () => void
}) {
  if (!resultado) return null
  if (resultado.tipo === 'ok') {
    const link = linkSeguro(resultado.link)
    return (
      <div className="space-y-2">
        <Aviso tipo="sucesso" titulo="Enviado ao WordPress">
          {link ? (
            <a href={link} target="_blank" rel="noopener noreferrer" className="break-all">
              {link}
            </a>
          ) : (
            'O post foi gravado.'
          )}
        </Aviso>
        {!resultado.metaGravada && (
          <Aviso tipo="alerta" role={null}>
            A meta description foi para o resumo do post; libere o campo no WP para gravar direto.
          </Aviso>
        )}
      </div>
    )
  }
  if (resultado.tipo === 'bloqueado') {
    const itens = resultado.itens.filter((i) => i.nivel === 'bloqueia')
    return (
      <Aviso tipo="erro" titulo="Envio bloqueado">
        <ul className="list-disc space-y-0.5 pl-4">
          {itens.map((i) => (
            <li key={i.id}>{i.texto}</li>
          ))}
        </ul>
      </Aviso>
    )
  }
  if (resultado.tipo === 'conflito') {
    const modo = resultado.modo
    return (
      <Aviso tipo="alerta" titulo="Este post foi editado no WordPress depois do último envio.">
        <p>Sobrescrever troca o que está no WordPress por esta versão do painel.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Botao variante="perigo" tamanho="sm" onClick={() => aoSobrescrever(modo)}>
            Sobrescrever mesmo assim
          </Botao>
          <Botao variante="fantasma" tamanho="sm" onClick={aoFechar}>
            Cancelar
          </Botao>
        </div>
      </Aviso>
    )
  }
  const modo = resultado.modo
  return (
    <Aviso
      tipo="erro"
      titulo="O envio não foi concluído"
      acao={
        modo ? (
          <Botao variante="secundario" tamanho="sm" onClick={() => aoTentar(modo)}>
            Tentar de novo
          </Botao>
        ) : undefined
      }
    >
      {resultado.mensagem} Nada foi marcado como enviado.
    </Aviso>
  )
}

// --- Barra de ferramentas --------------------------------------------------------------

type PainelBarra = null | 'link' | 'reescrever'

function BarraEditor({ editor, artigoId, iaConfigurada }: { editor: Editor | null; artigoId: number; iaConfigurada: boolean }) {
  const ativo = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            p: e.isActive('paragraph'),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            negrito: e.isActive('bold'),
            italico: e.isActive('italic'),
            lista: e.isActive('bulletList'),
            numerada: e.isActive('orderedList'),
            citacao: e.isActive('blockquote'),
            link: e.isActive('link'),
            verificar: e.isActive('verificar'),
            motivo: String(e.getAttributes('verificar').motivo ?? ''),
          }
        : null,
  })
  const [painel, setPainel] = useState<PainelBarra>(null)
  const [url, setUrl] = useState('')
  const [erroLink, setErroLink] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [pedido, setPedido] = useState<{ de: number; ate: number; trecho: string } | null>(null)
  const [instrucao, setInstrucao] = useState('')
  const [sugestao, setSugestao] = useState<string | null>(null)
  const [pedindo, setPedindo] = useState(false)
  const [erroIa, setErroIa] = useState<string | null>(null)
  const idUrl = useId()
  const idInstrucao = useId()

  const cadeia = () => editor?.chain().focus()

  function abrirLink() {
    if (!editor) return
    setAviso(null)
    setErroLink(null)
    setUrl(String(editor.getAttributes('link').href ?? ''))
    setPainel(painel === 'link' ? null : 'link')
  }

  function aplicarLink() {
    if (!editor) return
    const v = url.trim()
    if (v === '') {
      cadeia()?.extendMarkRange('link').unsetLink().run()
      setPainel(null)
      return
    }
    if (!urlDeLinkValida(v)) {
      setErroLink('Use um endereço que comece com https:// (ou # para âncora).')
      return
    }
    cadeia()?.extendMarkRange('link').setLink({ href: v }).run()
    setPainel(null)
  }

  function abrirReescrever() {
    if (!editor) return
    setAviso(null)
    if (painel === 'reescrever') {
      setPainel(null)
      return
    }
    const { from, to } = editor.state.selection
    const trecho = editor.state.doc.textBetween(from, to, ' ').trim()
    if (!trecho) {
      setAviso('Selecione no texto o trecho que quer reescrever.')
      return
    }
    setPedido({ de: from, ate: to, trecho })
    setSugestao(null)
    setErroIa(null)
    setPainel('reescrever')
  }

  async function pedirSugestao() {
    if (!pedido || !instrucao.trim()) return
    setPedindo(true)
    setErroIa(null)
    try {
      const r = await fetch(`/api/artigos/${artigoId}/reescrever`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trecho: pedido.trecho, instrucao: instrucao.trim() }),
      })
      const json = (await lerJson(r)) as { texto?: string; erro?: string } | null
      if (!r.ok || typeof json?.texto !== 'string' || !json.texto.trim()) {
        setErroIa(json?.erro || 'Não foi possível reescrever o trecho.')
      } else {
        setSugestao(json.texto.trim())
      }
    } catch {
      setErroIa('Sem resposta do servidor. Tente de novo.')
    } finally {
      setPedindo(false)
    }
  }

  function aceitar() {
    if (!editor || !pedido || !sugestao) return
    const atual = editor.state.doc.textBetween(pedido.de, Math.min(pedido.ate, editor.state.doc.content.size), ' ').trim()
    if (atual !== pedido.trecho) {
      setErroIa('O trecho mudou desde o pedido. Selecione de novo e peça outra sugestão.')
      return
    }
    // Entra como texto puro: nada do que a IA devolve é interpretado como HTML.
    editor.chain().focus().insertContentAt({ from: pedido.de, to: pedido.ate }, { type: 'text', text: sugestao }).run()
    fecharReescrever()
  }

  function fecharReescrever() {
    setPainel(null)
    setPedido(null)
    setSugestao(null)
    setInstrucao('')
    setErroIa(null)
  }

  const b = (rotulo: string, pressionado: boolean | undefined, acao: () => void, extra?: { titulo?: string; disabled?: boolean }) => (
    <button
      type="button"
      aria-pressed={pressionado}
      title={extra?.titulo}
      disabled={!editor || extra?.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={acao}
      className={cx(
        'h-8 rounded px-2.5 text-xs font-medium transition-colors disabled:opacity-50',
        pressionado ? 'bg-acento-suave text-tinta' : 'text-tinta-suave hover:bg-elevada hover:text-tinta',
      )}
    >
      {rotulo}
    </button>
  )

  return (
    <div className="border-b border-borda">
      <div role="toolbar" aria-label="Formatação" className="flex flex-wrap items-center gap-0.5 px-2 py-1.5">
        {b('Parágrafo', ativo?.p, () => cadeia()?.setParagraph().run())}
        {b('H2', ativo?.h2, () => cadeia()?.toggleHeading({ level: 2 }).run())}
        {b('H3', ativo?.h3, () => cadeia()?.toggleHeading({ level: 3 }).run())}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-borda" />
        {b('Negrito', ativo?.negrito, () => cadeia()?.toggleBold().run())}
        {b('Itálico', ativo?.italico, () => cadeia()?.toggleItalic().run())}
        {b('Lista', ativo?.lista, () => cadeia()?.toggleBulletList().run())}
        {b('Lista numerada', ativo?.numerada, () => cadeia()?.toggleOrderedList().run())}
        {b('Citação', ativo?.citacao, () => cadeia()?.toggleBlockquote().run())}
        {b('Link', ativo?.link || painel === 'link', abrirLink)}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-borda" />
        {b('Verificar', undefined, () => cadeia()?.extendMarkRange('verificar').unsetMark('verificar').run(), {
          titulo: 'Marca o trecho como verificado: tira o destaque amarelo',
          disabled: !ativo?.verificar,
        })}
        {b('Reescrever trecho', painel === 'reescrever', abrirReescrever, {
          titulo: iaConfigurada ? 'Selecione um trecho e peça à IA uma nova versão' : 'IA não configurada',
          disabled: !iaConfigurada,
        })}
      </div>

      {ativo?.verificar && (
        <p className="border-t border-borda bg-aviso-fundo px-4 py-1.5 text-xs text-tinta">
          <span className="font-semibold">Verificar:</span> {ativo.motivo || 'confira este trecho antes de publicar.'} Depois de conferir, use &ldquo;Verificar&rdquo;.
        </p>
      )}
      {aviso && (
        <p role="status" className="border-t border-borda px-4 py-1.5 text-xs text-tinta-suave">
          {aviso}
        </p>
      )}

      {painel === 'link' && (
        <div className="flex flex-wrap items-end gap-2 border-t border-borda px-4 py-3">
          <div className="min-w-0 flex-1">
            <label htmlFor={idUrl} className="text-xs font-medium text-tinta">
              Endereço do link
            </label>
            <input
              id={idUrl}
              type="url"
              value={url}
              placeholder="https://"
              aria-invalid={erroLink ? true : undefined}
              onChange={(e) => {
                setUrl(e.target.value)
                setErroLink(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  aplicarLink()
                }
              }}
              className={classesCampo('mt-1 h-8 py-1')}
            />
            {erroLink && <p className="mt-1 text-xs text-critico">{erroLink}</p>}
          </div>
          <Botao tamanho="sm" onClick={aplicarLink}>
            Aplicar link
          </Botao>
          {ativo?.link && (
            <Botao
              tamanho="sm"
              variante="secundario"
              onClick={() => {
                cadeia()?.extendMarkRange('link').unsetLink().run()
                setPainel(null)
              }}
            >
              Remover link
            </Botao>
          )}
          <Botao tamanho="sm" variante="fantasma" onClick={() => setPainel(null)}>
            Fechar
          </Botao>
        </div>
      )}

      {painel === 'reescrever' && pedido && (
        <div className="space-y-2 border-t border-borda px-4 py-3">
          <p className="line-clamp-3 text-xs text-tinta-suave">
            <span className="font-semibold text-tinta">Trecho:</span> {pedido.trecho}
          </p>
          <label htmlFor={idInstrucao} className="block text-xs font-medium text-tinta">
            O que mudar
          </label>
          <input
            id={idInstrucao}
            value={instrucao}
            maxLength={500}
            placeholder="Ex.: deixe mais curto e direto"
            onChange={(e) => setInstrucao(e.target.value)}
            className={classesCampo('h-8 py-1')}
          />
          <div className="flex flex-wrap gap-2">
            <Botao tamanho="sm" onClick={() => void pedirSugestao()} disabled={pedindo || !instrucao.trim()} aria-busy={pedindo}>
              {pedindo ? 'Reescrevendo…' : 'Pedir sugestão'}
            </Botao>
            <Botao tamanho="sm" variante="fantasma" onClick={fecharReescrever}>
              Fechar
            </Botao>
          </div>
          {erroIa && (
            <p role="alert" className="text-xs font-medium text-critico">
              {erroIa}
            </p>
          )}
          {sugestao && (
            <div className="space-y-2 rounded-md border border-borda bg-elevada p-3">
              <p className="text-xs font-semibold text-tinta">Sugestão</p>
              <p className="text-sm whitespace-pre-wrap text-tinta">{sugestao}</p>
              <div className="flex flex-wrap gap-2">
                <Botao tamanho="sm" onClick={aceitar}>
                  Aceitar
                </Botao>
                <Botao tamanho="sm" variante="secundario" onClick={() => setSugestao(null)}>
                  Descartar
                </Botao>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

