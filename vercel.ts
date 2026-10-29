import type { VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'nextjs',
  // Rotina única às 06:00 UTC = 03:00 em Brasília: Search Console e Google Analytics,
  // cada um isolado do outro. Hobby: até 100 crons por projeto, mas cada um só pode rodar
  // uma vez por dia (e com precisão de hora). /api/cron/gsc segue existindo, sem agendamento.
  // Radar de tendências às 07:00 UTC, separado do diário: o diário tem teto de 120 s e o radar
  // faz duas chamadas de IA (até 300 s).
  crons: [
    { path: '/api/cron/diario', schedule: '0 6 * * *' },
    { path: '/api/cron/tendencias', schedule: '0 7 * * *' },
  ],
}
