<script setup lang="ts">
import { useElectronMouseAroundWindowBorder } from '@proj-airi/electron-vueuse'
import { refDebounced } from '@vueuse/core'

const props = defineProps({
  isLoading: {
    type: Boolean,
    required: true,
  },
})

const { isNearAnyBorder } = useElectronMouseAroundWindowBorder({ threshold: 10 })
const isAroundWindowBorderFor250Ms = refDebounced(isNearAnyBorder, 250)
</script>

<template>
  <Transition
    enter-active-class="transition-opacity duration-250 ease-in-out" enter-from-class="opacity-50"
    enter-to-class="opacity-100" leave-active-class="transition-opacity duration-250 ease-in-out"
    leave-from-class="opacity-100" leave-to-class="opacity-50"
  >
    <div
      v-if="isAroundWindowBorderFor250Ms && !props.isLoading"
      class="pointer-events-none absolute left-0 top-0 z-999 h-full w-full"
    >
      <div
        :class="[
          'b-primary/50',
          'h-full w-full animate-flash animate-duration-3s animate-count-infinite b-4 rounded-2xl',
        ]"
      />
    </div>
  </Transition>
</template>
