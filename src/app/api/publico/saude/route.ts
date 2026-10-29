export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Alvo da checagem de acesso público (spec §2.9). Não expõe nada. */
export async function GET() {
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
}
