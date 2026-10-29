import { NextResponse, type NextRequest } from 'next/server'
import { mudarStatus, upsertContato } from '@/lib/crm/contatos'
import { lerNovoContato } from '@/lib/crm/formulario'

export const runtime = 'nodejs'

/**
 * Cadastro manual. Email já existente: mescla no contato atual (regras do upsert, origem
 * `manual`) sem mexer no status; um status escolhido no formulário é aplicado depois, de
 * forma explícita, por `mudarStatus` (que nunca tira ninguém de descadastrado).
 */
export async function POST(request: NextRequest) {
  const erro = (flag: string) => NextResponse.redirect(new URL(`/crm/contatos/novo?erro=${flag}`, request.url), 303)
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return erro('erro')
  }
  const lido = lerNovoContato(form)
  if (!lido.ok) return erro(lido.campo ? `${lido.erro}&campo=${lido.campo}` : lido.erro)
  try {
    const r = await upsertContato(lido.dados, 'manual')
    if (!('contatoId' in r) || r.contatoId == null) return erro('erro')
    let aviso = r.acao === 'criado' ? 'criado' : 'existia'
    if (r.acao !== 'criado' && lido.statusEscolhido) {
      const s = await mudarStatus(r.contatoId, lido.statusEscolhido, { origem: 'manual' })
      if (!s.ok && s.motivo === 'descadastrado') aviso = 'existia-descadastrado'
    }
    return NextResponse.redirect(new URL(`/crm/contatos/${r.contatoId}?aviso=${aviso}`, request.url), 303)
  } catch (e) {
    console.error('crm: cadastro falhou:', e instanceof Error ? e.name : 'erro')
    return erro('erro')
  }
}
