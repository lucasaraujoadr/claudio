import Link from 'next/link'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, classesBotao } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import { ROTULO_STATUS } from '@/lib/crm/campos'
import { CampoBaseLegal, CamposContato } from '../_compartilhado'

export const metadata = { title: 'Novo contato' }

const ERROS: Record<string, string> = {
  email: 'Informe um e-mail válido.',
  'base-legal': 'Escolha a base legal do contato. Ela é obrigatória.',
  uf: 'UF inválida. Use a sigla do estado (ex.: SP) ou deixe em branco.',
  status: 'Status inválido.',
  erro: 'Não foi possível salvar. Nada foi gravado; tente novamente.',
}

export default async function NovoContatoPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const erro = typeof sp.erro === 'string' ? ERROS[sp.erro] : undefined
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CabecalhoPagina
        secao="CRM"
        titulo="Novo contato"
        subtitulo="Se o e-mail já estiver cadastrado, os dados novos completam o contato existente."
        acoes={<Link href="/crm/contatos" className={classesBotao('fantasma')}>Voltar à lista</Link>}
      />
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      <Cartao>
        <form method="POST" action="/api/crm/contatos" className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="c-email" className={CLASSES_ROTULO}>
                E-mail <span className="text-critico" aria-hidden="true">*</span>
              </label>
              <input id="c-email" name="email" type="email" required maxLength={254} autoComplete="off" className={classesCampo()} />
            </div>
            <div className="space-y-1">
              <label htmlFor="c-status" className={CLASSES_ROTULO}>Status</label>
              <select id="c-status" name="status" defaultValue="lead" className={classesCampo()}>
                {(['lead', 'cliente', 'inativo'] as const).map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
              </select>
            </div>
          </div>
          <CamposContato />
          <CampoBaseLegal />
          <div className="flex justify-end gap-2 border-t border-borda pt-4">
            <Link href="/crm/contatos" className={classesBotao('secundario')}>Cancelar</Link>
            <BotaoEnviar rotuloEnviando="Salvando…">Salvar contato</BotaoEnviar>
          </div>
        </form>
      </Cartao>
    </div>
  )
}
