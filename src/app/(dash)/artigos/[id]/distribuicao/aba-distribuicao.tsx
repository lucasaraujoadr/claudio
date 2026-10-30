'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useId, useState, type ReactNode } from 'react'
import { Aviso, Botao, Cartao, Selo, cx } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import type { TipoPeca } from '@/lib/distribuicao/schemas'
import { formatarBrasilia } from '../datas'
import { linkSeguro } from '../../situacao'
import { IndicadorSalvo } from './comuns'
import {
  EditorCarrossel,
  EditorLinkedinArtigo,
  EditorNewsletter,
  EditorPost,
  ehCarrossel,
  ehLinkedinArtigo,
  ehNewsletter,
  ehPost,
} from './editores'
import {
  ORDEM_TIPOS,
  ROTULO_TIPO,
  SELO_PECA,
  ehPeca,
  envioParaTela,
  erroDe,
  lerJson,
  pecaParaTela,
  type EnvioTela,
  type Limites,
  type NewsletterTela,
  type PecaTela,
} from './tipos'
import { useSalvarPeca, type EstadoSalvo } from './usar-salvar-peca'

export type AbaDistribuicaoProps = {
  artigoId: number
  pecas: PecaTela[]
  /** Motivo de o artigo não poder gerar peças (situação ou trechos "verificar"), na frase da rota. */
  bloqueio: string | null
  iaConfigurada: boolean
  limites: Limites
  newsletter: NewsletterTela
}

type ResultadoTipo = { resultado: 'ok' | 'erro' | 'em_andamento'; ajustes: string[] }
export type ResultadoGeracao = { ok: true; pecas: Partial<Record<TipoPeca, ResultadoTipo>> } | { ok: false; erro: string }

const ROTULO_RESULTADO: Record<ResultadoTipo['resultado'], string> = {
  ok: 'gerada',
  erro: 'falhou — tente “Regerar”',
  em_andamento: 'não gerada agora (já estava sendo gerada ou está publicada)',
}

const contatos = (n: number) => (n === 1 ? '1 contato' : `${n} contatos`)

function lerResultado(json: unknown): Partial<Record<TipoPeca, ResultadoTipo>> {
  const bruto = (json as { pecas?: unknown } | null)?.pecas
  const saida: Partial<Record<TipoPeca, ResultadoTipo>> = {}
  if (typeof bruto !== 'object' || bruto === null) return saida
  for (const t of ORDEM_TIPOS) {
    const r = (bruto as Record<string, unknown>)[t] as { resultado?: unknown; ajustes?: unknown } | undefined
    if (!r) continue
    const resultado = r.resultado === 'ok' || r.resultado === 'em_andamento' ? r.resultado : 'erro'
    const ajustes = Array.isArray(r.ajustes) ? r.ajustes.filter((a): a is string => typeof a === 'string') : []
    saida[t] = { resultado, ajustes }
  }
  return saida
}

