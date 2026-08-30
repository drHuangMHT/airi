import { Live2DFactory, ZipLoader } from 'untitled-pixi-live2d-engine'

import { OPFSCache } from './opfs-loader'

import * as ziploaderInject from './live2d-zip-loader'

const zipLoaderIndex = Live2DFactory.live2DModelMiddlewares.indexOf(ZipLoader.factory)

if (Live2DFactory.live2DModelMiddlewares.includes(OPFSCache.checkMiddleware)) {
  // Middlewares already registered.
}
else if (zipLoaderIndex !== -1) {
  void ziploaderInject
  // Insert Check before ZipLoader
  Live2DFactory.live2DModelMiddlewares.splice(zipLoaderIndex, 0, OPFSCache.checkMiddleware)
  // Insert Save after ZipLoader
  Live2DFactory.live2DModelMiddlewares.splice(zipLoaderIndex + 2, 0, OPFSCache.saveMiddleware)
}
else {
  console.warn('[OPFS] ZipLoader not found in middlewares, caching disabled')
}
