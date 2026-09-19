import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: {
          index: resolve('electron/main.ts'),
          'sqlite-worker': resolve('electron/market/sqlite-worker.ts')
        },
        formats: ['cjs']
      },
      rollupOptions: { output: { entryFileNames: '[name].js' } }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve('electron/preload.ts'), formats: ['cjs'] },
      rollupOptions: { output: { entryFileNames: 'index.js' } }
    }
  },
  renderer: {
    root: 'src',
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/index.html'),
          monitor: resolve('src/monitor.html'),
          float: resolve('src/float.html')
        }
      }
    },
    plugins: [react()],
    css: { postcss: { plugins: [] } },
    resolve: {
      alias: { '@': resolve('src') }
    }
  }
})
