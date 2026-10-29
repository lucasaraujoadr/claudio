import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    globals: true,
    // O PGlite cria o schema a cada teste; sob carga paralela o hook passa dos 10 s padrão.
    hookTimeout: 30000,
    // Fuso atrás do UTC: expõe aritmética de datas em horário local.
    env: { TZ: 'America/Sao_Paulo' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
