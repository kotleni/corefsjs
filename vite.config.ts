import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve('src/index.ts'),
      name: 'CoreFS',
      fileName: 'corefs',
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {
        },
      },
    },
  },
  plugins: [dts({ rollupTypes: true })],
});
