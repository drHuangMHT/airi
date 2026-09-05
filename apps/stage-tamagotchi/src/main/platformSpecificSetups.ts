import { env } from 'node:process'

import { isLinux } from 'std-env'

export function onLinux(app: Electron.App) {
  if (!isLinux)
    return
  // Thanks to [@blurymind](https://github.com/blurymind),
  //
  // When running Electron on Linux, navigator.gpu.requestAdapter() fails.
  // In order to enable WebGPU and process the shaders fast enough, we need the following
  // command line switches to be set.
  //
  // https://github.com/electron/electron/issues/41763#issuecomment-2051725363
  // https://github.com/electron/electron/issues/41763#issuecomment-3143338995
  app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')
  app.commandLine.appendSwitch('enable-unsafe-webgpu')
  app.commandLine.appendSwitch('enable-features', 'Vulkan')

  // NOTICE: we need UseOzonePlatform, WaylandWindowDecorations for working on Wayland.
  // Partially related to https://github.com/electron/electron/issues/41551, since X11 is deprecating now,
  // we can safely remove the feature flags for Electron once they made it default supported.
  // Fixes: https://github.com/moeru-ai/airi/issues/757
  // Ref: https://github.com/mmaura/poe2linuxcompanion/blob/90664607a147ea5ccea28df6139bd95fb0ebab0e/electron/main/index.ts#L28-L46
  if (env.XDG_SESSION_TYPE === 'wayland') {
    app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')

    app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform')
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations')
  }
}
