import type { BancoCrm } from './banco'

/**
 * Pontos de extensão para os funis (E9). Hoje não existe a tabela de inscrições, então os
 * dois ganchos não fazem nada; a E9 troca o corpo destas funções (mesma assinatura) e os
 * webhooks passam a inscrever/tirar sem mudar.
 *
 * Regra que a E9 precisa manter: contato `descadastrado` nunca é inscrito nem adicionado a
 * lista do Brevo, por nenhum caminho (ver `adicionarContatosALista` em `sincronizar.ts`).
 */

/**
 * Chamado quando um contato vira `descadastrado` (descadastro, hard bounce ou spam no
 * Brevo), dentro da mesma transação. Deve marcar como `saiu` toda inscrição ativa e
 * registrar `saiu_funil`. Devolve quantas inscrições encerrou.
 */
export async function sairDeTodosOsFunis(
  contatoId: number,
  opts: { db: BancoCrm; motivo: string },
): Promise<number> {
  void contatoId
  void opts
  return 0
}

/**
 * Chamado depois que o formulário do site cria ou atualiza um lead. Deve inscrever no funil
 * `boas-vindas` se o contato não estiver descadastrado nem já inscrito.
 */
export async function inscreverBoasVindasDoSite(contatoId: number, opts: { db: BancoCrm }): Promise<void> {
  void contatoId
  void opts
}
