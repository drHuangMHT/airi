import { join, resolve } from 'node:path'

import { Download } from '@proj-airi/unplugin-fetch'
import { defineConfig } from 'vite'

const stageUIAssetsRoot = resolve(import.meta.dirname)
const sharedCacheDir = resolve(join(import.meta.dirname, '..', '..', '.cache'))

export default defineConfig({
  plugins: [
    Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-A/AvatarSample_A.vrm', 'AvatarSample_A.vrm', 'models/AvatarSample-A', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
    Download('https://dist.ayaka.moe/vrm-models/VRoid-Hub/AvatarSample-B/AvatarSample_B.vrm', 'AvatarSample_B.vrm', 'models/AvatarSample-B', { parentDir: stageUIAssetsRoot, cacheDir: sharedCacheDir }),
  ],
})
