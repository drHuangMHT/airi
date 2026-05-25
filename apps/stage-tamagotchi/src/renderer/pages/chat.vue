<script setup lang="ts">
import InteractiveArea from '../components/InteractiveArea.vue'
import WindowTitleBar from '../components/Window/TitleBar.vue'
</script>

<template>
  <WindowTitleBar
    title="Chat"
    icon="i-solar:chat-line-bold"
  />
  <div w-full style="height: calc(100vh - 3rem)">
    <InteractiveArea
      class="interaction-area block"
      h-full w-full p-4 transition="opacity duration-250"
    />
  </div>
</template>

<route lang="yaml">
meta:
  layout: stage
</route>
