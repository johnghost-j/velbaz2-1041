import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Chaque test unitaire cible du code pur (pas de DB/serveur).
    testTimeout: 10_000,
  },
});
