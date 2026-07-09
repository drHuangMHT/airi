<script setup lang="ts">
import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { OnboardingScreen, OnboardingStepAnalyticsNotice } from '@proj-airi/stage-ui/components'
import { isPosthogAvailableInBuild } from '@proj-airi/stage-ui/stores/analytics'
import { useOnboardingStore } from '@proj-airi/stage-ui/stores/onboarding'
import { useTheme } from '@proj-airi/ui'
import { computed } from 'vue'

import { electronOnboardingClose } from '../../shared/eventa'

const onboardingStore = useOnboardingStore()
const { isDark } = useTheme()
const closeWindow = useElectronEventaInvoke(electronOnboardingClose)

const bgClass = computed(() => isDark.value ? 'bg-[#0f0f0f]' : 'bg-white')
const extraSteps = computed(() => {
  return isPosthogAvailableInBuild()
    ? [{ id: 'analytics-notice', component: OnboardingStepAnalyticsNotice }]
    : []
})

async function handleSkipped() {
  onboardingStore.markSetupSkipped()
  await closeWindow()
}

async function handleConfigured() {
  onboardingStore.markSetupCompleted()
  await closeWindow()
}
</script>

<template>
  <div
    onboarding-root h-screen w-screen
    :class="bgClass"
  >
    <div class="h-8 w-full shrink-0 select-none drag-region" :class="bgClass" />
    <main flex p-10 style="height: calc(100vh - 2rem);">
      <OnboardingScreen :extra-steps="extraSteps" @skipped="handleSkipped" @configured="handleConfigured" />
    </main>
  </div>
</template>

<style scoped>
.onboarding-root {
  scrollbar-width: none;
}

.onboarding-root::-webkit-scrollbar {
  display: none;
}

.onboarding-content {
  padding: 8px 0 20px 0;
}

.onboarding-scroll {
  padding-top: 8px;
  padding-bottom: 20px;
}
</style>

<route lang="yaml">
meta:
  layout: plain
</route>
