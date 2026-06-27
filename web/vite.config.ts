import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

const buildSha = (() => {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_BUILD_SHA': JSON.stringify(buildSha),
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        'audio-worklet': resolve(__dirname, 'src/player/audio-worklet.js'),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'audio-worklet'
            ? 'audio-worklet.js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
});
