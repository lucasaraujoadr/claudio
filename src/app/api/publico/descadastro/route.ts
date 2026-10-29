import { responderDescadastro } from '@/lib/descadastro'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Só POST: um GET (leitor de link de antivírus) não pode descadastrar. O Next devolve 405 para o resto.
export async function POST(request: Request) {
  return responderDescadastro(request)
}
