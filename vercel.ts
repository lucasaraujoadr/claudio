import type { VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'nextjs',
  // Rotina única às 06:00 UTC = 03:00 em Brasília: Search Console e Google Analytics,
  // cada um isolado do outro. Hobby: até 100 crons por projeto, mas cada um só pode rodar
  // uma vez por dia (e com precisão de hora). /api/cron/gsc segue existindo, sem agendamento.
  crons: [{ path: '/api/cron/diario', schedule: '0 6 * * *' }],
}
