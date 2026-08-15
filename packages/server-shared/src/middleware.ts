import type { AuthenticatedPeer } from './peer'
import type { RouteTargetExpression, WebSocketEvent } from './types'

export interface RoutingPolicy {
  allowPlugins?: string[]
  denyPlugins?: string[]
  allowLabels?: string[]
  denyLabels?: string[]
}

export type RouteDecision
  = | { type: 'drop' }
    | { type: 'broadcast' }
    | { type: 'targets', targetIds: Set<string> }

export interface RouteContext {
  event: WebSocketEvent
  fromPeer: AuthenticatedPeer
  peers: Map<string, AuthenticatedPeer>
  destinations?: Array<string | RouteTargetExpression>
}

export type RouteMiddleware = (context: RouteContext) => RouteDecision | void
