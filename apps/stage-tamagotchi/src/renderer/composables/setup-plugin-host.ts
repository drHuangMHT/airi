import type { useElectronEventaContext } from '@proj-airi/electron-vueuse'

import { defineInvokeHandler } from '@moeru/eventa'
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { usePluginHostInspectorStore } from '@proj-airi/stage-ui/stores/devtools/plugin-host-debug'
import { listProvidersForPluginHost, shouldPublishPluginHostCapabilities } from '@proj-airi/stage-ui/stores/plugin-host-capabilities'

import { electronPluginUpdateCapability, pluginProtocolListProviders, pluginProtocolListProvidersEventName } from '../../shared/eventa/plugin/capabilities'
import {
  electronPluginInspect,
  electronPluginList,
  electronPluginLoad,
  electronPluginLoadEnabled,
  electronPluginSetAutoReload,
  electronPluginSetEnabled,
  electronPluginUnload,
} from '../../shared/eventa/plugin/host'
import { useTamagotchiPluginToolsStore } from '../stores/plugin-tools'

export function useSetupPluginHost() {
  const pluginHostInspectorStore = usePluginHostInspectorStore()
  const pluginToolsStore = useTamagotchiPluginToolsStore()
  const listPlugins = useElectronEventaInvoke(electronPluginList)

  const setPluginEnabled = useElectronEventaInvoke(electronPluginSetEnabled)
  const setPluginAutoReload = useElectronEventaInvoke(electronPluginSetAutoReload)
  const loadEnabledPlugins = useElectronEventaInvoke(electronPluginLoadEnabled)
  const loadPlugin = useElectronEventaInvoke(electronPluginLoad)
  const unloadPlugin = useElectronEventaInvoke(electronPluginUnload)
  const inspectPluginHost = useElectronEventaInvoke(electronPluginInspect)
  const reportPluginCapability = useElectronEventaInvoke(electronPluginUpdateCapability)

  async function refreshPluginRuntimeTools() {
    try {
      await pluginToolsStore.refresh()
    }
    catch (error) {
      console.warn('[App] Failed to refresh plugin runtime tools:', error)
    }
  }
  refreshPluginRuntimeTools()

  // NOTICE: register plugin host bridge during setup to avoid race with pages using it in immediate watchers.
  pluginHostInspectorStore.setBridge({
    list: () => listPlugins(),
    setEnabled: async (payload) => {
      const result = await setPluginEnabled(payload)
      await refreshPluginRuntimeTools()
      return result
    },
    setAutoReload: payload => setPluginAutoReload(payload),
    loadEnabled: async () => {
      const result = await loadEnabledPlugins()
      await refreshPluginRuntimeTools()
      return result
    },
    load: async (payload) => {
      const result = await loadPlugin(payload)
      await refreshPluginRuntimeTools()
      return result
    },
    unload: async (payload) => {
      const result = await unloadPlugin(payload)
      await refreshPluginRuntimeTools()
      return result
    },
    inspect: () => inspectPluginHost(),
  })
  async function onMountedHooks(eventaCtx: ReturnType<typeof useElectronEventaContext>) {
    if (shouldPublishPluginHostCapabilities()) {
      reportPluginCapability({
        key: pluginProtocolListProvidersEventName,
        state: 'ready',
        metadata: {
          source: 'stage-ui',
        },
      })
    }
    // Expose stage provider definitions to plugin host APIs.
    defineInvokeHandler(eventaCtx.value, pluginProtocolListProviders, async () => listProvidersForPluginHost())
  }

  return { onMountedHooks }
}
