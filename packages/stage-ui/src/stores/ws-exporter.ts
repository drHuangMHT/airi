const WS_URL = 'ws://localhost:8467'

let socket: WebSocket

export function connectWsConnector() {
  if (socket !== undefined)
    return socket
  socket = new WebSocket(WS_URL)

  socket.addEventListener('open', () => {
    console.info('Connected to server')
  })

  socket.addEventListener('message', (event) => {
    console.info(`Client received: ${event.data}`)
  })

  socket.addEventListener('error', error => console.error('WebSocket error:', error))
  socket.addEventListener('close', () => console.info('Connection closed'))
  return socket
}
