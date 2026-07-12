import type { PluginContext } from '@proj-airi/plugin-sdk'

// This file is an ESM module.
export default function register(context: PluginContext) {
  // 1. Announce presence – can pass extra metadata
  context.preRegistration({
    version: '1.0.0',
    description: 'Provides weather information.',
  })

  context.postRegistration().then((pluginList) => {
    console.info('All registered plugins:', pluginList)
  })

  // Additional plugin initialization...
}
