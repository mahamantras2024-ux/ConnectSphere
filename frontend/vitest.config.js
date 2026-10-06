// File: Configures React transformations and jsdom for frontend Vitest tests.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
// Resolves dependencies for test files now stored in the root tests folder.
const dependency = name => fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: { fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  resolve: { alias: ['react-dom', 'react-router-dom', 'react', '@testing-library/react', '@testing-library/jest-dom', 'vitest', 'leaflet'].map(name => ({ find: name, replacement: dependency(name) })) },
  test: {
    include: ['../tests/frontend/**/*.test.{js,jsx}'],
    environment: 'jsdom', clearMocks: true,
    maxWorkers: 3,
    coverage: { provider: 'v8', include: ['src/**/*.{js,jsx}'], reporter: ['text', 'html', 'json', 'json-summary'], reportsDirectory: '../coverage/frontend', thresholds: { statements:100, branches:100, functions:100, lines:100, perFile:true } },
  },
});
