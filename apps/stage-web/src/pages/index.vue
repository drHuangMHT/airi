<script setup lang="ts">
import Header from '@proj-airi/stage-layouts/components/Layouts/Header.vue'
import InteractiveArea from '@proj-airi/stage-layouts/components/Layouts/InteractiveArea.vue'
import MobileHeader from '@proj-airi/stage-layouts/components/Layouts/MobileHeader.vue'
import MobileInteractiveArea from '@proj-airi/stage-layouts/components/Layouts/MobileInteractiveArea.vue'

import { BackgroundProvider } from '@proj-airi/stage-layouts/components/Backgrounds'
import { useBackgroundThemeColor } from '@proj-airi/stage-layouts/composables/theme-color'
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { useSettingsLive2d } from '@proj-airi/stage-ui-live2d'
import { useModelStore } from '@proj-airi/stage-ui-three'
import { WidgetStage } from '@proj-airi/stage-ui/components/scenes'
import { breakpointsTailwind, useBreakpoints, useMouse } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, useTemplateRef } from 'vue'

const paused = ref(false)

function handleSettingsOpen(open: boolean) {
  paused.value = open
}

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md')

const backgroundStore = useBackgroundStore()
const { selectedOption, sampledColor } = storeToRefs(backgroundStore)
const backgroundSurface = useTemplateRef<InstanceType<typeof BackgroundProvider>>('backgroundSurface')

const { syncBackgroundTheme } = useBackgroundThemeColor({ backgroundSurface, selectedOption, sampledColor })
onMounted(() => syncBackgroundTheme())

const { live2dEyeTrackingSource } = storeToRefs(useSettingsLive2d())
const { x: mouseX, y: mouseY } = useMouse()
live2dEyeTrackingSource.value = computed(() => ({
  x: mouseX.value,
  y: mouseY.value,
}))
const { trackingSource } = storeToRefs(useModelStore())
trackingSource.value = computed(() => ({
  x: mouseX.value,
  y: mouseY.value,
}))
</script>

<template>
  <BackgroundProvider
    ref="backgroundSurface"
    class="widgets top-widgets"
    :background="selectedOption"
    :top-color="sampledColor"
  >
    <div relative flex="~ col" z-2 h-100dvh w-100vw of-hidden>
      <!-- header -->
      <div class="px-0 py-1 md:px-3 md:py-3" w-full gap-2>
        <Header class="hidden md:flex" />
        <MobileHeader class="flex md:hidden" />
      </div>
      <!-- page -->
      <div relative flex="~ 1 row gap-y-0 gap-x-2 <md:col">
        <WidgetStage
          flex-1 min-w="1/2"
          :paused="paused"
        />
        <InteractiveArea v-if="!isMobile" h="85dvh" absolute right-4 flex flex-1 flex-col max-w="500px" min-w="30%" />
        <MobileInteractiveArea v-if="isMobile" @settings-open="handleSettingsOpen" />
      </div>
      <HoloCoupon />
    </div>
  </BackgroundProvider>
</template>

<route lang="yaml">
name: IndexScenePage
meta:
  layout: stage
  stageTransition:
    name: bubble-wave-out
</route>
