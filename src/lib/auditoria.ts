/**
 * Uma run em `rodando` há mais que isto é tratada como morta (função encerrada pela
 * plataforma, redeploy no meio do rastreio, falha do banco no catch). A rota de
 * rastreamento a marca como `falhou` antes de iniciar outra; a página deixa de
 * esconder o botão.
 */
export const MINUTOS_ATE_RUN_TRAVADA = 15

/** Issue gravada quando o rastreamento parou por tempo: a auditoria está incompleta. */
export const REGRA_INTERROMPIDO = 'rastreamento-interrompido'

export function runTravada(
  run: { status: 'rodando' | 'concluido' | 'falhou'; iniciadoEm: Date },
  agora: Date,
): boolean {
  if (run.status !== 'rodando') return false
  return agora.getTime() - run.iniciadoEm.getTime() > MINUTOS_ATE_RUN_TRAVADA * 60_000
}
