import { ErroResend, type ClienteResend } from '@/lib/resend'

export type ChamadaContatos =
  | { op: 'salvar'; corpo: Parameters<ClienteResend['salvarContato']>[0] }
  | { op: 'segmento'; nome: string }
  | { op: 'adicionar'; email: string; segmentoId: string }
  | { op: 'remover'; email: string; segmentoId: string }

/** Cliente do Resend em memória para a sincronização de contatos: nunca chama a rede. */
export function resendContatosFalso() {
  const chamadas: ChamadaContatos[] = []
  const falhas = new Map<string, ErroResend>()
  let n = 0
  const falharSe = (op: string, email: string) => {
    const e = falhas.get(`${op}:${email}`)
    if (e) throw e
  }
  const cliente = {
    salvarContato: async (c: Parameters<ClienteResend['salvarContato']>[0]) => {
      chamadas.push({ op: 'salvar', corpo: c })
      falharSe('salvar', c.email)
      return { id: `rc_${++n}` }
    },
    garantirSegmento: async (nome: string) => {
      chamadas.push({ op: 'segmento', nome })
      return { id: 'seg_newsletter' }
    },
    adicionarAoSegmento: async (email: string, segmentoId: string) => {
      chamadas.push({ op: 'adicionar', email, segmentoId })
      falharSe('adicionar', email)
    },
    removerDoSegmento: async (email: string, segmentoId: string) => {
      chamadas.push({ op: 'remover', email, segmentoId })
      falharSe('remover', email)
    },
  } as unknown as ClienteResend
  return {
    cliente,
    chamadas,
    /** Faz a operação (`salvar`, `adicionar`, `remover`) falhar para este email. */
    falhar: (op: 'salvar' | 'adicionar' | 'remover', email: string, erro: ErroResend) => falhas.set(`${op}:${email}`, erro),
    de: (op: ChamadaContatos['op']) => chamadas.filter((c) => c.op === op),
  }
}
