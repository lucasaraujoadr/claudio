import { Selo } from '@/components/ui'
import type { Funil, FunilInscricao } from '@/lib/db/schema'

export const ROTULO_INSCRICAO: Record<FunilInscricao['status'], string> = { ativo: 'Ativo', concluido: 'Concluído', saiu: 'Saiu' }
export const ROTULO_CAMINHO: Record<string, string> = { site: 'Formulário do site', manual: 'Tela', cron: 'Rotina diária' }

export function SeloFunil({ f }: { f: Pick<Funil, 'ativo'> }) {
  return f.ativo ? <Selo variante="sucesso">Ligado</Selo> : <Selo variante="neutro">Desligado</Selo>
}

export function SeloLista({ f, conectado }: { f: Pick<Funil, 'brevoListaId'>; conectado: boolean }) {
  if (f.brevoListaId === null) return <Selo variante="aviso">Sem lista no Brevo</Selo>
  return <Selo variante={conectado ? 'sucesso' : 'neutro'}>Lista {f.brevoListaId}</Selo>
}
