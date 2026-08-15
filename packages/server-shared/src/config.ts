import type { Format, LogLevelString } from '@guiiai/logg'

import type { RouteMiddleware, RoutingPolicy } from './middleware'
import type { MessageHeartbeat } from './types'

export interface AppOptions {
  instanceId?: string
  auth?: {
    token: string
  }
  logger?: {
    app?: { level?: LogLevelString, format?: Format }
    websocket?: { level?: LogLevelString, format?: Format }
  }
  routing?: {
    middleware?: RouteMiddleware[]
    allowBypass?: boolean
    policy?: RoutingPolicy
  }
  heartbeat?: {
    readTimeout?: number
    message?: MessageHeartbeat | string
  }
}

export interface ServerOptions extends AppOptions {
  port?: number
  hostname?: string
  tlsConfig?: {
    cert?: string
    key?: string
    passphrase?: string
  } | null
}
