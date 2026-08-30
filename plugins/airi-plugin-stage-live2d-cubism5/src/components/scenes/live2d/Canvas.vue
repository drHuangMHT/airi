<script setup lang="ts">
import { Application, extensions } from 'pixi.js'
import { configureCubismSDK, Live2DPlugin } from 'untitled-pixi-live2d-engine'
import { onMounted, onUnmounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  width: number
  height: number
  resolution?: number
  maxFps?: number
}>(), {
  resolution: 2,
  maxFps: 0,
})

const componentState = defineModel<'pending' | 'loading' | 'mounted'>('state', { default: 'pending' })

const containerRef = ref<HTMLDivElement>()
const isPixiCanvasReady = ref(false)
const pixiApp = ref<Application>()

function resolveMaxFps(limit?: number) {
  if (!limit || limit <= 0)
    return 0

  return Math.max(1, Math.round(limit))
}

async function initLive2DPixiStage(parent: HTMLDivElement) {
  componentState.value = 'loading'
  isPixiCanvasReady.value = false

  configureCubismSDK({ memorySizeMB: 128 })

  // // https://guansss.github.io/pixi-live2d-display/#package-importing
  // Live2DModel.registerTicker(Ticker)
  // extensions.add(TickerPlugin)
  extensions.add(Live2DPlugin)
  // We handle the interactions (e.g., mouse-based focusing at) manually
  // extensions.add(InteractionManager)

  const app = new Application()
  await app.init({
    width: props.width,
    height: props.height,
    backgroundAlpha: 0,
    preserveDrawingBuffer: true,
    autoDensity: false,
    resolution: props.resolution,
  });

  (globalThis as any).__PIXI_APP__ = app
  pixiApp.value = app

  const pixiAppCanvas = pixiApp.value.canvas

  // Set CSS styles to make canvas responsive to container
  pixiAppCanvas.style.width = '100%'
  pixiAppCanvas.style.height = '100%'
  pixiAppCanvas.style.display = 'block'

  parent.appendChild(pixiApp.value.canvas)

  isPixiCanvasReady.value = true
  componentState.value = 'mounted'
}

function handleResize() {
  if (pixiApp.value) {
    // Update the internal rendering resolution
    pixiApp.value.renderer.resize(props.width, props.height, props.resolution)
  }

  // The CSS styles handle the display size, so we don't need to manually set view dimensions
}

watch([() => props.width, () => props.height, () => props.resolution], handleResize)
watch(() => props.maxFps, (limit) => {
  if (pixiApp.value)
    pixiApp.value.ticker.maxFPS = resolveMaxFps(limit)
})

onMounted(async () => containerRef.value && await initLive2DPixiStage(containerRef.value))
onUnmounted(() => pixiApp.value?.destroy())

async function captureFrame() {
  const frame = new Promise<Blob | null>((resolve) => {
    if (!pixiApp.value)
      return resolve(null)

    try {
      pixiApp.value.render()
    }
    catch (error) {
      console.error('[Live2D] Pixi render error during capture.', error)
      return resolve(null)
    }

    pixiApp.value.canvas.toBlob(resolve)
  })

  return frame
}

function canvasElement() {
  return pixiApp.value?.canvas ?? null
}

defineExpose({
  captureFrame,
  canvasElement,
})

import.meta.hot?.dispose(() => {
  console.warn('[Dev] Reload on HMR dispose is active for this component. Performing a full reload.')
  window.location.reload()
})
</script>

<template>
  <div ref="containerRef" h-full w-full>
    <slot v-if="isPixiCanvasReady" :app="pixiApp" />
  </div>
</template>
