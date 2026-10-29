import type { VercelConfig } from '@vercel/config/v1'

export const config: VercelConfig = {
  framework: 'nextjs',
  // Uma execução diária às 06:00 UTC = 03:00 em Brasília. O plano Hobby
  // permite apenas um cron por dia, e a janela do Search Console recua
  // 3 dias de qualquer forma, então granularidade maior não traria dado novo.
  crons: [{ path: '/api/cron/gsc', schedule: '0 6 * * *' }],
}
