import { Selo } from '@/components/ui'
import type { Funil, FunilInscricao } from '@/lib/db/schema'

export const ROTULO_INSCRICAO: Record<FunilInscricao['status'], string> = { ativo: 'Ativo', concluido: 'Concluído', saiu: 'Saiu' }
export const ROTULO_CAMINHO: Record<string, string> = { site: 'Formulário do site', manual: 'Tela', cron: 'Rotina diária' }

export function SeloFunil({ f }: { f: Pick<Funil, 'ativo'> }) {
  return f.ativo ? <Selo variante="sucesso">Ligado</Selo> : <Selo variante="neutro">Desligado</Selo>
}