export function AbaDistribuicao({ artigoId, pecas, bloqueio, iaConfigurada, limites, newsletter }: AbaDistribuicaoProps) {
  const router = useRouter()
  const [gerando, setGerando] = useState<'todas' | TipoPeca | null>(null)
  const [resultado, setResultado] = useState<ResultadoGeracao | null>(null)

  const porTipo = new Map(pecas.map((p) => [p.tipo, p]))
  const faltando = ORDEM_TIPOS.filter((t) => !porTipo.has(t) || porTipo.get(t)?.situacao === 'erro')
  const semIa = iaConfigurada ? null : 'A IA não está configurada (OPENROUTER_API_KEY); sem ela as peças não são geradas.'
  const motivo = bloqueio ?? semIa

  /** A geração é síncrona (1 a 2 minutos): espera a resposta para mostrar os ajustes e depois atualiza a tela. */
  const gerar = useCallback(
    async (alvo: 'todas' | TipoPeca): Promise<ResultadoGeracao> => {
      setGerando(alvo)
      try {
        const r = await fetch(`/api/distribuicao/${artigoId}/gerar`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(alvo === 'todas' ? {} : { tipos: [alvo] }),
        })
        const json = await lerJson(r)
        if (!r.ok) return { ok: false, erro: erroDe(json, 'Não foi possível gerar as peças. Tente de novo.') }
        return { ok: true, pecas: lerResultado(json) }
      } catch {
        return { ok: false, erro: 'Sem resposta do servidor. Confira a conexão e recarregue a página: a geração pode ter terminado.' }
      } finally {
        setGerando(null)
        router.refresh()
      }
    },
    [artigoId, router],
  )

  async function gerarTodas() {
    setResultado(null)
    setResultado(await gerar('todas'))
  }

  return (
    <div className="space-y-6">
      <Cartao
        titulo="Peças de distribuição"
        descricao="LinkedIn (artigo e post), carrossel e newsletter, feitos a partir deste artigo. Revise, copie ou baixe cada peça."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Botao
              onClick={() => void gerarTodas()}
              disabled={motivo !== null || faltando.length === 0 || gerando !== null}
              aria-busy={gerando === 'todas'}
            >
              {gerando === 'todas' ? 'Gerando…' : 'Gerar peças'}
            </Botao>
            {gerando === 'todas' ? (
              <p role="status" className="text-sm text-tinta">
                Gerando as peças… (leva 1 a 2 minutos)
              </p>
            ) : (
              <p className="text-sm text-tinta-suave">
                {motivo === null && faltando.length === 0
                  ? 'Todas as peças já foram geradas. Para refazer uma, use “Regerar” no cartão dela.'
                  : 'Gera só as peças que faltam ou que falharam; as que já existem ficam como estão.'}
              </p>
            )}
          </div>
          {motivo && (
            <Aviso tipo="alerta" role={null}>
              {motivo}
            </Aviso>
          )}
          <ResumoGeracao resultado={resultado} />
        </div>
      </Cartao>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        {ORDEM_TIPOS.map((tipo) => {
          const p = porTipo.get(tipo)
          const largo = tipo === 'carrossel' || tipo === 'newsletter'
          const classe = cx(largo && 'lg:col-span-2')
          return p ? (
            <CartaoPeca
              key={tipo}
              peca={p}
              limites={limites}
              className={classe}
              regerarBloqueado={motivo !== null || gerando !== null}
              gerandoEsta={gerando === tipo}
              aoRegerar={() => gerar(tipo)}
              newsletter={newsletter}
            />
          ) : (
            <Cartao key={tipo} titulo={ROTULO_TIPO[tipo]} acoes={<Selo>Não gerada</Selo>} className={classe}>
              <p className="text-sm text-tinta-suave">Ainda não gerada. Use &ldquo;Gerar peças&rdquo; acima.</p>
            </Cartao>
          )
        })}
      </div>
    </div>
  )
}

