<script setup lang="ts">
import { useElectronEventaContext, useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { themeColorFromValue, useThemeColor } from '@proj-airi/stage-layouts/composables/theme-color'
import { artistrySyncConfig, IS_DEV } from '@proj-airi/stage-shared'
import { ToasterRoot } from '@proj-airi/stage-ui/components'
import { useInferencePreload } from '@proj-airi/stage-ui/composables'
import { useSharedAnalyticsStore } from '@proj-airi/stage-ui/stores/analytics'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useArtistryStore } from '@proj-airi/stage-ui/stores/modules/artistry'
import { usePerfTracerBridgeStore } from '@proj-airi/stage-ui/stores/perf-tracer-bridge'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { useTheme } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { onMounted, onUnmounted, watch } from 'vue'
import { RouterView, useRoute, useRouter } from 'vue-router'
import { toast, Toaster } from 'vue-sonner'

import ResizeHandler from './components/ResizeHandler.vue'

import {
  electronGetServerChannelConfig,
  electronGodotStageGetStatus,
  electronGodotStageStatusChanged,
  electronSettingsNavigate,
  i18nGetLocale,
  i18nSetLocale,
} from '../shared/eventa'
// import { initializeElectronAuthCallbackBridge } from './bridges/electron-auth-callback.old.js'
import { initializeStageThreeRuntimeTraceBridge } from './bridges/stage-three-runtime-trace'
import { useSetupPluginHost } from './composables/setup-plugin-host'
import { useLanguage } from './composables/use-language'
import { useTamagotchiMcpToolsStore } from './stores/mcp-tools'
import { useTamagotchiPluginToolsStore } from './stores/plugin-tools'
import { useServerChannelSettingsStore } from './stores/settings/server-channel'
import { useStageWindowLifecycleStore } from './stores/stage-window-lifecycle'

const { isDark: dark } = useTheme()
const displayModelsStore = useDisplayModelsStore()
const settingsStore = useSettings()
const { language, themeColorsHue, themeColorsHueDynamic } = storeToRefs(settingsStore)
const serverChannelSettingsStore = useServerChannelSettingsStore()
const router = useRouter()
const route = useRoute()
const analyticsStore = useSharedAnalyticsStore()
const inferencePreload = useInferencePreload()
const mcpToolsStore = useTamagotchiMcpToolsStore()
const pluginToolsStore = useTamagotchiPluginToolsStore()
const stageWindowLifecycleStore = useStageWindowLifecycleStore()
const settingsAudioDeviceStore = useSettingsAudioDevice()
const artistryStore = useArtistryStore()
const { activeProvider, artistryGlobals, activeModel, defaultPromptPrefix, providerOptions } = storeToRefs(artistryStore)
const context = useElectronEventaContext()
usePerfTracerBridgeStore()
initializeStageThreeRuntimeTraceBridge()
// initializeElectronAuthCallbackBridge()
void stageWindowLifecycleStore.initializeWindowLifecycleBridge()
const getServerChannelConfig = useElectronEventaInvoke(electronGetServerChannelConfig)
const getMainLocale = useElectronEventaInvoke(i18nGetLocale)
const setLocale = useElectronEventaInvoke(i18nSetLocale)
const getGodotStageStatus = useElectronEventaInvoke(electronGodotStageGetStatus)
const syncArtistryConfig = useElectronEventaInvoke(artistrySyncConfig)
const isGodotStageRoute = () => route.path === '/' || route.path.startsWith('/settings')
const { onMountedHooks: pluginHostMountedHooks } = useSetupPluginHost()

