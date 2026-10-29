import { randomUUID } from 'node:crypto'
import { and, eq, lt, or, sql } from 'drizzle-orm'
import { importacoesContatos, type ImportacaoContatos } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import { normalizarTags, semAcento, separarTags, type BaseLegal, type DadosContato } from './campos'
import { upsertContatos, type ResultadoUpsert } from './contatos'
import { escreverCsv, lerCsv, type ResultadoCsv } from './csv'
import { normalizarEmail } from './email'

/**
 * Importação de planilha CSV.
 *
 * Entre a pré-visualização e a confirmação, a planilha fica no servidor
 * (`importacoes_contatos`): o envio grava o texto decodificado e devolve um id; a
 * confirmação manda só esse id, o mapeamento de colunas (índices validados contra o
 * cabeçalho guardado), a base legal e as tags. As linhas importadas são sempre as que o
 * servidor leu, nunca dados reenviados pelo navegador. Ao concluir, o texto é apagado e
 * fica só o relatório; lotes com mais de 24 horas são removidos.
 */

export const CAMPOS_IMPORTACAO = ['email', 'nome', 'telefone', 'escritorio', 'cidade', 'uf', 'tags', 'notas'] as const
export type CampoImportacao = (typeof CAMPOS_IMPORTACAO)[number]
export type Mapeamento = Record<CampoImportacao, number | null>

export const ROTULO_CAMPO_IMPORTACAO: Record<CampoImportacao, string> = {
  email: 'E-mail',
  nome: 'Nome',
  telefone: 'Telefone',
  escritorio: 'Escritório',
  cidade: 'Cidade',
  uf: 'UF',
  tags: 'Tags',
  notas: 'Notas',
}

export const VALIDADE_LOTE_MS = 24 * 60 * 60 * 1000
/** Abaixo do limite de corpo de requisição das funções da Vercel (4,5 MB). */
export const TAMANHO_MAXIMO_ARQUIVO = 4 * 1024 * 1024

const SINONIMOS: Record<CampoImportacao, string[]> = {
  email: ['email', 'e-mail', 'emailaddress', 'enderecodeemail', 'correioeletronico', 'mail'],
  nome: ['nome', 'nomecompleto', 'name', 'contato', 'nomedocontato', 'advogado', 'advogada'],
  telefone: ['telefone', 'fone', 'tel', 'celular', 'whatsapp', 'phone', 'telefonecelular'],
  escritorio: ['escritorio', 'empresa', 'firma', 'sociedade', 'organizacao', 'company', 'escritoriodeadvocacia'],
  cidade: ['cidade', 'municipio', 'city'],
  uf: ['uf', 'estado', 'state'],
  tags: ['tags', 'tag', 'etiquetas', 'etiqueta', 'segmento', 'segmentos'],
  notas: ['notas', 'nota', 'observacoes', 'observacao', 'obs', 'comentarios', 'comentario'],
}