function ResumoGeracao({ resultado }: { resultado: ResultadoGeracao | null }) {
  if (!resultado) return null
  if (!resultado.ok) return <Aviso tipo="erro">{resultado.erro}</Aviso>
  const tipos = ORDEM_TIPOS.filter((t) => resultado.pecas[t])
  if (tipos.length === 0) return <Aviso tipo="info">Nada a gerar: todas as peças já existem.</Aviso>
  const limpo = tipos.every((t) => resultado.pecas[t]?.resultado === 'ok' && resultado.pecas[t]?.ajustes.length === 0)
  return (
    <Aviso tipo={limpo ? 'sucesso' : 'alerta'} titulo="Geração concluída">
      <ul className="mt-1 space-y-1">
        {tipos.map((t) => {
          const r = resultado.pecas[t]!
          return (
            <li key={t}>
              <span>
                {ROTULO_TIPO[t]}: {ROTULO_RESULTADO[r.resultado]}
              </span>
              {r.ajustes.length > 0 && (
                <ul className="mt-0.5 list-disc pl-5 text-tinta-suave">
                  {r.ajustes.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </Aviso>
  )
}

function CartaoPeca({
  peca,
  limites,
  className,
  regerarBloqueado,
  gerandoEsta,
  aoRegerar,
  newsletter,
}: {
  peca: PecaTela
  limites: Limites
  className?: string
  regerarBloqueado: boolean
  gerandoEsta: boolean
  aoRegerar: () => Promise<ResultadoGeracao>
  newsletter: NewsletterTela
}) {
  const router = useRouter()
  const tipo = peca.tipo
  // A tela guarda a peça; uma versão mais nova vinda do servidor (regerar, outra aba) substitui e remonta o editor.
  const [atual, setAtual] = useState(peca)
  const [vista, setVista] = useState(peca)
  const [versao, setVersao] = useState(0)
  if (peca !== vista) {
    setVista(peca)
    if (Date.parse(peca.atualizadoEm) > Date.parse(atual.atualizadoEm)) {
      setAtual(peca)
      setVersao((v) => v + 1)
    }
  }

  const salvamento = useSalvarPeca(atual.id, (p) => {
    setAtual(p)
    // A prévia da newsletter é montada no servidor a partir da versão salva.
    if (tipo === 'newsletter') router.refresh()
  })
  const { alterar } = salvamento

  const [confirmandoRegerar, setConfirmandoRegerar] = useState(false)
  const [resultado, setResultado] = useState<ResultadoGeracao | null>(null)
  const [trocandoVariacao, setTrocandoVariacao] = useState(false)
  const [erroAcao, setErroAcao] = useState<string | null>(null)

  async function regerar() {
    setConfirmandoRegerar(false)
    setResultado(null)
    salvamento.descartar()
    setResultado(await aoRegerar())
  }

  async function trocarVariacao(variacao: 'escura' | 'clara') {
    setTrocandoVariacao(true)
    setErroAcao(null)
    try {
      const r = await fetch(`/api/distribuicao/pecas/${atual.id}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ variacao }),
      })
      const json = await lerJson(r)
      if (r.ok && ehPeca(json)) setAtual(pecaParaTela(json))
      else setErroAcao(erroDe(json, 'Não foi possível trocar a variação.'))
    } catch {
      setErroAcao('Sem resposta do servidor. Tente de novo.')
    } finally {
      setTrocandoVariacao(false)
    }
  }

  const publicada = atual.situacao === 'publicado'
  const emGeracao = atual.situacao === 'gerando'
  const selo = SELO_PECA[atual.situacao]
  const c = atual.conteudo

  let editor: ReactNode = <p className="text-sm text-tinta-suave">Esta peça ainda não tem conteúdo. Use &ldquo;Regerar&rdquo;.</p>
  if (tipo === 'linkedin_artigo' && ehLinkedinArtigo(c)) editor = <EditorLinkedinArtigo key={versao} inicial={c} limites={limites} alterar={alterar} />
  else if (tipo === 'linkedin_post' && ehPost(c)) editor = <EditorPost key={versao} inicial={c} limites={limites} alterar={alterar} />
  else if (tipo === 'carrossel' && ehCarrossel(c))
    editor = (
      <EditorCarrossel
        key={versao}
        pecaId={atual.id}
        inicial={c}
        limites={limites}
        variacao={atual.variacao ?? 'escura'}
        versaoArte={Date.parse(atual.atualizadoEm)}
        laminasLongas={salvamento.laminasLongas}
        trocandoVariacao={trocandoVariacao}
        alterar={alterar}
        aoVariacao={(v) => void trocarVariacao(v)}
      />
    )
  else if (tipo === 'newsletter' && ehNewsletter(c))
    editor = (
      <div className="grid min-w-0 gap-6 lg:grid-cols-2">
        <EditorNewsletter key={versao} inicial={c} limites={limites} alterar={alterar} />
        <PreviaNewsletter html={newsletter.previaHtml} pendente={salvamento.estado !== 'salvo'} />
      </div>
    )

  return (
    <Cartao titulo={ROTULO_TIPO[tipo]} acoes={<Selo variante={selo.variante}>{selo.rotulo}</Selo>} className={className}>
      <div className="space-y-4">
        {atual.situacao === 'erro' && (
          <Aviso tipo="erro" titulo="A geração desta peça falhou">
            {atual.erro || 'O modelo não devolveu uma peça válida.'}
          </Aviso>
        )}
        {emGeracao ? (
          <Aviso
            tipo="info"
            acao={
              <Botao variante="secundario" tamanho="sm" onClick={() => router.refresh()}>
                Atualizar
              </Botao>
            }
          >
            Esta peça está sendo gerada. Atualize em 1 a 2 minutos.
          </Aviso>
        ) : (
          <>
            <IndicadorSalvo estado={salvamento.estado} mensagem={salvamento.mensagem} aoTentar={() => void salvamento.salvar()} />
            {editor}
          </>
        )}
        {erroAcao && <Aviso tipo="erro">{erroAcao}</Aviso>}

        {tipo === 'newsletter' && !emGeracao && (
          <AcoesNewsletter
            pecaId={atual.id}
            pecaAtualizadaEm={atual.atualizadoEm}
            conteudoOk={ehNewsletter(c)}
            estadoSalvo={salvamento.estado}
            salvar={salvamento.salvar}
            newsletter={newsletter}
          />
        )}

        <div className="space-y-3 border-t border-borda pt-4">
          <InfoPublicada peca={atual} />
          <div className="flex flex-wrap items-start gap-2">
            {gerandoEsta ? (
              <p role="status" className="flex h-8 items-center text-sm text-tinta">
                Regerando… (leva 1 a 2 minutos)
              </p>
            ) : !confirmandoRegerar ? (
              <Botao
                variante="secundario"
                tamanho="sm"
                disabled={publicada || regerarBloqueado}
                onClick={() => {
                  setResultado(null)
                  setConfirmandoRegerar(true)
                }}
              >
                Regerar
              </Botao>
            ) : null}
            <MarcarPublicada peca={atual} aoMarcar={setAtual} desabilitado={emGeracao || gerandoEsta} />
          </div>
          {publicada && <p className="text-xs text-tinta-suave">Peça publicada não é regerada: o que foi ao ar fica como está.</p>}
          {confirmandoRegerar && !gerandoEsta && (
            <div className="space-y-2 rounded-lg border border-acento/50 bg-acento-suave p-3" role="group" aria-label="Confirmar regerar">
              <p className="text-sm text-tinta">Regerar substitui as edições desta peça. Confirma?</p>
              <div className="flex flex-wrap gap-2">
                <Botao tamanho="sm" onClick={() => void regerar()} disabled={regerarBloqueado}>
                  Confirmar regerar
                </Botao>
                <Botao tamanho="sm" variante="fantasma" onClick={() => setConfirmandoRegerar(false)}>
                  Cancelar
                </Botao>
              </div>
            </div>
          )}
          <ResumoGeracao resultado={resultado} />
        </div>
      </div>
    </Cartao>
  )
}

function InfoPublicada({ peca }: { peca: PecaTela }) {
  if (peca.situacao !== 'publicado') return null
  const link = linkSeguro(peca.urlPublicada)
  return (
    <p className="text-sm text-tinta">
      Publicado{peca.publicadoEm ? ` em ${formatarBrasilia(peca.publicadoEm)}` : ''}
      {link && (
        <>
          {': '}
          <a href={link} target="_blank" rel="noopener noreferrer" className="break-all text-acento-texto underline">
            {link}
          </a>
        </>
      )}
    </p>
  )
}

function MarcarPublicada({ peca, aoMarcar, desabilitado }: { peca: PecaTela; aoMarcar: (p: PecaTela) => void; desabilitado: boolean }) {
  const [aberto, setAberto] = useState(false)
  const [url, setUrl] = useState(peca.urlPublicada ?? '')
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const id = useId()
  const publicada = peca.situacao === 'publicado'

  async function confirmar() {
    const limpa = url.trim()
    if (limpa && !/^https?:\/\/\S+$/i.test(limpa)) {
      setErro('Use um endereço completo, começando com https://.')
      return
    }
    setErro(null)
    setEnviando(true)
    try {
      const r = await fetch(`/api/distribuicao/pecas/${peca.id}/publicada`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: limpa || null }),
      })
      const json = await lerJson(r)
      if (r.ok && ehPeca(json)) {
        aoMarcar(pecaParaTela(json))
        setAberto(false)
      } else {
        setErro(erroDe(json, 'Não foi possível marcar como publicada.'))
      }
    } catch {
      setErro('Sem resposta do servidor. Tente de novo.')
    } finally {
      setEnviando(false)
    }
  }

  if (!aberto) {
    return (
      <Botao variante="secundario" tamanho="sm" disabled={desabilitado} onClick={() => setAberto(true)}>
        {publicada ? 'Editar link publicado' : 'Marcar como publicado'}
      </Botao>
    )
  }
  return (
    <div className="w-full min-w-0 space-y-2 rounded-lg border border-borda p-3" role="group" aria-label="Marcar como publicado">
      <label htmlFor={id} className={CLASSES_ROTULO}>
        URL do post (opcional)
      </label>
      <input
        id={id}
        type="url"
        inputMode="url"
        value={url}
        placeholder="https://www.linkedin.com/…"
        onChange={(e) => setUrl(e.target.value)}
        aria-invalid={erro ? true : undefined}
        className={classesCampo()}
      />
      {erro && (
        <p role="alert" className="text-xs text-critico">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Botao tamanho="sm" onClick={() => void confirmar()} disabled={enviando} aria-busy={enviando}>
          Confirmar publicado
        </Botao>
        <Botao tamanho="sm" variante="fantasma" onClick={() => setAberto(false)}>
          Cancelar
        </Botao>
      </div>
    </div>
  )
}

function PreviaNewsletter({ html, pendente }: { html: string | null; pendente: boolean }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={CLASSES_ROTULO}>Prévia do email</span>
        <span className="text-xs text-tinta-suave">{pendente ? 'Última versão salva; a prévia muda depois de salvar.' : 'Última versão salva.'}</span>
      </p>
      {html ? (
        // sandbox vazio: o HTML do email não roda script, não abre janela nem navega a página.
        <iframe title="Prévia da newsletter" sandbox="" srcDoc={html} className="h-[36rem] w-full rounded-md border border-borda bg-white" />
      ) : (
        <p className="rounded-md border border-borda p-4 text-sm text-tinta-suave">Prévia indisponível: a newsletter salva está incompleta.</p>
      )}
    </div>
  )
}

function AcoesNewsletter({
  pecaId,
  pecaAtualizadaEm,
  conteudoOk,
  estadoSalvo,
  salvar,
  newsletter,
}: {
  pecaId: number
  pecaAtualizadaEm: string
  conteudoOk: boolean
  estadoSalvo: EstadoSalvo
  salvar: () => Promise<boolean>
  newsletter: NewsletterTela
}) {
  const router = useRouter()
  const [envio, setEnvio] = useState<EnvioTela | null>(newsletter.envio)
  const [vista, setVista] = useState(newsletter.envio)
  if (newsletter.envio !== vista) {
    setVista(newsletter.envio)
    setEnvio(newsletter.envio)
  }
  const [ocupado, setOcupado] = useState<'rascunho' | 'enviar' | null>(null)
  const [confirmando, setConfirmando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null)

  const { destinatarios, resendConfigurado, acessoPublico } = newsletter
  const liberado = resendConfigurado && acessoPublico
  const enviada = envio?.situacao === 'enviado'
  const temRascunho = envio?.situacao === 'rascunho' && envio.temBroadcast
  const naoSalvo = estadoSalvo === 'erro' || estadoSalvo === 'recusado'

  let motivoEnvio: string | null = null
  if (!liberado || !conteudoOk) motivoEnvio = null
  else if (!temRascunho) motivoEnvio = 'Crie o rascunho no Resend antes de enviar.'
  else if (estadoSalvo !== 'salvo') motivoEnvio = 'Há alterações na newsletter que ainda não foram salvas.'
  else if (Date.parse(pecaAtualizadaEm) > Date.parse(envio.atualizadoEm))
    motivoEnvio = 'A peça mudou depois do rascunho; atualize o rascunho no Resend antes de enviar.'
  else if (destinatarios === 0) motivoEnvio = 'Nenhum contato elegível e sincronizado para receber a newsletter.'
  const podeEnviar = liberado && conteudoOk && motivoEnvio === null && ocupado === null

  async function criarRascunho() {
    setMsg(null)
    setConfirmando(false)
    setOcupado('rascunho')
    try {
      if (!(await salvar())) {
        setMsg({ tipo: 'erro', texto: 'Não foi possível salvar as alterações; o rascunho não foi criado.' })
        return
      }
      const r = await fetch(`/api/distribuicao/pecas/${pecaId}/newsletter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao: 'rascunho' }),
      })
      const json = await lerJson(r)
      const bruto = (json as { envio?: unknown } | null)?.envio
      if (r.ok && typeof bruto === 'object' && bruto !== null) {
        setEnvio(envioParaTela(bruto as Parameters<typeof envioParaTela>[0]))
        setMsg({ tipo: 'sucesso', texto: 'Rascunho gravado no Resend. Confira a prévia e envie quando quiser.' })
        router.refresh()
      } else {
        setMsg({ tipo: 'erro', texto: erroDe(json, 'Não foi possível criar o rascunho.') })
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Sem resposta do servidor. Tente de novo.' })
    } finally {
      setOcupado(null)
    }
  }

  async function enviar() {
    setMsg(null)
    setConfirmando(false)
    setOcupado('enviar')
    try {
      const r = await fetch(`/api/distribuicao/pecas/${pecaId}/newsletter`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ acao: 'enviar' }),
      })
      const json = (await lerJson(r)) as { destinatarios?: unknown } | null
      if (r.ok) {
        const n = typeof json?.destinatarios === 'number' ? json.destinatarios : destinatarios
        setMsg({ tipo: 'sucesso', texto: `Newsletter enviada para ${contatos(n)}.` })
        if (envio) setEnvio({ ...envio, situacao: 'enviado', destinatarios: n, enviadoEm: new Date().toISOString(), erro: null })
        router.refresh()
      } else {
        setMsg({ tipo: 'erro', texto: erroDe(json, 'O envio falhou. Tente de novo.') })
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Sem resposta do servidor. Recarregue a página antes de tentar de novo: o envio pode ter saído.' })
    } finally {
      setOcupado(null)
    }
  }

  return (
    <section aria-label="Envio da newsletter" className="space-y-3 rounded-lg border border-borda p-4">
      <h3 className="text-sm font-semibold text-tinta">Envio pelo Resend</h3>
      {!resendConfigurado ? (
        <Aviso tipo="alerta" role={null} titulo="Resend não configurado">
          Sem a chave do Resend não há como criar nem enviar a newsletter. Veja em <Link href="/crm/integracao">CRM · Integração</Link>.
        </Aviso>
      ) : (
        !acessoPublico && (
          <Aviso tipo="alerta" role={null} titulo="Envio bloqueado">
            O painel não está acessível publicamente, e o descadastro dos leitores não voltaria pelo webhook. Ajuste a proteção da Vercel e confira em{' '}
            <Link href="/crm/integracao">CRM · Integração</Link>.
          </Aviso>
        )
      )}

      {enviada ? (
        <Aviso tipo="sucesso" role={null}>
          Enviada{envio.enviadoEm ? ` em ${formatarBrasilia(envio.enviadoEm)}` : ''}
          {envio.destinatarios != null ? ` para ${contatos(envio.destinatarios)}` : ''}. Cada artigo tem uma newsletter só.
        </Aviso>
      ) : (
        <>
          {envio?.erro && (
            <Aviso tipo="alerta" role={null} titulo="O último envio falhou">
              {envio.erro}
            </Aviso>
          )}
          <p className="text-sm text-tinta-suave">
            {temRascunho ? 'Há um rascunho no Resend.' : 'Ainda não há rascunho no Resend.'} Destinatários hoje: {contatos(destinatarios)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <Botao
              variante="secundario"
              disabled={!liberado || !conteudoOk || naoSalvo || ocupado !== null}
              aria-busy={ocupado === 'rascunho'}
              onClick={() => void criarRascunho()}
            >
              {ocupado === 'rascunho' ? 'Gravando rascunho…' : temRascunho ? 'Atualizar rascunho no Resend' : 'Criar rascunho no Resend'}
            </Botao>
            {!confirmando && (
              <Botao
                disabled={!podeEnviar}
                aria-busy={ocupado === 'enviar'}
                onClick={() => {
                  setMsg(null)
                  setConfirmando(true)
                }}
              >
                {ocupado === 'enviar' ? 'Enviando…' : 'Enviar newsletter'}
              </Botao>
            )}
          </div>
          {naoSalvo && <p className="text-xs text-tinta-suave">Corrija o conteúdo acima: há alterações que não foram salvas.</p>}
          {motivoEnvio && <p className="text-xs text-tinta-suave">{motivoEnvio}</p>}
          {confirmando && (
            <div className="space-y-2 rounded-lg border border-acento/50 bg-acento-suave p-3" role="group" aria-label="Confirmar envio">
              <p className="text-sm text-tinta">
                A newsletter sai agora para {contatos(destinatarios)}. Depois de enviada, não dá para desfazer.
              </p>
              <div className="flex flex-wrap gap-2">
                <Botao onClick={() => void enviar()} disabled={!podeEnviar}>
                  Confirmar envio para {contatos(destinatarios)}
                </Botao>
                <Botao variante="fantasma" onClick={() => setConfirmando(false)}>
                  Cancelar
                </Botao>
              </div>
            </div>
          )}
        </>
      )}
      {msg && <Aviso tipo={msg.tipo}>{msg.texto}</Aviso>}
    </section>
  )
}
