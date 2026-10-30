import { Selo, type VarianteSelo } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import { BASES_LEGAIS, ROTULO_BASE_LEGAL, ROTULO_STATUS, type BaseLegal, type StatusContato } from '@/lib/crm/campos'
import type { Contato } from '@/lib/db/schema'

export const VARIANTE_STATUS: Record<StatusContato, VarianteSelo> = {
  lead: 'acento',
  cliente: 'sucesso',
  inativo: 'neutro',
  descadastrado: 'critico',
}

export function SeloStatus({ status }: { status: StatusContato }) {
  return <Selo variante={VARIANTE_STATUS[status]}>{ROTULO_STATUS[status]}</Selo>
}

const ROTULO_SYNC: Record<Contato['syncStatus'], { texto: string; variante: VarianteSelo }> = {
  pendente: { texto: 'Resend: pendente', variante: 'neutro' },
  sincronizado: { texto: 'Resend: sincronizado', variante: 'sucesso' },
  erro: { texto: 'Resend: erro', variante: 'aviso' },
}

export function SeloSync({ status }: { status: Contato['syncStatus'] }) {
  const s = ROTULO_SYNC[status]
  return <Selo variante={s.variante}>{s.texto}</Selo>
}

export const EXPLICACAO_BASE_LEGAL: Record<BaseLegal, string> = {
  consentimento: 'A pessoa pediu para receber (formulário, inscrição, pedido por escrito).',
  legitimo_interesse: 'Contato profissional sem pedido expresso (prospecção). Exige descadastro fácil em todo email.',
  contrato: 'Cliente ou relação contratual em andamento.',
}

/** Rádios de base legal, obrigatórios. Sem valor marcado de propósito quando `atual` é indefinido. */
export function CampoBaseLegal({ atual, legenda = 'Base legal (LGPD)' }: { atual?: BaseLegal; legenda?: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className={CLASSES_ROTULO}>
        {legenda} <span className="text-critico" aria-hidden="true">*</span>
        <span className="sr-only">(obrigatório)</span>
      </legend>
      {BASES_LEGAIS.map((b) => (
        <label key={b} className="flex items-start gap-2 text-sm text-tinta">
          <input type="radio" name="base_legal" value={b} required defaultChecked={atual === b} className="mt-1 accent-acento" />
          <span>
            <span className="font-medium">{ROTULO_BASE_LEGAL[b]}</span>
            <span className="block text-xs text-tinta-suave">{EXPLICACAO_BASE_LEGAL[b]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  )
}

type Valores = Partial<Pick<Contato, 'nome' | 'telefone' | 'escritorio' | 'cidade' | 'uf' | 'notas'>> & { tags?: string[] }

/** Campos comuns ao cadastro e à edição (sem email, status e base legal). */
export function CamposContato({ v = {} }: { v?: Valores }) {
  const campo = (nome: string, rotulo: string, valor: string | null | undefined, extra: Record<string, string | number> = {}) => (
    <div className="space-y-1">
      <label htmlFor={`c-${nome}`} className={CLASSES_ROTULO}>{rotulo}</label>
      <input id={`c-${nome}`} name={nome} defaultValue={valor ?? ''} className={classesCampo()} {...extra} />
    </div>
  )
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {campo('nome', 'Nome', v.nome, { maxLength: 200, autoComplete: 'off' })}
      {campo('telefone', 'Telefone', v.telefone, { maxLength: 60, type: 'tel', autoComplete: 'off' })}
      {campo('escritorio', 'Escritório', v.escritorio, { maxLength: 200 })}
      <div className="grid grid-cols-[1fr_6rem] gap-3">
        {campo('cidade', 'Cidade', v.cidade, { maxLength: 120 })}
        {campo('uf', 'UF', v.uf, { maxLength: 30, placeholder: 'SP' })}
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor="c-tags" className={CLASSES_ROTULO}>Tags</label>
        <input id="c-tags" name="tags" defaultValue={(v.tags ?? []).join(', ')} className={classesCampo()} maxLength={1000} aria-describedby="c-tags-dica" />
        <p id="c-tags-dica" className="text-xs text-tinta-suave">Separe por vírgula. Ex.: trabalhista, campinas, indicação</p>
      </div>
      <div className="space-y-1 sm:col-span-2">
        <label htmlFor="c-notas" className={CLASSES_ROTULO}>Notas</label>
        <textarea id="c-notas" name="notas" rows={4} defaultValue={v.notas ?? ''} className={classesCampo()} maxLength={5000} />
      </div>
    </div>
  )
}

const dataHora = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })
export function formatarQuando(d: Date): string {
  return dataHora.format(d)
}
