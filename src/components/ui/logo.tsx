import Image from 'next/image'
import { cx } from './cx'
// Import estático: a imagem sai em /_next/static/…, liberado pelo proxy (o login a mostra
// antes de haver sessão; /logo-og.png direto em public/ seria redirecionado).
import logoEscuro from '../../../public/logo-og.png'
import logoClaro from '../../../public/logo-og-claro.png'

export type LogoProps = {
  /** Largura em px; a altura acompanha a proporção. */
  largura?: number
  className?: string
  /** Carrega cedo (login, onde o logo é o maior elemento acima da dobra). */
  prioridade?: boolean
}

const ALT = 'Oliveira Guimarães — cálculos e perícias'

/**
 * Logo completo. O original dourado é feito para fundo escuro; no tema claro usa-se a
 * versão em dourado escuro (#7A580C, 5,9:1 sobre o fundo claro), que mantém a leitura do
 * subtítulo fino. A troca é só por CSS — sem divergência de hidratação.
 */
export function Logo({ largura = 200, className, prioridade = false }: LogoProps) {
  const altura = Math.round((largura * logoEscuro.height) / logoEscuro.width)
  return (
    <span className={cx('inline-block', className)} style={{ width: largura, height: altura }}>
      <Image src={logoClaro} alt={ALT} width={largura} height={altura} priority={prioridade} className="h-full w-full dark:hidden" />
      <Image src={logoEscuro} alt={ALT} width={largura} height={altura} priority={prioridade} className="hidden h-full w-full dark:block" />
    </span>
  )
}
