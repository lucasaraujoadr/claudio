import { and, asc, gt } from 'drizzle-orm'
import { contatos, type Contato } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import { ROTULO_BASE_LEGAL, ROTULO_ORIGEM, ROTULO_STATUS } from './campos'
import { BOM, linhaCsv } from './csv'
import { condicaoFiltro, type FiltroContatos } from './filtros'

export const CABECALHO_EXPORTACAO = [
  'Nome', 'E-mail', 'Telefone', 'Escritório', 'Cidade', 'UF', 'Status', 'Origem', 'Base legal',
  'Consentimento registrado em', 'Tags', 'Notas', 'Criado em', 'Atualizado em',
] as const

const dataHora = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function quando(d: Date | null): string {
  return d ? dataHora.format(d).replace(',', '') : ''
}

export function linhaExportacao(c: Contato): string[] {
  return [
    c.nome,
    c.email,
    c.telefone ?? '',
    c.escritorio ?? '',
    c.cidade ?? '',
    c.uf ?? '',
    ROTULO_STATUS[c.status],
    ROTULO_ORIGEM[c.origem],
    ROTULO_BASE_LEGAL[c.baseLegal],
    quando(c.consentimentoEm),
    c.tags.join(', '),
    c.notas ?? '',
    quando(c.criadoEm),
    quando(c.atualizadoEm),
  ]
}

/**
 * CSV dos contatos filtrados (todas as páginas), em blocos por id crescente: a memória
 * não cresce com o tamanho da base. UTF-8 com BOM e `;` para o Excel em pt-BR.
 */
export function fluxoExportacao(f: FiltroContatos, opts: { db?: BancoCrm; tamanhoBloco?: number } = {}): ReadableStream<Uint8Array> {
  const db = opts.db ?? bancoPadrao()
  const bloco = opts.tamanhoBloco ?? 1000
  const cod = new TextEncoder()
  let ultimoId = 0
  let comecou = false
  return new ReadableStream<Uint8Array>({
    async pull(controle) {
      try {
        if (!comecou) {
          comecou = true
          controle.enqueue(cod.encode(BOM + linhaCsv(CABECALHO_EXPORTACAO)))
          return
        }
        const linhas = await db
          .select()
          .from(contatos)
          .where(and(condicaoFiltro(f), gt(contatos.id, ultimoId)))
          .orderBy(asc(contatos.id))
          .limit(bloco)
        if (linhas.length === 0) {
          controle.close()
          return
        }
        ultimoId = linhas[linhas.length - 1].id
        controle.enqueue(cod.encode(linhas.map((c) => linhaCsv(linhaExportacao(c))).join('')))
        if (linhas.length < bloco) controle.close()
      } catch (erro) {
        console.error('crm: exportação falhou:', erro instanceof Error ? erro.name : 'erro')
        controle.error(new Error('exportação falhou'))
      }
    },
  })
}
