import type { SVGProps } from 'react'

/** Ícones de status: a forma carrega o significado junto com a cor (nunca só a cor). */
export type Tom = 'critico' | 'aviso' | 'info' | 'sucesso'

const BASE: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

export function IconeTom({ tom, className = 'size-4' }: { tom: Tom; className?: string }) {
  switch (tom) {
    case 'critico':
      // Octógono com traço: "pare".
      return (
        <svg {...BASE} className={className}>
          <path d="M5.5 1.8h5l3.7 3.7v5l-3.7 3.7h-5l-3.7-3.7v-5z" />
          <path d="M8 5v3.4M8 10.9v.1" />
        </svg>
      )
    case 'aviso':
      // Triângulo: "atenção".
      return (
        <svg {...BASE} className={className}>
          <path d="M8 2.2 14.3 13.3H1.7z" />
          <path d="M8 6.4v3M8 11.4v.1" />
        </svg>
      )
    case 'info':
      return (
        <svg {...BASE} className={className}>
          <circle cx="8" cy="8" r="6.2" />
          <path d="M8 7.3v3.9M8 4.9v.1" />
        </svg>
      )
    case 'sucesso':
      return (
        <svg {...BASE} className={className}>
          <circle cx="8" cy="8" r="6.2" />
          <path d="m5.3 8.2 1.9 1.9 3.5-3.7" />
        </svg>
      )
  }
}