function syncGodotStageRenderer(state: { state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error' }) {
  if (state.state === 'running') {
    settingsStore.setStageModelRenderer('godot')
    return
  }

  if ((state.state === 'stopped' || state.state === 'error') && settingsStore.stageModelRenderer === 'godot')
    settingsStore.restoreBuiltInStageModelRenderer()
}

// NOTICE: Runtime tool stores must register during setup so renderer consumers can see them
// before `onMounted()` finishes the rest of the startup flow.
void mcpToolsStore.refresh().catch((error) => {
  console.warn('[App] Failed to refresh MCP runtime tools:', error)
})

const { restore: restoreLocale } = useLanguage(language, getMainLocale, setLocale)

watch([activeProvider, artistryGlobals, activeModel, defaultPromptPrefix, providerOptions], () => {
  if (activeProvider.value) {
    void syncArtistryConfig({
      provider: activeProvider.value as string,
      globals: JSON.parse(JSON.stringify(artistryGlobals.value)),
      model: activeModel.value,
      promptPrefix: defaultPromptPrefix.value,
      options: providerOptions.value,
    })
  }
}, { deep: true, immediate: true })

const { updateThemeColor } = useThemeColor(themeColorFromValue({ light: 'rgb(255 255 255)', dark: 'rgb(18 18 18)' }))
watch(dark, () => updateThemeColor(), { immediate: true })
watch(route, () => updateThemeColor(), { immediate: true })
onMounted(() => updateThemeColor())

context.value.on(electronSettingsNavigate, (event) => {
  const targetRoute = event?.body?.route
  if (!targetRoute || route.fullPath === targetRoute) {
    return
  }

  void router.push(targetRoute).catch((error) => {
    console.warn('Failed to navigate settings window:', error)
  })
})

context.value.on(electronGodotStageStatusChanged, (event) => {
  if (!event.body) {
    return
  }

  syncGodotStageRenderer(event.body)
})

onMounted(async () => {
  // NOTICE: Issue #1658
  // When Electron restarts, renderer localStorage may not be flushed to disk.
  // The store's onMounted hook falls back to navigator.language, which triggers
  // watch(language) and overwrites the main-process config with the OS locale.
  // We must restore the correct locale from main process before allowing sync.
  // https://github.com/moeru-ai/airi/issues/1658
  await restoreLocale()

  if (!IS_DEV)
    analyticsStore.initialize()
  await displayModelsStore.initialize()

  // await chatSessionStore.initialize()
  await displayModelsStore.loadDisplayModelsFromIndexedDB()
  await settingsStore.initializeStageModel()
  await settingsAudioDeviceStore.initialize()

  if (isGodotStageRoute()) {
    try {
      syncGodotStageRenderer(await getGodotStageStatus())
    }
    catch (error) {
      console.warn('[App] Failed to fetch Godot stage status:', error)
    }
  }
  pluginHostMountedHooks(context)
  const serverChannelConfig = await getServerChannelConfig()
  serverChannelSettingsStore.tlsConfig = serverChannelConfig.tlsConfig ?? null
  serverChannelSettingsStore.hostname = serverChannelConfig.hostname
  serverChannelSettingsStore.authToken = serverChannelConfig.authToken

  // Preload local inference models (Kokoro TTS, etc.) in background after a delay
  inferencePreload.triggerPreload()
})

watch(themeColorsHue, () => {
  document.documentElement.style.setProperty('--chromatic-hue', themeColorsHue.value.toString())
}, { immediate: true })

watch(themeColorsHueDynamic, () => {
  document.documentElement.classList.toggle('dynamic-hue', themeColorsHueDynamic.value)
}, { immediate: true })

onUnmounted(() => {
  mcpToolsStore.dispose()
  pluginToolsStore.dispose()
})
</script>

<template>
  <ToasterRoot @close="id => toast.dismiss(id)">
    <Toaster />
  </ToasterRoot>
  <ResizeHandler />
  <RouterView />
</template>

<style>
/* We need this to properly animate the CSS variable */
@property --chromatic-hue {
  syntax: '<number>';
  initial-value: 0;
  inherits: true;
}

@keyframes hue-anim {
  from {
    --chromatic-hue: 0;
  }
  to {
    --chromatic-hue: 360;
  }
}

.dynamic-hue {
  animation: hue-anim 10s linear infinite;
}
</style>
