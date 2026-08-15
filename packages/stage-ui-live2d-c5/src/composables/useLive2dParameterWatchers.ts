import type { MaybeRefOrGetter, WatchSource, WatchStopHandle } from 'vue'

import { toValue, watch } from 'vue'

type InferGetSetPair<T> = T extends WatchSource<infer V> ? GetSetPair<V> : never

type WatcherMapping<T extends Record<string, WatchSource<any>>> = {
  [K in keyof T]: InferGetSetPair<T[K]>
}

interface GetSetPair<T> {
  getter: WatchSource<T>
  setter?: (value: T, key: string) => void
}

/**
 * Binds a dynamic list of reactive values to Live2D model parameters.
 *
 * Use when you have a set of parameter mappings that may change over time
 * (e.g. user-configurable expressions). When the mapping list changes,
 * old watchers are stopped and new ones are created automatically.
 */
export function useParameterWatchers<T extends Record<string, WatchSource<any>>>(
  parameterMapSource: MaybeRefOrGetter<WatcherMapping<T>>,
  unifiedSetter?: (value: any, key: string) => void,
) {
  let stopHandles: WatchStopHandle[] = []

  const setupWatchers = (map: WatcherMapping<T>) => {
    // Destroy previous watchers
    stopHandles.forEach(stop => stop())
    stopHandles = []

    Object.keys(map).forEach((key) => {
      if (!map[key].setter && !unifiedSetter)
        throw new Error('Missing setter')
      const stop = watch(map[key].getter, (value) => {
        (map[key].setter ?? unifiedSetter)!(value, key)
      }, { immediate: true })
      stopHandles.push(stop)
    })
  }

  // Reactively track the list of mappings
  const unwatchList = watch(
    () => toValue(parameterMapSource),
    (newMap) => {
      if (newMap) {
        setupWatchers(newMap)
      }
      else {
        setupWatchers({} as any)
      }
    },
    { immediate: true, deep: true },
  )

  // Optional manual stop (Vue automatically stops all these watches on unmount)
  return {
    stop: () => {
      unwatchList()
      setupWatchers({} as any)
    },
  }
}
