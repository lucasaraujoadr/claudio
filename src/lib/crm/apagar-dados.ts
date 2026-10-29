import { eq } from 'drizzle-orm'
import { contatos, eventosContato } from '@/lib/db/schema'
import { bancoPadrao, type BancoCrm } from './banco'
import { textoOuNulo } from './campos'
import { sairDeTodosOsFunis } from './funis'

export type ResultadoApagarDados = { ok: true } | { ok: false; motivo: 'sem_motivo' | 'nao_encontrado' | 'ja_apagado' }

/**
 * "Apagar dados a pedido" (LGPD art. 18, VI): anonimiza o contato numa transação só.
 *
 * - Apaga nome, telefone, escritório, cidade, UF, notas, tags e o id do Brevo, e os `dados`
 *   de todo evento da linha do tempo.
 * - Fica só o email (`email`/`email_normalizado`), como chave de supressão: apagar a linha
 *   inteira deixaria uma planilha futura cadastrar e prospectar a pessoa de novo — o oposto do
 *   que ela pediu. Com status `descadastrado`, a próxima sincronização a bloqueia no Brevo e a
 *   tira de toda lista; as inscrições em funis acabam aqui mesmo.
 * - Registra um evento `dados_apagados` com a data e o motivo (sem dado pessoal).
 * - Depois disso nada repreenche o contato (upsert de qualquer origem, edição manual) e ele
 *   nunca é reativado. Nada aqui vai para log.
 */
export async function apagarDadosAPedido(
  id: number,
  motivo: string,
  opts: { db?: BancoCrm; agora?: Date } = {},
): Promise<ResultadoApagarDados> {
  const texto = textoOuNulo(motivo)
  if (!texto) return { ok: false, motivo: 'sem_motivo' }
  const db = opts.db ?? bancoPadrao()
  const agora = opts.agora ?? new Date()
  return db.transaction(async (tx) => {
    const banco = tx as unknown as BancoCrm
    const [c] = await banco.select().from(contatos).where(eq(contatos.id, id)).for('update')
    if (!c) return { ok: false, motivo: 'nao_encontrado' } as const
    if (c.dadosApagadosEm) return { ok: false, motivo: 'ja_apagado' } as const
    await sairDeTodosOsFunis(id, { db: banco, motivo: 'dados apagados a pedido', agora })
    await banco
      .update(contatos)
      .set({
        nome: '',
        telefone: null,
        escritorio: null,
        cidade: null,
        uf: null,
        notas: null,
        tags: [],
        brevoId: null,
        status: 'descadastrado',
        syncStatus: 'pendente',
        syncErro: null,
        dadosApagadosEm: agora,
        atualizadoEm: agora,
      })
      .where(eq(contatos.id, id))
    // Depois de sair dos funis: os eventos `saiu_funil` recém-gravados também ficam sem dados.
    await banco.update(eventosContato).set({ dados: null }).where(eq(eventosContato.contatoId, id))
    await banco.insert(eventosContato).values({
      contatoId: id,
      tipo: 'dados_apagados',
      dados: { motivo: texto.slice(0, 1000), em: agora.toISOString(), statusAnterior: c.status },
      em: agora,
    })
    return { ok: true } as const
  })
}
