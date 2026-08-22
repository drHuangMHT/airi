import type { MaybeRefOrGetter } from 'vue'

import { toRef, unrefElement, useElementBounding, useThrottleFn } from '@vueuse/core'
import { clamp } from 'es-toolkit/math'
import { ref, toValue, watch } from 'vue'

interface CircleHitTestInput {
  gl: WebGL2RenderingContext | WebGLRenderingContext
  clientX: number
  clientY: number
  left: number
  top: number
  width: number
  height: number
  radius: number
  threshold: number
}

export function isCanvasRegionTransparent({
  gl,
  clientX,
  clientY,
  left,
  top,
  width,
  height,
  radius,
  threshold,
}: CircleHitTestInput) {
  if (!width || !height)
    return true

  if (gl.drawingBufferWidth <= 0 || gl.drawingBufferHeight <= 0)
    return true

  const xIn = clientX - left
  const yIn = clientY - top
  const inCanvas = xIn >= 0 && yIn >= 0 && xIn < width && yIn < height
  if (!inCanvas)
    return true

  const scaleX = gl.drawingBufferWidth / width
  const scaleY = gl.drawingBufferHeight / height
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY))
    return true

  // Translate client-space coords into WebGL buffer space (respecting DPI scaling and flipped Y),
  // then read a bounding box that fully contains the desired radius circle. Later we re-check
  // the circle constraint in CPU land to avoid missing hits at the edges.
  const centerX = Math.floor(xIn * scaleX)
  const centerY = Math.floor(gl.drawingBufferHeight - 1 - yIn * scaleY)

  const radiusX = Math.ceil(radius * scaleX)
  const radiusY = Math.ceil(radius * scaleY)

  const startX = clamp(centerX - radiusX, 0, gl.drawingBufferWidth - 1)
  const endX = clamp(centerX + radiusX, 0, gl.drawingBufferWidth - 1)
  const startY = clamp(centerY - radiusY, 0, gl.drawingBufferHeight - 1)
  const endY = clamp(centerY + radiusY, 0, gl.drawingBufferHeight - 1)

  const readWidth = endX - startX + 1
  const readHeight = endY - startY + 1
  const data = new Uint8Array(readWidth * readHeight * 4)

  try {
    gl.readPixels(startX, startY, readWidth, readHeight, gl.RGBA, gl.UNSIGNED_BYTE, data)
  }
  catch {
    return true
  }

  const radiusSq = radius * radius

  for (let y = 0; y < readHeight; y += 1) {
    const gy = startY + y
    const dy = (gy - centerY) / scaleY
    const dySq = dy * dy

    for (let x = 0; x < readWidth; x += 1) {
      const gx = startX + x
      const dx = (gx - centerX) / scaleX
      if (dx * dx + dySq > radiusSq)
        continue

      const index = (y * readWidth + x) * 4
      const alpha = data[index + 3]
      if (alpha >= threshold)
        return false
    }
  }

  return true
}

type TransparencyTestFn = (...args: Parameters<typeof isCanvasRegionTransparent>) => void

// NOTICE: In real-world use cases of Fade on Hover feature, the cursor may move around the edge of the
// model rapidly, causing flickering effects when checking pixel transparency strictly.
// Here we use render-target pixel sampling to keep detection aligned with the actual render output.
export function useCanvasPixelIsTransparentAtPoint(
  canvas: MaybeRefOrGetter<HTMLCanvasElement | undefined>,
  canvasClientX: MaybeRefOrGetter<number>,
  canvasClientY: MaybeRefOrGetter<number>,
  options: { threshold?: number, regionRadius?: number, throttleMs?: number },
) {
  const { threshold = 10, regionRadius = 1, throttleMs = 0 } = options

  const radius = Math.max(1, regionRadius)
  const clientX = toRef(canvasClientX)
  const clientY = toRef(canvasClientY)
  const transparentState = ref(false)
  const { left, top, width, height } = useElementBounding(canvas)
  let testFn: TransparencyTestFn = (...args: Parameters<typeof isCanvasRegionTransparent>) => {
    transparentState.value = isCanvasRegionTransparent(...args)
  }
  if (throttleMs > 0) {
    testFn = useThrottleFn(testFn)
  }
  const watcher = watch([clientX, clientY, canvas], () => {
    const el = unrefElement(canvas)
    const gl = (el?.getContext('webgl2') ?? el?.getContext('webgl') ?? null)
    if (!el || !gl)
      return transparentState.value = true
    // already guarded by `isCanvasRegionTransparent` but here to skip the throttled test
    if (clientX.value < 0 || clientY.value < 0 || clientX.value > el.clientWidth || clientY.value > el.clientHeight)
      return transparentState.value = true
    testFn({
      gl,
      clientX: clientX.value,
      clientY: clientY.value,
      left: left.value,
      top: top.value,
      width: width.value,
      height: height.value,
      radius,
      threshold,
    })
  })
  return { transparentState, watcher }
}

export function useTransparencyTest(
  canvas: MaybeRefOrGetter<HTMLCanvasElement | undefined>,
  canvasClientX: MaybeRefOrGetter<number>,
  canvasClientY: MaybeRefOrGetter<number>,
  testEnabled: MaybeRefOrGetter<boolean>,
  emit: any,
) {
  const { transparentState, watcher } = useCanvasPixelIsTransparentAtPoint(canvas, canvasClientX, canvasClientY, {
    threshold: 10,
    throttleMs: 100,
    regionRadius: 15,
  })
  watch([testEnabled], () => {
    const enabled = toValue(testEnabled)
    if (enabled)
      watcher.resume()
    else
      watcher.pause()
  }, { immediate: true })
  watch(transparentState, (oldVal, newVal) => {
    if (oldVal !== newVal) {
      emit('transparencyChange', newVal)
    }
  })
  return transparentState
}
