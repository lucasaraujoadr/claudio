import Link from 'next/link'
import { notFound } from 'next/navigation'
import { connection } from 'next/server'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, type TipoAviso } from '@/components/ui'
import { TextoCopiavel } from '@/app/(dash)/crm/funis/copiar'
import { brevoConfigurado } from '@/lib/brevo'
import { lerId } from '@/lib/crm/formulario'
import { comporCampanhaDoTema, remetenteConfigurado } from '@/lib/crm/funis-campanha'
import { obterFunil } from '@/lib/crm/funis'

export const metadata = { title: 'Rascunho de campanha' }

const AVISOS: Record<string, { texto: string; tipo: TipoAviso }> = {
  criada: { texto: 'Rascunho criado no Brevo. Nada foi enviado: revise e envie (ou agende) pelo Brevo, em Campanhas.', tipo: 'sucesso' },
  'nao-conectado': { texto: 'Brevo não conectado: copie o texto abaixo e crie a campanha no Brevo à mão.', tipo: 'alerta' },
  'sem-lista': { texto: 'O funil "Nutrição com o blog" ainda não tem lista no Brevo. Conecte a lista em CRM → Funis.', tipo: 'alerta' },
  'sem-remetente': { texto: 'Remetente não configurado: defina BREVO_REMETENTE_EMAIL (e BREVO_REMETENTE_NOME) com um remetente validado no Brevo.', tipo: 'alerta' },
  brevo: { texto: 'O Brevo recusou o rascunho. Confira se o remetente está validado no Brevo e tente de novo.', tipo: 'erro' },
  'nao-publicado': { texto: 'Só temas publicados, com URL, viram campanha.', tipo: 'erro' },
  'nao-encontrado': { texto: 'Tema não encontrado.', tipo: 'erro' },
  erro: { texto: 'Algo falhou no servidor. Tente de novo.', tipo: 'erro' },
}

export default async function CampanhaTemaPage({
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
  const aviso = typeof sp.aviso === 'string' ? AVISOS[sp.aviso] : undefined

  let tema: Awaited<ReturnType<typeof comporCampanhaDoTema>> | null = null
  // O funil não guarda mais lista do Brevo; a campanha do blog sai com o Task 7.
  const listaId: number | null = null
  try {
    tema = await comporCampanhaDoTema(id)
  } catch (e) {
    console.error('temas: leitura da campanha falhou:', e instanceof Error ? e.name : 'erro')
  }
  if (tema && !tema.ok && tema.motivo === 'nao_encontrado') notFound()

  const conectado = brevoConfigurado()
  const remetente = remetenteConfigurado()
  const podeCriar = conectado && listaId !== null && remetente !== null

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <CabecalhoPagina
        secao={<Link href="/temas" className="hover:underline">SEO · Temas</Link>}
        titulo="Rascunho de campanha"
        subtitulo="Nutrição com o blog: um email para a lista do funil, com título, resumo e link do artigo. O painel nunca envia."
      />
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {!tema ? (
        <Aviso tipo="erro" titulo="Não foi possível ler o tema">O banco não respondeu. Recarregue a página.</Aviso>
      ) : !tema.ok ? (
        <Aviso tipo="erro">Só temas publicados, com URL, viram campanha.</Aviso>
      ) : (
        <>
          <Cartao titulo={tema.titulo} descricao="Destinatários: a lista do funil Nutrição com o blog.">
            {podeCriar ? (
              <form method="POST" action="/api/temas/campanha" className="space-y-2">
                <input type="hidden" name="id" value={id} />
                <BotaoEnviar rotuloEnviando="Criando rascunho…">Criar rascunho de campanha no Brevo</BotaoEnviar>
                <p className="text-xs text-tinta-suave">Cria só o rascunho, para a lista {listaId}. O envio é feito por você, no Brevo.</p>
              </form>
            ) : (
              <Aviso tipo="info" titulo="Copie o texto e crie a campanha no Brevo" role={null}>
                {!conectado
                  ? 'Brevo não conectado (BREVO_API_KEY).'
                  : listaId === null
                    ? 'O funil Nutrição com o blog ainda não tem lista no Brevo (CRM → Funis).'
                    : 'Falta o remetente (BREVO_REMETENTE_EMAIL).'}{' '}
                Quando estiver tudo configurado, este botão cria o rascunho direto no Brevo.
              </Aviso>
            )}
          </Cartao>

          <Cartao titulo="Texto da campanha">
            <div className="space-y-4">
              <TextoCopiavel rotulo="Nome da campanha" texto={tema.composta.nome} />
              <TextoCopiavel rotulo="Assunto" texto={tema.composta.assunto} />
              <TextoCopiavel rotulo="Pré-cabeçalho" texto={tema.composta.preCabecalho} />
              <TextoCopiavel rotulo="Link (com UTM)" texto={tema.composta.link} />
              <TextoCopiavel rotulo="Corpo (texto)" texto={tema.composta.texto} multilinha />
              <TextoCopiavel rotulo="Corpo (HTML, para o editor de código do Brevo)" texto={tema.composta.html} multilinha />
            </div>
          </Cartao>
        </>
      )}
    </div>
  )
}