function chaveCabecalho(c: string): string {
  return semAcento(c).toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Palpite inicial do mapeamento a partir dos nomes das colunas. */
export function adivinharMapeamento(cabecalho: readonly string[]): Mapeamento {
  const chaves = cabecalho.map(chaveCabecalho)
  const usadas = new Set<number>()
  const mapa = {} as Mapeamento
  for (const campo of CAMPOS_IMPORTACAO) {
    const alvos = SINONIMOS[campo].map(chaveCabecalho)
    const i = chaves.findIndex((k, idx) => !usadas.has(idx) && alvos.includes(k))
    mapa[campo] = i >= 0 ? i : null
    if (i >= 0) usadas.add(i)
  }
  return mapa
}

export type MotivoPreparo = 'email_vazio' | 'email_invalido' | 'duplicado'
export type IgnoradoPreparo = { linha: number; email: string; motivo: MotivoPreparo; linhaOriginal?: number }
export type Preparacao = {
  itens: { linha: number; dados: DadosContato }[]
  ignorados: IgnoradoPreparo[]
}

type CsvOk = Extract<ResultadoCsv, { ok: true }>

/** Linhas → itens para `upsertContatos`, separando os que nem chegam ao banco. */
export function prepararImportacao(
  csv: CsvOk,
  mapa: Mapeamento,
  lote: { baseLegal: BaseLegal; tags: readonly string[] },
): Preparacao {
  const itens: Preparacao['itens'] = []
  const ignorados: IgnoradoPreparo[] = []
  const vistos = new Map<string, number>()
  const tagsLote = normalizarTags(lote.tags)
  const valor = (linha: string[], campo: CampoImportacao): string | null => {
    const i = mapa[campo]
    return i == null ? null : (linha[i] ?? '').trim()
  }
  csv.linhas.forEach((linha, idx) => {
    const numero = csv.numeros[idx]
    const bruto = valor(linha, 'email') ?? ''
    if (!bruto) {
      ignorados.push({ linha: numero, email: '', motivo: 'email_vazio' })
      return
    }
    const email = normalizarEmail(bruto)
    if (!email) {
      ignorados.push({ linha: numero, email: bruto, motivo: 'email_invalido' })
      return
    }
    const anterior = vistos.get(email)
    if (anterior !== undefined) {
      ignorados.push({ linha: numero, email: bruto, motivo: 'duplicado', linhaOriginal: anterior })
      return
    }
    vistos.set(email, numero)
    itens.push({
      linha: numero,
      dados: {
        email: bruto,
        nome: valor(linha, 'nome'),
        telefone: valor(linha, 'telefone'),
        escritorio: valor(linha, 'escritorio'),
        cidade: valor(linha, 'cidade'),
        uf: valor(linha, 'uf'),
        notas: valor(linha, 'notas'),
        tags: normalizarTags([...separarTags(valor(linha, 'tags')), ...tagsLote]),
        baseLegal: lote.baseLegal,
      },
    })
  })
  return { itens, ignorados }
}

export type LinhaRelatorio = {
  linha: number
  email: string
  resultado: 'criado' | 'atualizado' | 'inalterado' | 'ignorado'
  motivo: string | null
}
export type Relatorio = {
  arquivo: string
  baseLegal: BaseLegal
  criados: number
  atualizados: number
  inalterados: number
  ignorados: number
  linhas: LinhaRelatorio[]
}

function motivoTexto(i: IgnoradoPreparo): string {
  if (i.motivo === 'email_vazio') return 'E-mail vazio'
  if (i.motivo === 'email_invalido') return 'E-mail inválido'
  return `Duplicado no arquivo (mesmo e-mail da linha ${i.linhaOriginal})`
}

const MOTIVO_UPSERT: Record<Extract<ResultadoUpsert, { acao: 'ignorado' }>['motivo'], string> = {
  email_invalido: 'E-mail inválido',
  sem_base_legal: 'Sem base legal',
  descadastrado: 'Contato descadastrado: mantido sem alteração',
  dados_apagados: 'Dados apagados a pedido do titular: não é cadastrado de novo',
}

export function montarRelatorio(
  arquivo: string,
  baseLegal: BaseLegal,
  preparo: Preparacao,
  resultados: readonly ResultadoUpsert[],
): Relatorio {
  const linhas: LinhaRelatorio[] = preparo.ignorados.map((i) => ({
    linha: i.linha,
    email: i.email,
    resultado: 'ignorado',
    motivo: motivoTexto(i),
  }))
  preparo.itens.forEach((item, k) => {
    const r = resultados[k]
    linhas.push({
      linha: item.linha,
      email: item.dados.email,
      resultado: r.acao,
      motivo: r.acao === 'ignorado' ? MOTIVO_UPSERT[r.motivo] : null,
    })
  })
  linhas.sort((a, b) => a.linha - b.linha)
  const conta = (r: LinhaRelatorio['resultado']) => linhas.filter((l) => l.resultado === r).length
  return {
    arquivo,
    baseLegal,
    criados: conta('criado'),
    atualizados: conta('atualizado'),
    inalterados: conta('inalterado'),
    ignorados: conta('ignorado'),
    linhas,
  }
}

const ROTULO_RESULTADO: Record<LinhaRelatorio['resultado'], string> = {
  criado: 'Criado',
  atualizado: 'Atualizado',
  inalterado: 'Sem alteração',
  ignorado: 'Ignorado',
}

export function relatorioCsv(r: Relatorio): string {
  return escreverCsv(
    ['Linha', 'E-mail', 'Resultado', 'Motivo'],
    r.linhas.map((l) => [String(l.linha), l.email, ROTULO_RESULTADO[l.resultado], l.motivo ?? '']),
  )
}

// ---------------------------------------------------------------------------
// Lote no banco
// ---------------------------------------------------------------------------

export type ResultadoSalvar = { ok: true; id: string } | { ok: false; erro: Extract<ResultadoCsv, { ok: false }>['erro']; mensagem: string }

/**
 * Apaga os lotes com mais de 24 horas (com o CSV inteiro em `conteudo`). Roda a cada upload
 * e na rotina diária, para que uma planilha abandonada não fique guardada até o próximo
 * upload. Devolve quantos apagou.
 */
export async function apagarLotesVencidos(opts: { db?: BancoCrm; agora?: Date } = {}): Promise<number> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const apagados = await db
    .delete(importacoesContatos)
    .where(lt(importacoesContatos.criadoEm, new Date(agora.getTime() - VALIDADE_LOTE_MS)))
    .returning({ id: importacoesContatos.id })
  return apagados.length
}

