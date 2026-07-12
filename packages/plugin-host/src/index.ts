import type { PluginContext, PluginInfo, PluginManifest } from '@proj-airi/plugin-sdk'

import fs from 'node:fs/promises'
import path from 'node:path'

import { pathToFileURL } from 'node:url'

/** Path to the folder where plugins are stored (relative to this file). */
export const PLUGIN_FOLDER = path.join('../..', 'plugins')
console.info(`searching for plugins in ${PLUGIN_FOLDER}`)
export class PluginRegistry {
  private plugins = new Map<string, PluginInfo>()
  private isLoaded = false
  private postRegistrationResolvers: Array<() => void> = []

  /**
   * Scans `PLUGIN_FOLDER`, loads each plugin's manifest and entrypoint,
   * and gives each plugin a chance to register.
   */
  async loadPlugins(): Promise<void> {
    let pluginDirs: string[]
    try {
      pluginDirs = await fs.readdir(PLUGIN_FOLDER)
      console.info(`Found ${pluginDirs.length} plugins in plugin folder.`, { source: 'Plugin Registry' })
    }
    catch {
      console.warn(`Plugin folder "${PLUGIN_FOLDER}" not found - no plugins loaded.`)
      this.isLoaded = true
      return
    }

    const loadPromises = pluginDirs.map(async (dir) => {
      const pluginRoot = path.join(PLUGIN_FOLDER, dir)
      const manifestPath = path.join(pluginRoot, 'manifest.json')

      let manifest: PluginManifest
      try {
        const content = await fs.readFile(manifestPath, 'utf-8')
        manifest = JSON.parse(content)
      }
      catch (err: any) {
        console.error(`Failed to read manifest for plugin in "${dir}"`, (err as Error).message)
        return
      }

      // Validate required fields
      if (!manifest.identifier || !manifest.name || !manifest.entrypoint) {
        console.error(`Invalid manifest in "${dir}": missing identifier, name, or entrypoint.`)
        return
      }

      // Resolve entrypoint absolute path
      const entrypointPath = path.join(pluginRoot, manifest.entrypoint)
      const entrypointURL = pathToFileURL(entrypointPath).href

      try {
        // Dynamic import of the ESM entrypoint
        const module = await import(entrypointURL)
        const registerFn = module.default || module.register

        if (typeof registerFn !== 'function') {
          console.error(`Plugin "${manifest.identifier}" entrypoint does not export a default or named "register" function.`)
          return
        }

        // Create the context that exposes the hooks
        const context = this.createContext(manifest)
        // Let the plugin register
        registerFn(context)
      }
      catch (err) {
        console.error(`Failed to load plugin "${manifest.identifier}"`, err)
      }
    })

    console.info(`Registration issued`, { source: 'Plugin Registry' })
    await Promise.all(loadPromises)

    // All plugins have been loaded and (hopefully) called preRegistration.
    this.isLoaded = true
    console.info(`Running post-registration`, { source: 'Plugin Registry' })
    // Resolve all pending postRegistration promises.
    this.postRegistrationResolvers.forEach(resolve => resolve())
    this.postRegistrationResolvers = []
  }

  /**
   * Creates the context object for a specific plugin.
   * The hooks are bound to the registry instance.
   */
  private createContext(manifest: PluginManifest): PluginContext {
    return {
      preRegistration: (extra?: Partial<PluginInfo>) => {
        const info: PluginInfo = {
          ...manifest,
          ...extra,
        }
        // Store (or update) the plugin's information.
        this.plugins.set(manifest.identifier, info)
        console.info(`[Registry] Plugin "${manifest.identifier}" registered.`)
      },

      postRegistration: (): Promise<PluginInfo[]> => {
        return new Promise((resolve) => {
          if (this.isLoaded) {
            // All plugins already registered – return list immediately.
            resolve(Array.from(this.plugins.values()))
          }
          else {
            // Queue the resolver until registration phase finishes.
            this.postRegistrationResolvers.push(() => {
              resolve(Array.from(this.plugins.values()))
            })
          }
        })
      },
    }
  }

  /**
   * Returns the list of all currently registered plugins.
   * Useful for other parts of the application (e.g., UI).
   */
  getPlugins(): PluginInfo[] {
    return Array.from(this.plugins.values())
  }

  /**
   * Retrieves a specific plugin by its identifier.
   */
  getPlugin(identifier: string): PluginInfo | undefined {
    return this.plugins.get(identifier)
  }
}
