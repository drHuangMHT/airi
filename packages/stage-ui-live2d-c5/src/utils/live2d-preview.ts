import cropImg from '@lemonneko/crop-empty-pixels'

import { Application, DOMAdapter, extensions, WebWorkerAdapter } from 'pixi.js'
import { Live2DFactory, Live2DModel, Live2DPlugin } from 'untitled-pixi-live2d-engine'

const previewWidth = 1440
const previewHeight = 2560
const previewResolution = 2
/**
 * Render a Live2D zip/file to an offscreen canvas and return a padded preview data URL.
 */
export async function loadLive2DModelPreview(file: File): Promise<Blob | null> {
  DOMAdapter.set(WebWorkerAdapter)
  extensions.add(Live2DPlugin)

  const app = new Application()

  await app.init({
    width: previewWidth,
    height: previewHeight,
    // Ensure the drawing buffer persists so toDataURL() can read pixels
    preserveDrawingBuffer: true,
    backgroundAlpha: 0,
    autoDensity: false,
    resolution: previewResolution,
    autoStart: false,
  })
  app.renderer.resolution = previewResolution

  const model = new Live2DModel()
  const objUrl = URL.createObjectURL(file)

  const cleanup = () => {
    app.destroy()
    URL.revokeObjectURL(objUrl)
  }

  try {
    await Live2DFactory.setupLive2DModel(model, { url: objUrl, id: file.name }, { autoInteract: false })
    app.stage.addChild(model)

    model.width = previewWidth
    model.height = previewHeight
    model.scale.set(0.1, 0.1)
    model.anchor.set(0.5, 0.5)

    app.renderer.render(app.stage)

    const croppedCanvas = cropImg(app.canvas)

    // padding to 12:16
    const paddingCanvas = document.createElement('canvas')
    paddingCanvas.width = croppedCanvas.width > croppedCanvas.height / 16 * 12 ? croppedCanvas.width : croppedCanvas.height / 16 * 12
    paddingCanvas.height = paddingCanvas.width / 12 * 16
    const paddingCanvasCtx = paddingCanvas.getContext('2d')!

    paddingCanvasCtx.drawImage(croppedCanvas, (paddingCanvas.width - croppedCanvas.width) / 2, (paddingCanvas.height - croppedCanvas.height) / 2, croppedCanvas.width, croppedCanvas.height)
    const paddedPreviewImage = new Promise<Blob | null>((resolve, _reject) => {
      paddingCanvas.toBlob(blob => resolve(blob))
    })

    cleanup()

    return paddedPreviewImage
  }
  catch (error) {
    console.error(error)
    cleanup()
  }
  return null
}
