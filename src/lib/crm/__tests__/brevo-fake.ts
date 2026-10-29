import type { ClienteBrevo, ContatoBrevo, ErroBrevo, ResultadoBrevo } from '@/lib/brevo'

/**
 * Brevo em memória para os testes: guarda contatos, listas e bloqueios e registra cada
 * chamada. `falhar` injeta um erro para um email.
 */
export function brevoFalso(inicial: ContatoBrevo[] = []) {
  const contatos = new Map<string, ContatoBrevo>(inicial.map((c) => [c.email ?? '', { ...c }]))
  let proximoId = 100
  const chamadas: { op: string; email?: string; listaId?: number; corpo?: unknown }[] = []
  const falhas = new Map<string, ErroBrevo>()
  let falhaGeral: ErroBrevo | null = null

  const erroDe = (email: string): ErroBrevo | null => falhaGeral ?? falhas.get(email) ?? null

  const cliente: ClienteBrevo = {
    conectado: true,
    async upsertContato(c) {
      chamadas.push({ op: 'upsert', email: c.email, corpo: c })
      const e = erroDe(c.email)
      if (e) return e
      const atual = contatos.get(c.email)
      if (atual) {
        Object.assign(atual.atributos, c.atributos)
        if (c.emailBlacklisted) atual.emailBlacklisted = true
        for (const l of c.listIds ?? []) if (!atual.listIds.includes(l)) atual.listIds.push(l)
        return { ok: true, dados: { id: null, criado: false } }
      }
      const novo: ContatoBrevo = {
        id: proximoId++,
        email: c.email,
        emailBlacklisted: c.emailBlacklisted === true,
        listIds: [...(c.listIds ?? [])],
        atributos: { ...c.atributos },
      }
      contatos.set(c.email, novo)
      return { ok: true, dados: { id: novo.id, criado: true } }
    },
    async obterContato(email) {
      chamadas.push({ op: 'obter', email })
      const e = erroDe(email)
      if (e) return e
      const c = contatos.get(email)
      return { ok: true, dados: c ? { ...c, listIds: [...c.listIds] } : null }
    },
    async atualizarContato(email, d) {
      chamadas.push({ op: 'atualizar', email, corpo: d })
      const c = contatos.get(email)
      if (!c) return { ok: false, motivo: 'http', status: 404, mensagem: 'Recurso não encontrado no Brevo (404).' }
      if (d.unlinkListIds) c.listIds = c.listIds.filter((l) => !d.unlinkListIds!.includes(l))
      if (d.emailBlacklisted) c.emailBlacklisted = true
      return { ok: true, dados: null }
    },
    async adicionarALista(listaId, emails) {
      chamadas.push({ op: 'adicionarALista', listaId, corpo: emails })
      for (const e of emails) {
        const c = contatos.get(e)
        if (c && !c.listIds.includes(listaId)) c.listIds.push(listaId)
      }
      return { ok: true, dados: { sucesso: emails, falha: [] } }
    },
    async removerDaLista(listaId, emails) {
      chamadas.push({ op: 'removerDaLista', listaId, corpo: emails })
      for (const e of emails) {
        const c = contatos.get(e)
        if (c) c.listIds = c.listIds.filter((l) => l !== listaId)
      }
      return { ok: true, dados: { sucesso: emails, falha: [] } }
    },
    async listarContatos(p = {}) {
      chamadas.push({ op: 'listar', corpo: p })
      if (falhaGeral) return falhaGeral
      const todos = [...contatos.values()]
      const offset = p.offset ?? 0
      const lim = p.limite ?? 500
      return { ok: true, dados: { contatos: todos.slice(offset, offset + lim), total: todos.length } }
    },
    async criarRascunhoCampanha(): Promise<ResultadoBrevo<{ id: number }>> {
      chamadas.push({ op: 'campanha' })
      return { ok: true, dados: { id: 1 } }
    },
  }

  return {
    cliente,
    contatos,
    chamadas,
    falhar(email: string, e: ErroBrevo) {
      falhas.set(email, e)
    },
    falharTudo(e: ErroBrevo | null) {
      falhaGeral = e
    },
  }
}
