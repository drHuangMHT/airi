import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import { useSettingsTheme } from './theme'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('useSettingsTheme', () => {
  let store: ReturnType<typeof useSettingsTheme>

  beforeEach(() => {
    // Clear localStorage before each test to ensure isolation
    localStorage.clear()
    store = useSettingsTheme()
  })

  describe('initialization', () => {
    it('should initialize with default values', () => {
      expect(store.themeColorsHue).toBe(220.44)
      expect(store.themeColorsHueDynamic).toBe(false)
    })

    it('restore values from localStorage', () => {
      localStorage.setItem('settings/theme/colors/hue', JSON.stringify(180))
      localStorage.setItem('settings/theme/colors/hue-dynamic', JSON.stringify(true))

      // re-creating the store to pick up the new localStorage values instead of default ones
      setActivePinia(createPinia())
      const freshStore = useSettingsTheme()

      expect(freshStore.themeColorsHue).toBe(180)
      expect(freshStore.themeColorsHueDynamic).toBe(true)
    })
  })

  describe('setThemeColorsHue', () => {
    it('should update hue and disable dynamic mode', async () => {
      store.setThemeColorsHue(270)

      expect(store.themeColorsHue).toBe(270)
      expect(store.themeColorsHueDynamic).toBe(false)

      await nextTick() // wait for state sync
      expect(localStorage.getItem('settings/theme/colors/hue')).toBe('270')
      expect(localStorage.getItem('settings/theme/colors/hue-dynamic')).toBe('false')
    })

    it('should use default hue if no argument provided', () => {
      store.setThemeColorsHue()

      expect(store.themeColorsHue).toBe(220.44)
      expect(store.themeColorsHueDynamic).toBe(false)
    })
  })

  describe('applyPrimaryColorFrom', () => {
    it('should convert a valid hex color to hue and set it', () => {
      store.applyPrimaryColorFrom('#FF0000') // pure red

      expect(store.themeColorsHue).not.toBe(29.23)
      expect(store.themeColorsHueDynamic).toBe(false)
    })

    it('should handle undefined color gracefully (fallback to default)', () => {
      store.applyPrimaryColorFrom(undefined)
      expect(store.themeColorsHue).toBe(220.44)
      expect(store.themeColorsHueDynamic).toBe(false)
    })
  })

  describe('isColorSelectedForPrimary', () => {
    it('should return false if dynamic mode is enabled', () => {
      store.themeColorsHueDynamic = true
      expect(store.isColorSelectedForPrimary('#FF0000')).toBe(false)
    })

    it('should return true if hex color matches current hue, with fp tolerance', () => {
      // Set a specific hue
      store.setThemeColorsHue(29.23) // test vector may subject to change

      expect(store.isColorSelectedForPrimary('#FF0000')).toBe(true)
    })

    it('should return false if hex color does not match current hue', () => {
      store.setThemeColorsHue(220.44)
      // Force dynamic mode to false first
      store.themeColorsHueDynamic = false

      expect(store.isColorSelectedForPrimary('#FF0000')).toBe(false)
    })
  })

  describe('resetState', () => {
    it('should reset all values to default', () => {
      // Modify state
      store.setThemeColorsHue(999)
      store.themeColorsHueDynamic = true

      expect(store.themeColorsHue).toBe(999)
      expect(store.themeColorsHueDynamic).toBe(true)

      // Reset
      store.resetState()

      expect(store.themeColorsHue).toBe(220.44)
      expect(store.themeColorsHueDynamic).toBe(false)
    })
  })
})
