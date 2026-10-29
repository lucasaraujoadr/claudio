import type { ClienteBrevo, ContatoBrevo, ErroBrevo, ListaBrevo, PastaBrevo, RascunhoCampanha, ResultadoBrevo } from '@/lib/brevo'

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
  const pastas: PastaBrevo[] = []
  const listas = new Map<number, ListaBrevo>()
  const campanhas: RascunhoCampanha[] = []
  let proximoIdLista = 10

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
      if (falhaGeral) return falhaGeral
      for (const e of emails) {
        const c = contatos.get(e)
        if (c && !c.listIds.includes(listaId)) c.listIds.push(listaId)
      }
      return { ok: true, dados: { sucesso: emails, falha: [] } }
    },
    async removerDaLista(listaId, emails) {
      chamadas.push({ op: 'removerDaLista', listaId, corpo: emails })
      if (falhaGeral) return falhaGeral
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
    async criarRascunhoCampanha(c): Promise<ResultadoBrevo<{ id: number }>> {
      chamadas.push({ op: 'campanha', corpo: c })
      if (falhaGeral) return falhaGeral
      campanhas.push(c)
      return { ok: true, dados: { id: campanhas.length } }
    },
    async listarPastas() {
      chamadas.push({ op: 'listarPastas' })
      if (falhaGeral) return falhaGeral
      return { ok: true, dados: [...pastas] }
    },
    async criarPasta(nome) {
      chamadas.push({ op: 'criarPasta', corpo: nome })
      if (falhaGeral) return falhaGeral
      const p = { id: pastas.length + 1, nome }
      pastas.push(p)
      return { ok: true, dados: { id: p.id } }
    },
    async criarLista(nome, pastaId) {
      chamadas.push({ op: 'criarLista', corpo: { nome, pastaId } })
      if (falhaGeral) return falhaGeral
      const l = { id: proximoIdLista++, nome, pastaId }
      listas.set(l.id, l)
      return { ok: true, dados: { id: l.id } }
    },
    async obterLista(listaId) {
      chamadas.push({ op: 'obterLista', listaId })
      if (falhaGeral) return falhaGeral
      return { ok: true, dados: listas.get(listaId) ?? null }
    },
  }

  return {
    cliente,
    contatos,
    chamadas,
    pastas,
    listas,
    campanhas,
    falhar(email: string, e: ErroBrevo) {
      falhas.set(email, e)
    },
    falharTudo(e: ErroBrevo | null) {
      falhaGeral = e
    },
  }
}
