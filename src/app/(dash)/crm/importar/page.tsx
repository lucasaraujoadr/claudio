import Link from 'next/link'
import { connection } from 'next/server'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, EstadoVazio, Tabela, classesBotao, CELULA_NUMERICA, type TipoAviso } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import { ROTULO_BASE_LEGAL } from '@/lib/crm/campos'
import { LIMITE_LINHAS_IMPORTACAO, lerCsv } from '@/lib/crm/csv'
import {
  CAMPOS_IMPORTACAO,
  ROTULO_CAMPO_IMPORTACAO,
  TAMANHO_MAXIMO_ARQUIVO,
  adivinharMapeamento,
  carregarLote,
  relatorioDoLote,
  type Relatorio,
} from '@/lib/crm/importacao'
import type { ImportacaoContatos } from '@/lib/db/schema'
import { CampoBaseLegal } from '../contatos/_compartilhado'

export const metadata = { title: 'Importar contatos' }

const LINHAS_PREVIA = 10
const LINHAS_IGNORADAS_NA_TELA = 200

const ERROS_ENVIO: Record<string, string> = {
  vazio: 'Escolha um arquivo CSV com conteúdo.',
  grande: `O arquivo passa de ${TAMANHO_MAXIMO_ARQUIVO / 1024 / 1024} MB. Divida a planilha em partes.`,
  tipo: 'Envie um arquivo .csv (no Excel: Arquivo → Salvar como → CSV UTF-8).',
  sem_linhas: 'O arquivo não tem linhas de dados abaixo do cabeçalho.',
  aspas_abertas: 'O arquivo tem aspas abertas que não fecham. Salve de novo pelo Excel como CSV e tente outra vez.',
  erro: 'Não foi possível ler o arquivo. Nada foi gravado; tente novamente.',
}

const AVISOS_LOTE: Record<string, { texto: string; tipo: TipoAviso }> = {
  concluida: { texto: 'Importação concluída.', tipo: 'sucesso' },
  'base-legal': { texto: 'Escolha a base legal do lote. Ela é obrigatória.', tipo: 'erro' },
  sem_email: { texto: 'Escolha qual coluna tem o e-mail.', tipo: 'erro' },
  mapa_invalido: { texto: 'Mapeamento inválido: cada coluna só pode ir para um campo.', tipo: 'erro' },
  ja_processado: { texto: 'Este lote já foi importado.', tipo: 'info' },
  nao_encontrado: { texto: 'Lote não encontrado ou expirado.', tipo: 'erro' },
  csv_invalido: { texto: 'Não foi possível reler o arquivo guardado. Envie de novo.', tipo: 'erro' },
  erro: { texto: 'A importação falhou e nada foi gravado. Tente novamente.', tipo: 'erro' },
}

function Envio({ erro }: { erro?: string }) {
  return (
    <Cartao titulo="Enviar planilha" descricao="Primeiro você vê as 10 primeiras linhas e confere as colunas; nada é gravado antes de confirmar.">
      <form method="POST" action="/api/crm/importar" encType="multipart/form-data" className="space-y-4">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="space-y-1">
          <label htmlFor="i-arquivo" className={CLASSES_ROTULO}>Arquivo CSV</label>
          <input id="i-arquivo" name="arquivo" type="file" accept=".csv,text/csv" required className={classesCampo('file:mr-3 file:rounded file:border-0 file:bg-elevada file:px-3 file:py-1 file:text-sm')} />
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-tinta-suave">
          <li>No Excel: <strong>Arquivo → Salvar como → CSV UTF-8 (delimitado por vírgulas)</strong>. O CSV comum do Excel também serve.</li>
          <li>Separador vírgula ou ponto e vírgula; a primeira linha precisa ser o cabeçalho (Nome, E-mail, Telefone, Escritório, Cidade, UF, Tags…).</li>
          <li>Até {LIMITE_LINHAS_IMPORTACAO.toLocaleString('pt-BR')} linhas por lote.</li>
          <li>E-mails repetidos, vazios ou inválidos são pulados e listados no relatório. Contatos descadastrados continuam descadastrados.</li>
        </ul>
        <div className="flex justify-end">
          <BotaoEnviar rotuloEnviando="Lendo arquivo…">Pré-visualizar</BotaoEnviar>
        </div>
      </form>
    </Cartao>
  )
}

