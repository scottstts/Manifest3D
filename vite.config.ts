import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const localOpenAIApiKeyEndpoint = '/__manifest3d/local-openai-api-key'

// https://vite.dev/config/
export default defineConfig({
  envPrefix: 'MANIFEST3D_PUBLIC_',
  plugins: [localOpenAIApiKeyPlugin(), react()],
})

function localOpenAIApiKeyPlugin(): Plugin {
  let apiKey = ''

  return {
    name: 'manifest3d-local-openai-api-key',
    apply: 'serve',
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir, '')

      apiKey = (
        env.OPENAI_API_KEY ??
        env.VITE_OPENAI_API_KEY ??
        ''
      ).trim()
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith(localOpenAIApiKeyEndpoint)) {
          next()
          return
        }

        if (request.method !== 'GET') {
          response.statusCode = 405
          response.setHeader('Allow', 'GET')
          response.end()
          return
        }

        if (!isLocalhostHostHeader(request.headers.host)) {
          response.statusCode = 404
          response.end()
          return
        }

        response.statusCode = 200
        response.setHeader('Cache-Control', 'no-store')
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ apiKey }))
      })
    },
  }
}

function isLocalhostHostHeader(hostHeader: string | undefined) {
  const hostname = normalizeHostHeader(hostHeader ?? '')

  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  )
}

function normalizeHostHeader(hostHeader: string) {
  const normalizedHostHeader = hostHeader.trim().toLowerCase()

  if (normalizedHostHeader.startsWith('[')) {
    const closingBracketIndex = normalizedHostHeader.indexOf(']')

    return closingBracketIndex >= 0
      ? normalizedHostHeader.slice(0, closingBracketIndex + 1)
      : normalizedHostHeader
  }

  return normalizedHostHeader.split(':')[0] ?? ''
}
