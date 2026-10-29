import Link from 'next/link'
import { connection } from 'next/server'
import { eq } from 'drizzle-orm'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, Selo, type TipoAviso } from '@/components/ui'
import { brevoConfigurado } from '@/lib/brevo'
import { bancoPadrao } from '@/lib/crm/banco'
import { definicaoFunil } from '@/lib/crm/funis-conteudo'
import { FONTE_FUNIS } from '@/lib/crm/funis-cron'
import { resumoFunis, type ResumoFunil } from '@/lib/crm/funis'
import { ehSlugFunil } from '@/lib/crm/funis-regras'
import { sincronizacoes } from '@/lib/db/schema'
import { formatarQuando } from '../contatos/_compartilhado'
import { SeloFunil, SeloLista } from './_compartilhado'

export const metadata = { title: 'Funis' }

const AVISOS: Record<string, { texto: string; tipo: TipoAviso }> = {
  'sync-ok': { texto: 'Listas do Brevo atualizadas.', tipo: 'sucesso' },
  'sync-parcial': { texto: 'Listas atualizadas em parte: ainda há inscrições pendentes (contato ainda não enviado ao Brevo, funil sem lista ou erro).', tipo: 'alerta' },
  'sync-interrompida': { texto: 'A atualização das listas parou no meio por um erro do Brevo. Tente de novo mais tarde.', tipo: 'erro' },
  'nao-conectado': { texto: 'Brevo não conectado: as inscrições ficam guardadas e vão para as listas quando BREVO_API_KEY for configurada.', tipo: 'alerta' },
  erro: { texto: 'Algo falhou no servidor. Tente de novo em instantes.', tipo: 'erro' },
}

async function carregar(): Promise<{ funis: ResumoFunil[]; ultima: typeof sincronizacoes.$inferSelect | null } | null> {
  try {
    const db = bancoPadrao()
    const [funis, [ultima]] = await Promise.all([resumoFunis({ db }), db.select().from(sincronizacoes).where(eq(sincronizacoes.fonte, FONTE_FUNIS))])
    return { funis, ultima: ultima ?? null }
  } catch (e) {
    console.error('crm: resumo dos funis falhou:', e instanceof Error ? e.name : 'erro')
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

export default async function FunisPage({ searchParams }: { searchParams: Promise<{ [chave: string]: string | string[] | undefined }> }) {
  await connection()
  const sp = await searchParams
  const aviso = typeof sp.aviso === 'string' ? AVISOS[sp.aviso] : undefined
  const conectado = brevoConfigurado()
  const dados = await carregar()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <CabecalhoPagina
        secao="CRM"
        titulo="Funis"
        subtitulo="O CRM decide quem está em cada funil; cada funil é uma lista do Brevo, e a automação do Brevo envia os emails."
        acoes={
          <form method="POST" action="/api/crm/funis/sincronizar" className="sm:text-right">
            <BotaoEnviar rotuloEnviando="Atualizando…">Atualizar listas do Brevo</BotaoEnviar>
          </form>
        }
      />

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {!conectado && (
        <Aviso tipo="info" titulo="Brevo não conectado" role={null}>
          Os funis funcionam sem o Brevo: as inscrições ficam guardadas como pendentes e entram nas listas quando a chave for
          configurada (veja <Link href="/crm/integracao">Integração</Link>).
        </Aviso>
      )}

      {!dados ? (
        <Aviso tipo="erro" titulo="Não foi possível ler os funis">O banco não respondeu. Recarregue a página.</Aviso>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {dados.funis.map((f) => {
              const def = ehSlugFunil(f.slug) ? definicaoFunil(f.slug) : null
              return (
                <Cartao
                  key={f.id}
                  as="article"
                  titulo={<Link href={`/crm/funis/${f.slug}`} className="hover:underline">{f.nome}</Link>}
                  descricao={f.descricao}
                  acoes={<SeloFunil f={f} />}
                  rodape={def?.quemEntra}
                >
                  <div className="space-y-4">
                    <dl className="grid grid-cols-3 gap-3">
                      <Numero rotulo="Ativos" valor={f.ativos} />
                      <Numero rotulo="Concluídos" valor={f.concluidos} />
                      <Numero rotulo="Saíram" valor={f.sairam} />
                    </dl>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <SeloLista f={f} conectado={conectado} />
                      {f.pendentesBrevo > 0 && <Selo variante="neutro">{f.pendentesBrevo.toLocaleString('pt-BR')} pendente(s) no Brevo</Selo>}
                      {f.slug === 'prospeccao-fria' && f.tetoDiario !== null && <Selo variante="neutro">Teto: {f.tetoDiario}/dia</Selo>}
                    </div>
                    <Link href={`/crm/funis/${f.slug}`} className="text-sm font-medium text-acento-texto underline-offset-2 hover:underline">
                      Membros, emails e automação
                    </Link>
                  </div>
                </Cartao>
              )
            })}
          </div>

          <Cartao titulo="Rotina diária" descricao="Reativação (até 50 por dia), prospecção fria (se ligada, no teto) e atualização das listas do Brevo.">
            {dados.ultima ? (
              <p className="text-sm text-tinta">
                <Selo variante={dados.ultima.status === 'ok' ? 'sucesso' : 'critico'}>{dados.ultima.status === 'ok' ? 'ok' : 'erro'}</Selo>{' '}
                {formatarQuando(dados.ultima.executadoEm)}
                {dados.ultima.mensagem && <span className="block text-xs text-tinta-suave">{dados.ultima.mensagem}</span>}
              </p>
            ) : (
              <p className="text-sm text-tinta-suave">Ainda não rodou.</p>
            )}
          </Cartao>
        </>
      )}
    </div>
  )
}