function Previa({ lote, cp1252 }: { lote: ImportacaoContatos; cp1252: boolean }) {
  const csv = lerCsv(lote.conteudo ?? '')
  if (!csv.ok) return <Aviso tipo="erro">{csv.mensagem}</Aviso>
  const mapa = adivinharMapeamento(csv.cabecalho)
  const rotuloColuna = (i: number) => csv.cabecalho[i] || `Coluna ${i + 1}`
  return (
    <>
      <Cartao
        titulo={`Pré-visualização: ${lote.nomeArquivo}`}
        descricao={`${lote.totalLinhas.toLocaleString('pt-BR')} ${lote.totalLinhas === 1 ? 'linha' : 'linhas'} de dados · separador "${csv.separador}" · mostrando as ${Math.min(LINHAS_PREVIA, csv.linhas.length)} primeiras`}
        semPreenchimento
      >
        {cp1252 && (
          <div className="px-5 pb-3">
            <Aviso tipo="info">O arquivo não estava em UTF-8 e foi lido como Windows-1252 (CSV antigo do Excel). Confira os acentos abaixo.</Aviso>
          </div>
        )}
        <Tabela legenda="Primeiras linhas do arquivo" compacta className="rounded-none border-x-0 border-b-0">
          <thead>
            <tr>
              <th scope="col" className={CELULA_NUMERICA}>Linha</th>
              {csv.cabecalho.map((_, i) => <th key={i} scope="col">{rotuloColuna(i)}</th>)}
            </tr>
          </thead>
          <tbody>
            {csv.linhas.slice(0, LINHAS_PREVIA).map((l, k) => (
              <tr key={k}>
                <td className={CELULA_NUMERICA}>{csv.numeros[k]}</td>
                {l.map((v, i) => <td key={i} className="max-w-56 truncate" title={v}>{v}</td>)}
              </tr>
            ))}
          </tbody>
        </Tabela>
      </Cartao>

      <Cartao titulo="Colunas e base legal" descricao="Confira de qual coluna vem cada campo. Só o e-mail é obrigatório.">
        <form method="POST" action="/api/crm/importar/confirmar" className="space-y-5">
          <input type="hidden" name="lote" value={lote.id} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CAMPOS_IMPORTACAO.map((campo) => (
              <div key={campo} className="space-y-1">
                <label htmlFor={`m-${campo}`} className={CLASSES_ROTULO}>
                  {ROTULO_CAMPO_IMPORTACAO[campo]}
                  {campo === 'email' && <span className="text-critico" aria-hidden="true"> *</span>}
                </label>
                <select id={`m-${campo}`} name={`col_${campo}`} defaultValue={mapa[campo] ?? ''} required={campo === 'email'} className={classesCampo()}>
                  <option value="">{campo === 'email' ? 'Escolha a coluna' : '— não importar —'}</option>
                  {csv.cabecalho.map((_, i) => <option key={i} value={i}>{rotuloColuna(i)}</option>)}
                </select>
              </div>
            ))}
          </div>
          <CampoBaseLegal legenda="Base legal de todo o lote (LGPD)" />
          <p className="text-xs text-tinta-suave">
            Para quem já está cadastrado, a base legal só é trocada se a do lote for mais forte (consentimento &gt; contrato &gt; legítimo interesse).
          </p>
          <div className="space-y-1">
            <label htmlFor="m-tags-lote" className={CLASSES_ROTULO}>Tags para todo o lote (opcional)</label>
            <input id="m-tags-lote" name="tags" maxLength={1000} className={classesCampo()} placeholder="Ex.: evento oab outubro, campinas" />
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-borda pt-4">
            <Link href="/crm/importar" className={classesBotao('secundario')}>Enviar outro arquivo</Link>
            <BotaoEnviar rotuloEnviando="Importando…">Importar {lote.totalLinhas.toLocaleString('pt-BR')} {lote.totalLinhas === 1 ? 'linha' : 'linhas'}</BotaoEnviar>
          </div>
        </form>
      </Cartao>
    </>
  )
}

