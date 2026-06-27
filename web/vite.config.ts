import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  esbuild: {
    jsxFactory: 'h',
    jsxFragment: 'Fragment',
    jsxInject: `import { h, Fragment } from 'preact'`,
  },
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
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
