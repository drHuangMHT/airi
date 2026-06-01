<script setup lang="ts">
import { useProvidersStore } from '@proj-airi/stage-ui/stores'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute } from 'vue-router'

import WindowTitleBar from '../components/Window/TitleBar.vue'

import { useRestoreScroll } from '../composables/use-restore-scroll'

const route = useRoute()
const { t } = useI18n()
const providersStore = useProvidersStore()
const scrollContainer = ref<HTMLElement>()
useRestoreScroll(scrollContainer)

const routeMeta = computed(() => route.meta as {
  titleKey?: string
  subtitleKey?: string
  title?: string
  subtitle?: string
})

const providerTitle = computed(() => {
  if (!route.path.startsWith('/settings/providers/'))
    return undefined

  const segments = route.path.split('/').filter(Boolean)
  const providerId = segments[3]

  if (!providerId)
    return undefined

  try {
    const metadata = providersStore.addedProviders[providerId]
    return t(metadata.i18nNameKey)
  }
  catch {
    return undefined
  }
})

// const activeSettingsTutorial = ref('default')
const routeHeaderMetadata = computed(() => {
  const { titleKey, subtitleKey, title, subtitle } = routeMeta.value
  const resolvedTitle = titleKey ? t(titleKey) : title
  const resolvedSubtitle = subtitleKey ? t(subtitleKey) : subtitle

  if (resolvedTitle || resolvedSubtitle) {
    return {
      title: resolvedTitle,
      subtitle: resolvedSubtitle,
    }
  }

  if (providerTitle.value) {
    return {
      title: providerTitle.value,
      subtitle: t('settings.title'),
    }
  }

  return undefined
})
</script>

<template>
  <WindowTitleBar :title="routeHeaderMetadata?.title ?? ''" icon="i-solar:settings-bold" />
  <div
    :style="{
      paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      paddingRight: 'env(safe-area-inset-right, 0px)',
      paddingLeft: 'env(safe-area-inset-left, 0px)',
      height: 'calc(100vh - 44px)',
    }"
    overflow-y-auto
  >
    <RouterView />
  </div>
</template>
