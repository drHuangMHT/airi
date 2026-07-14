<script setup lang="ts">
import { TooltipArrow, TooltipContent, TooltipPortal, TooltipProvider, TooltipRoot, TooltipTrigger } from 'reka-ui'

interface Color {
  hex?: string
  name: string
}

defineProps<{
  colors: Color[]
}>()
</script>

<template>
  <div v-if="colors.length" flex gap-2>
    <TooltipProvider v-for="color in colors" :key="color.hex || 'default'">
      <TooltipRoot>
        <TooltipTrigger
          transition="all ease-in-out duration-250"
          size-8 cursor-pointer rounded-full bg-primary-500
          :style="{ background: color.hex }"
        />
        <TooltipPortal>
          <TooltipContent bg="white dark:neutral-800" rounded-lg px-3 py-1.5 text-sm shadow-md>
            {{ color.hex }}
            <TooltipArrow fill-white dark:fill-neutral-800 />
          </TooltipContent>
        </TooltipPortal>
      </TooltipRoot>
    </TooltipProvider>
  </div>
</template>