/** Lê o texto, recusa se inválido ou acima do limite, e guarda para a pré-visualização. */
export async function salvarLote(
  entrada: { nomeArquivo: string; texto: string },
  opts: { db?: BancoCrm; agora?: Date } = {},
): Promise<ResultadoSalvar> {
  const csv = lerCsv(entrada.texto)
  if (!csv.ok) return { ok: false, erro: csv.erro, mensagem: csv.mensagem }
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  await apagarLotesVencidos({ db, agora })
  const id = randomUUID()
  await db.insert(importacoesContatos).values({
    id,
    nomeArquivo: entrada.nomeArquivo.slice(0, 200) || 'planilha.csv',
    conteudo: entrada.texto,
    totalLinhas: csv.linhas.length,
    criadoEm: agora,
  })
  return { ok: true, id }
}

export async function carregarLote(id: string, opts: { db?: BancoCrm; agora?: Date } = {}): Promise<ImportacaoContatos | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null
  const db = opts.db ?? bancoPadrao()
  const [l] = await db.select().from(importacoesContatos).where(eq(importacoesContatos.id, id))
  if (!l) return null
  const agora = opts.agora ?? new Date()
  if (agora.getTime() - l.criadoEm.getTime() > VALIDADE_LOTE_MS) return null
  return l
}

export type ResultadoConfirmar =
  | { ok: true; relatorio: Relatorio }
  | { ok: false; motivo: 'nao_encontrado' | 'ja_processado' | 'csv_invalido' | 'sem_email' | 'mapa_invalido' }

/** Um `processando` mais velho que isto é de uma execução morta e pode ser retomado. */
export const PROCESSANDO_EXPIRA_MS = 10 * 60 * 1000

