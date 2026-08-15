import type { ServerOptions } from '@proj-airi/server-shared'

import type { Server, ServerInstance } from '../types'

import { useLogg } from '@guiiai/logg'
import { merge } from '@moeru/std'
import { plugin as ws } from 'crossws/server'
import { serve } from 'h3'

import { normalizeLoggerConfig, setupApp } from '..'
import { getLocalIPs } from '../utils/local_addresses'

/**
 * Creates the websocket server controller for the AIRI runtime.
 *
 * Use when:
 * - Starting, stopping, or restarting the standalone runtime server
 * - Updating bind options between restarts
 *
 * Expects:
 * - The returned controller to manage a single active server instance at a time
 *
 * Returns:
 * - Lifecycle helpers for starting, stopping, restarting, and updating server options
 */
export function createServer(opts?: ServerOptions): Server {
  let options = merge<ServerOptions>({ port: 6121, hostname: '127.0.0.1' }, opts)

  const { appLogFormat, appLogLevel } = normalizeLoggerConfig(options)
  const log = useLogg('@proj-airi/server-runtime/server').withLogLevelString(appLogLevel).withFormat(appLogFormat)
  let serverInstance: ServerInstance | null = null
  let startTask: Promise<void> | null = null

  log.withFields({ hasTlsConfig: !!options?.tlsConfig }).log('creating server channel')

  async function closeServer(closeActiveConnections = false) {
    if (!serverInstance || typeof serverInstance.close !== 'function') {
      return
    }

    try {
      if (closeActiveConnections) {
        log.log('closing existing server instance')
      }
      await serverInstance.close(closeActiveConnections)
      if (closeActiveConnections) {
        log.log('existing server instance closed')
      }
    }
    catch (error) {
      const nodejsError = error as NodeJS.ErrnoException
      if ('code' in nodejsError && nodejsError.code === 'ERR_SERVER_NOT_RUNNING') {
        return
      }

      log.withError(error).error('Error closing WebSocket server')
    }
    finally {
      serverInstance = null
    }
  }

  async function start() {
    if (serverInstance) {
      return
    }
    if (startTask) {
      return startTask
    }

    startTask = (async () => {
      const secureEnabled = options?.tlsConfig != null
      const h3App = setupApp(options)

      const port = options.port
      const hostname = options.hostname

      const instance = serve(h3App.app, {
        // @ts-expect-error - the .crossws property wasn't extended in types
        plugins: [ws({ resolve: async req => (await h3App.app.fetch(req)).crossws })],
        port,
        hostname,
        tls: options?.tlsConfig || undefined,
        reusePort: true,
        silent: true,
        manual: true,
        gracefulShutdown: {
          forceTimeout: 0.5,
          gracefulTimeout: 0.5,
        },
      })

      try {
        serverInstance = {
          close: async (closeActiveConnections = false) => {
            h3App.dispose()
            log.log('closing server instance')
            await instance.close(closeActiveConnections)
            log.log('server instance closed')
          },
        }

        await instance.serve()

        const protocol = secureEnabled ? 'wss' : 'ws'
        if (hostname === '0.0.0.0') {
          const ips = getLocalIPs().filter(ip => ip !== '127.0.0.1' && ip !== '::1')
          const targets = ips.length > 0 ? ips.join(', ') : 'localhost'
          log.log(`@proj-airi/server-runtime started on ${protocol}://0.0.0.0:${port} (reachable via: ${targets})`)
        }
        else {
          log.log(`@proj-airi/server-runtime started on ${protocol}://${hostname}:${port}`)
        }
      }
      catch (error) {
        serverInstance = null
        h3App.dispose()
        await instance.close(true).catch(() => {})
        if (isAddressInUseError(error)) {
          log.withError(error).warn('WebSocket server port already in use, assuming an existing listener is available')
          return
        }
        log.withError(error).error('failed to start WebSocket server')
        throw error
      }
    })().finally(() => {
      startTask = null
    })

    return startTask
  }
  async function stop() {
    await closeServer(true)
  }

  async function restart() {
    log.log('restarting server channel', { options })
    await closeServer(true)
    await start()
  }

  function updateConfig(newOptions: ServerOptions) {
    options = merge<ServerOptions>(options, newOptions)
  }

  return {
    getConnectionHost: () => {
      if (options.hostname && options.hostname !== '0.0.0.0' && options.hostname !== '::')
        return [options.hostname]
      return getLocalIPs()
    },
    start,
    stop,
    restart,
    updateConfig,
  }
}

function isAddressInUseError(error: unknown) {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
}
