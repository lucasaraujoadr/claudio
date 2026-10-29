import Link from 'next/link'
import { Aviso, BotaoEnviar, CabecalhoPagina, Cartao, classesBotao } from '@/components/ui'
import { CLASSES_ROTULO, classesCampo } from '@/components/ui/campo'
import { mensagemCampoLongo } from '@/lib/crm/formulario'
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
  const erro =
    sp.erro === 'longo' ? mensagemCampoLongo(typeof sp.campo === 'string' ? sp.campo : undefined) : typeof sp.erro === 'string' ? ERROS[sp.erro] : undefined
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CabecalhoPagina
        secao="CRM"
        titulo="Novo contato"
        subtitulo="Se o e-mail já estiver cadastrado, o que você digitar aqui atualiza o contato existente, sem mudar o status dele (a menos que você escolha um status)."
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
              <select id="c-status" name="status" defaultValue="" className={classesCampo()} aria-describedby="c-status-dica">
                <option value="">Lead (padrão)</option>
                <option value="cliente">Cliente</option>
                <option value="inativo">Inativo</option>
              </select>
              <p id="c-status-dica" className="text-xs text-tinta-suave">Num contato que já existe, o padrão não muda o status atual.</p>
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
