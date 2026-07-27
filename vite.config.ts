import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const host = process.env.TAURI_DEV_HOST
const elementCallDist = resolve('node_modules/@element-hq/element-call-embedded/dist')

const elementCall = () => ({
  name: 'foxchat-element-call',
  configureServer(server: { middlewares: { use: (path: string, handler: (req: { url?: string }, res: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body?: string | Buffer) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use('/element-call', (req, res, next) => {
      const relative = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '') || 'index.html'
      const file = resolve(elementCallDist, relative)
      if (!file.startsWith(elementCallDist) || !existsSync(file) || !statSync(file).isFile()) return next()
      const extension = file.split('.').pop()?.toLowerCase()
      const contentType = extension === 'html' ? 'text/html; charset=utf-8' : extension === 'js' ? 'text/javascript; charset=utf-8' : extension === 'css' ? 'text/css; charset=utf-8' : extension === 'json' ? 'application/json; charset=utf-8' : extension === 'svg' ? 'image/svg+xml' : extension === 'png' ? 'image/png' : extension === 'woff2' ? 'font/woff2' : extension === 'mp3' ? 'audio/mpeg' : extension === 'ogg' ? 'audio/ogg' : 'application/octet-stream'
      res.statusCode = 200
      res.setHeader('Content-Type', contentType)
      res.setHeader('Cache-Control', 'no-cache')
      res.end(readFileSync(file))
    })
  },
  closeBundle() {
    const output = resolve('dist/element-call')
    if (existsSync(elementCallDist)) cpSync(elementCallDist, output, { recursive: true })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), elementCall()],
  clearScreen: false,
  build: {
    rollupOptions: {
      input: {
        main: resolve('index.html'),
        popout: resolve('popout.html'),
      },
    },
  },
  server: {
    host: host || false,
    port: 5173,
    strictPort: true,
    hmr: host ? {
      protocol: 'ws',
      host,
      port: 5173,
    } : undefined,
  },
})
