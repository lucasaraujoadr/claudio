import Link from 'next/link'
import { BotaoEnviar, classesBotao } from '@/components/ui'

/**
 * Atalho para o artigo de uma tese ou de um tema: "Abrir artigo" se já existe; senão
 * "Gerar artigo" (POST `/api/artigos/gerar`). Sem IA configurada, o botão fica desabilitado
 * com a explicação ao lado.
 */
export function AtalhoArtigo({
  artigoId,
  campo,
  valor,
  iaConfigurada,
}: {
  artigoId: number | null | undefined
  campo: 'topicId' | 'teseId'
  valor: number
  iaConfigurada: boolean
}) {
  if (artigoId) {
    return (
      <Link href={`/artigos/${artigoId}`} className={classesBotao('secundario', 'sm')}>
        Abrir artigo
      </Link>
    )
  }
  if (!iaConfigurada) {
    return (
      <span className="inline-flex flex-col items-end gap-1 text-right">
        <button type="button" disabled aria-describedby={`dica-artigo-${campo}-${valor}`} className={classesBotao('secundario', 'sm')}>
          Gerar artigo
        </button>
        <span id={`dica-artigo-${campo}-${valor}`} className="max-w-56 text-xs text-tinta-suave">
          IA não configurada (OPENROUTER_API_KEY).
        </span>
      </span>
    )
  }
  return (
    <form method="POST" action="/api/artigos/gerar">
      <input type="hidden" name={campo} value={valor} />
      <BotaoEnviar rotuloEnviando="Gerando…" variante="secundario" tamanho="sm">
        Gerar artigo
      </BotaoEnviar>
    </form>
  )
}
