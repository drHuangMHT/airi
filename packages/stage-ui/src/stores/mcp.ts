import { defineStore } from 'pinia'

import { useLocalStorageWithDefault } from '../../../stage-shared/src/composables/use-local-storage-manual-reset'

export const useMcpStore = defineStore('mcp', () => {
  const serverCmd = useLocalStorageWithDefault<string>('settings/mcp/server-cmd', '')
  const serverArgs = useLocalStorageWithDefault<string>('settings/mcp/server-args', '')
  const connected = useLocalStorageWithDefault<boolean>('mcp/connected', false) // use local storage to sync between windows

  function resetState() {
    serverCmd.reset()
    serverArgs.reset()
    connected.reset()
  }

  return {
    serverCmd,
    serverArgs,
    connected,
    resetState,
  }
})
