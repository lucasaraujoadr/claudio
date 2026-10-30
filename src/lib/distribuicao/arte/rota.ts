import { NextResponse } from 'next/server'
import { idDaRota } from '@/lib/artigos/visao'
import { obterPeca, type PecaComSlug } from '../repositorio'
import type { Carrossel } from '../schemas'
import { carrosselDaPeca } from './pacote'

export const CABECALHOS_ARQUIVO = 'private, max-age=0, must-revalidate'

export type CarrosselDaRota = { peca: PecaComSlug; carrossel: Carrossel; variacao: 'escura' | 'clara' }

/** Peça do carrossel pelo id da rota; qualquer outra coisa (id ruim, outro tipo, sem conteúdo) é 404. */
export async function carrosselDaRota(idBruto: string): Promise<CarrosselDaRota | NextResponse> {
  const id = idDaRota(idBruto)
  const naoEncontrada = () => NextResponse.json({ erro: 'peça não encontrada' }, { status: 404 })
  if (!id) return naoEncontrada()
  const peca = await obterPeca(id)
  if (!peca || peca.tipo !== 'carrossel') return naoEncontrada()
  const carrossel = carrosselDaPeca(peca.conteudo)
  if (!carrossel) return naoEncontrada()
  return { peca, carrossel, variacao: peca.variacao === 'clara' ? 'clara' : 'escura' }
}

export function respostaArquivo(corpo: Uint8Array, tipo: string, nome: string, inline: boolean) {
  return new Response(corpo as BodyInit, {
    headers: {
      'Content-Type': tipo,
      'Content-Length': String(corpo.byteLength),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${nome}"`,
      'Cache-Control': CABECALHOS_ARQUIVO,
    },
  })
}
