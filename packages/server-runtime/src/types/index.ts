import type { ServerOptions } from '@proj-airi/server-shared'

export interface ServerInstance {
  close: (closeActiveConnections?: boolean) => Promise<void>
}

export interface Server {
  getConnectionHost: () => string[]
  start: () => Promise<void>
  stop: () => Promise<void>
  restart: () => Promise<void>
  updateConfig: (newOptions: ServerOptions) => void
}
