import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // globals SENGAJA tidak dinyalakan. eslint.config.js hanya memuat globals.browser —
    // tidak ada dict vitest/jest — jadi test yang memakai describe/it/expect tanpa import
    // akan lolos vitest tapi GAGAL eslint no-undef. Import eksplisit dari 'vitest'
    // membuat kedua alat sepakat.
    setupFiles: ['./src/test/setup.js'],
    css: false,
    include: ['src/**/*.test.{js,jsx}'],
  },
});