function RelatorioLote({ id, r }: { id: string; r: Relatorio }) {
  const ignoradas = r.linhas.filter((l) => l.resultado === 'ignorado')
  const contagem = (rotulo: string, n: number) => (
    <div className="rounded-lg border border-borda bg-superficie px-4 py-3">
      <dt className="text-xs font-medium text-tinta-suave">{rotulo}</dt>
      <dd className="font-titulo text-2xl font-semibold tabular-nums text-tinta">{n.toLocaleString('pt-BR')}</dd>
    </div>
  )
  return (
    <Cartao
      titulo={`Relatório: ${r.arquivo}`}
      descricao={`Base legal do lote: ${ROTULO_BASE_LEGAL[r.baseLegal]}. O relatório fica disponível por 24 horas.`}
      acoes={<a href={`/api/crm/importar/${id}/relatorio`} className={classesBotao('secundario', 'sm')} download>Baixar relatório (CSV)</a>}
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {contagem('Criados', r.criados)}
          {contagem('Atualizados', r.atualizados)}
          {contagem('Já existiam, sem mudança', r.inalterados)}
          {contagem('Ignorados', r.ignorados)}
        </dl>
        {ignoradas.length > 0 && (
          <Tabela legenda="Linhas ignoradas" legendaVisivel compacta>
            <thead>
              <tr>
                <th scope="col" className={CELULA_NUMERICA}>Linha</th>
                <th scope="col">E-mail</th>
                <th scope="col">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {ignoradas.slice(0, LINHAS_IGNORADAS_NA_TELA).map((l) => (
                <tr key={l.linha}>
                  <td className={CELULA_NUMERICA}>{l.linha}</td>
                  <td className="break-all">{l.email || '—'}</td>
                  <td>{l.motivo}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
        {ignoradas.length > LINHAS_IGNORADAS_NA_TELA && (
          <p className="text-sm text-tinta-suave">Mostrando {LINHAS_IGNORADAS_NA_TELA} de {ignoradas.length.toLocaleString('pt-BR')} linhas ignoradas; o CSV tem todas.</p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Link href="/crm/importar" className={classesBotao('secundario')}>Importar outra planilha</Link>
          <Link href="/crm/contatos?origem=planilha" className={classesBotao('primario')}>Ver contatos</Link>
        </div>
      </div>
    </Cartao>
  )
}

export default async function ImportarPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  await connection()
  const sp = await searchParams
  const idLote = typeof sp.lote === 'string' ? sp.lote : null
  const aviso = typeof sp.aviso === 'string' ? AVISOS_LOTE[sp.aviso] : undefined

  let erroEnvio: string | undefined
  if (typeof sp.erro === 'string') {
    if (sp.erro === 'linhas_demais') {
      const n = Number(sp.n)
      erroEnvio = `O arquivo tem ${Number.isFinite(n) ? n.toLocaleString('pt-BR') : 'mais de 5.000'} linhas; o limite por lote é ${LIMITE_LINHAS_IMPORTACAO.toLocaleString('pt-BR')}. Divida a planilha em partes e importe uma de cada vez.`
    } else erroEnvio = ERROS_ENVIO[sp.erro] ?? ERROS_ENVIO.erro
  }

  let conteudo: React.ReactNode
  if (!idLote) {
    conteudo = <Envio erro={erroEnvio} />
  } else {
    let lote: ImportacaoContatos | null | undefined
    try {
      lote = await carregarLote(idLote)
    } catch (e) {
      console.error('crm: leitura do lote falhou:', e instanceof Error ? e.name : 'erro')
      lote = undefined
    }
    const relatorio = lote ? relatorioDoLote(lote) : null
    conteudo =
      lote === undefined ? (
        <Aviso tipo="erro" titulo="Não foi possível ler o lote">O banco não respondeu. Recarregue a página em alguns instantes.</Aviso>
      ) : lote === null ? (
        <EstadoVazio
          titulo="Lote não encontrado ou expirado"
          explicacao="Os arquivos enviados ficam guardados por 24 horas. Envie a planilha de novo."
          acao={<Link href="/crm/importar" className={classesBotao('primario', 'sm')}>Enviar planilha</Link>}
        />
      ) : relatorio ? (
        <RelatorioLote id={lote.id} r={relatorio} />
      ) : lote.status === 'processando' ? (
        <Aviso tipo="info" titulo="Importação em andamento">Este lote está sendo importado. Recarregue a página em alguns segundos.</Aviso>
      ) : (
        <Previa lote={lote} cp1252={sp.codificacao === 'windows-1252'} />
      )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <CabecalhoPagina
        secao="CRM"
        titulo="Importar contatos"
        subtitulo="Planilha do Excel salva como CSV. Cada lote exige a base legal (LGPD) de todos os contatos dele."
        acoes={<Link href="/crm/contatos" className={classesBotao('fantasma')}>Ver contatos</Link>}
      />
      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}
      {conteudo}
    </div>
  )
}
