import Link from 'next/link'
import { EstadoVazio, Selo, Tabela } from '@/components/ui'
import { formatarDataHora } from '../_compartilhado/sincronizacao'
import { SELO_SITUACAO, linkSeguro, type Situacao } from './situacao'

export type LinhaArtigo = {
  id: number
  titulo: string | null
  keyword: string
  situacao: Situacao
  atualizadoEm: Date
  wpLink: string | null
  alteradoAposEnvio: boolean
}

export function ListaArtigos({ artigos, filtro }: { artigos: LinhaArtigo[]; filtro?: Situacao }) {
  if (artigos.length === 0) {
    return filtro ? (
      <EstadoVazio titulo="Nenhum artigo com essa situação" explicacao="Escolha outro filtro para ver os demais artigos." />
    ) : (
      <EstadoVazio
        titulo="Nenhum artigo ainda"
        explicacao={
          <>
            Use &ldquo;Gerar artigo&rdquo; em uma tese, em <Link href="/tendencias">Tendências</Link>, ou em um tema, em{' '}
            <Link href="/temas">Temas</Link>. O artigo fica pronto em cerca de 2 minutos.
          </>
        }
      />
    )
  }
  return (
    <Tabela legenda="Artigos">
      <thead>
        <tr>
          <th scope="col">Título</th>
          <th scope="col">Palavra-chave</th>
          <th scope="col">Situação</th>
          <th scope="col">Atualizado em</th>
          <th scope="col">
            <span className="sr-only">Link no site</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {artigos.map((a) => {
          const selo = SELO_SITUACAO[a.situacao]
          const link = linkSeguro(a.wpLink)
          return (
            <tr key={a.id}>
              <td className="min-w-56">
                <Link href={`/artigos/${a.id}`} className="font-medium text-tinta underline-offset-2 hover:text-acento-texto hover:underline">
                  {a.titulo?.trim() || (a.situacao === 'gerando' ? 'Gerando…' : `Artigo ${a.id}`)}
                </Link>
              </td>
              <td className="text-tinta-suave">{a.keyword}</td>
              <td>
                <span className="flex flex-wrap gap-1">
                  <Selo variante={selo.variante}>{selo.rotulo}</Selo>
                  {a.alteradoAposEnvio && <Selo variante="aviso">Alterado após o envio</Selo>}
                </span>
              </td>
              <td className="whitespace-nowrap text-tinta-suave">{formatarDataHora(a.atualizadoEm)}</td>
              <td className="whitespace-nowrap">
                {link && (
                  <a href={link} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-acento-texto underline-offset-2 hover:underline">
                    ver no site <span className="sr-only">(abre em nova aba)</span>
                  </a>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </Tabela>
  )
}