/**
 * Importa o lote guardado, numa transação só: reivindicar o lote (UPDATE condicional
 * `pendente` → `processando`), gravar os contatos e marcar `concluida` com o relatório.
 * - Função morta no meio (timeout, deploy): a transação é desfeita, o lote volta sozinho a
 *   `pendente` e nenhum contato fica gravado pela metade; não há reimportação duplicada
 *   porque nada foi confirmado.
 * - Dois envios do mesmo formulário: o segundo espera a trava da linha do lote e, quando a
 *   primeira transação termina, encontra `concluida` → `ja_processado`.
 * - Um `processando` gravado e esquecido (não deveria existir, já que só fica visível
 *   dentro da transação) é retomado depois de `PROCESSANDO_EXPIRA_MS`.
 * - Sessão parada dentro da transação é encerrada pelo Postgres
 *   (`idle_in_transaction_session_timeout`), e quem espera a trava desiste em 30 s.
 */
export async function confirmarLote(
  id: string,
  mapa: Mapeamento,
  lote: { baseLegal: BaseLegal; tags: readonly string[] },
  opts: { db?: BancoCrm; agora?: Date } = {},
): Promise<ResultadoConfirmar> {
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  const existente = await carregarLote(id, opts)
  if (!existente) return { ok: false, motivo: 'nao_encontrado' }
  if (existente.conteudo == null || existente.status === 'concluida') return { ok: false, motivo: 'ja_processado' }
  const csv = lerCsv(existente.conteudo)
  if (!csv.ok) return { ok: false, motivo: 'csv_invalido' }
  if (mapa.email == null) return { ok: false, motivo: 'sem_email' }
  const colunas = Object.values(mapa).filter((v): v is number => v != null)
  if (colunas.some((c) => !Number.isInteger(c) || c < 0 || c >= csv.cabecalho.length) || new Set(colunas).size !== colunas.length) {
    return { ok: false, motivo: 'mapa_invalido' }
  }
  const preparo = prepararImportacao(csv, mapa, lote)

  try {
    return await db.transaction(async (tx) => {
      const banco = tx as unknown as BancoCrm
      await banco.execute(sql`set local lock_timeout = '30s'`)
      await banco.execute(sql`set local idle_in_transaction_session_timeout = '60s'`)
      const expirado = new Date(agora.getTime() - PROCESSANDO_EXPIRA_MS)
      const [reivindicado] = await banco
        .update(importacoesContatos)
        .set({ status: 'processando', concluidoEm: agora })
        .where(
          and(
            eq(importacoesContatos.id, id),
            or(
              eq(importacoesContatos.status, 'pendente'),
              // `concluidoEm` guarda o início do processamento enquanto o lote não termina.
              and(eq(importacoesContatos.status, 'processando'), lt(importacoesContatos.concluidoEm, expirado)),
            ),
          ),
        )
        .returning({ id: importacoesContatos.id })
      if (!reivindicado) return { ok: false, motivo: 'ja_processado' } as const

      const resultados = await upsertContatos(
        preparo.itens.map((i) => i.dados),
        'planilha',
        { db: banco, agora, seDescadastrado: 'ignorar', importacao: { lote: id, arquivo: existente.nomeArquivo } },
      )
      const relatorio = montarRelatorio(existente.nomeArquivo, lote.baseLegal, preparo, resultados)
      await banco
        .update(importacoesContatos)
        .set({ status: 'concluida', relatorio, conteudo: null, concluidoEm: agora })
        .where(eq(importacoesContatos.id, id))
      return { ok: true, relatorio } as const
    })
  } catch (erro) {
    // 55P03 = lock_not_available: outra confirmação do mesmo lote ainda está rodando.
    const codigo = (e: unknown): unknown => (typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined)
    const causa = typeof erro === 'object' && erro !== null ? (erro as { cause?: unknown }).cause : undefined
    if (codigo(erro) === '55P03' || codigo(causa) === '55P03') {
      return { ok: false, motivo: 'ja_processado' }
    }
    throw erro
  }
}

/** Relatório gravado de um lote concluído (para a tela e o download). */
export function relatorioDoLote(l: ImportacaoContatos): Relatorio | null {
  if (l.status !== 'concluida' || !l.relatorio || typeof l.relatorio !== 'object') return null
  return l.relatorio as Relatorio
}
