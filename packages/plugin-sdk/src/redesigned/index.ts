/**
 * Structure of a plugin's manifest.json file.
 * Must exist in the plugin's root directory.
 */
export interface PluginManifest {
  /** Unique identifier for the plugin (e.g., "com.example.my-plugin"). */
  identifier: string
  /** Human‑readable name. */
  name: string
  /** Path to the ESM entrypoint, relative to the plugin's root directory. */
  entrypoint: string
}

/**
 * Full plugin information, including any additional data provided
 * during `preRegistration`.
 */
export interface PluginInfo extends PluginManifest {
  // Additional properties can be added by the plugin at registration time.
  [key: string]: unknown
}

/**
 * Context object passed to the plugin's entrypoint function.
 * Contains the two registration hooks.
 */
export interface PluginContext {
  /**
   * Hook for the plugin to announce its presence to the registry.
   * @param extra - Optional extra information to merge with the manifest.
   *                The plugin can, for example, expose capabilities, version, etc.
   */
  preRegistration: (extra?: Partial<PluginInfo>) => void

  /**
   * Hook for the plugin to discover other plugins that have already
   * registered. Returns a Promise that resolves to the list of all
   * registered plugins once the entire registration phase is complete.
   */
  postRegistration: () => Promise<PluginInfo[]>
}
