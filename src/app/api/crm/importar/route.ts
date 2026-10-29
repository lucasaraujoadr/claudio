import { NextResponse, type NextRequest } from 'next/server'
import { decodificarArquivo, LIMITE_LINHAS_IMPORTACAO, lerCsv } from '@/lib/crm/csv'
import { salvarLote, TAMANHO_MAXIMO_ARQUIVO } from '@/lib/crm/importacao'

export const runtime = 'nodejs'

/** Recebe a planilha, guarda no servidor e leva à pré-visualização do lote. */
export async function POST(request: NextRequest) {
  const erro = (flag: string, extra = '') => NextResponse.redirect(new URL(`/crm/importar?erro=${flag}${extra}`, request.url), 303)
  let arquivo: FormDataEntryValue | null
  try {
    arquivo = (await request.formData()).get('arquivo')
  } catch {
    return erro('erro')
  }
  if (!(arquivo instanceof File) || arquivo.size === 0) return erro('vazio')
  if (arquivo.size > TAMANHO_MAXIMO_ARQUIVO) return erro('grande')
  if (!/\.(csv|txt)$/i.test(arquivo.name)) return erro('tipo')
  try {
    const { texto, codificacao } = decodificarArquivo(new Uint8Array(await arquivo.arrayBuffer()))
    const r = await salvarLote({ nomeArquivo: arquivo.name, texto })
    if (!r.ok) {
      const n = r.erro === 'linhas_demais' ? lerCsv(texto, Number.POSITIVE_INFINITY) : null
      const extra = n && n.ok ? `&n=${n.linhas.length}&limite=${LIMITE_LINHAS_IMPORTACAO}` : ''
      return erro(r.erro, extra)
    }
    const cod = codificacao === 'windows-1252' ? '&codificacao=windows-1252' : ''
    return NextResponse.redirect(new URL(`/crm/importar?lote=${r.id}${cod}`, request.url), 303)
  } catch (e) {
    console.error('crm: envio de planilha falhou:', e instanceof Error ? e.name : 'erro')
    return erro('erro')
  }
}
