import type { BancoCrm } from './banco'
import { inscrever, sairDeTodosOsFunis as sairDeTodos } from './funis'

/**
 * Pontos de extensão chamados pelos webhooks (E8), preenchidos pela E9. Os dois só gravam
 * no banco (sem chamada ao Brevo): o descadastro roda dentro da transação do webhook, e a
 * lista do Brevo é atualizada por `sincronizarInscricoes` (rotina diária ou botão na tela).
 *
 * Regra mantida: contato `descadastrado` nunca é inscrito nem adicionado a lista do Brevo,
 * por nenhum caminho (ver `podeEntrar` e `adicionarContatosALista`).
 */

/**
 * Chamado quando um contato vira `descadastrado` (descadastro, hard bounce ou spam no
 * Brevo, ou mudança manual de status), dentro da mesma transação. Marca como `saiu` toda
 * inscrição ativa e registra `saiu_funil`. Devolve quantas inscrições encerrou.
 */
export async function sairDeTodosOsFunis(contatoId: number, opts: { db: BancoCrm; motivo: string }): Promise<number> {
  return sairDeTodos(contatoId, { db: opts.db, motivo: opts.motivo })
}

/**
 * Chamado depois que o formulário do site cria ou atualiza um lead. Inscreve no funil
 * `boas-vindas` se o contato não estiver descadastrado nem já tiver passado por ele.
 */
export async function inscreverBoasVindasDoSite(contatoId: number, opts: { db: BancoCrm }): Promise<void> {
  try {
    await inscrever('boas-vindas', [contatoId], { db: opts.db, caminho: 'site' })
  } catch (e) {
    // O contato já foi gravado: uma falha no funil não pode fazer o Elementor mostrar erro
    // ao visitante. Só a classe do erro vai para o log.
    console.error('funis: inscrição em boas-vindas falhou:', e instanceof Error ? e.name : 'erro')
  }
}
