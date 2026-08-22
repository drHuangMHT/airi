<script setup lang="ts">
import type { Live2DValidationReport } from '@proj-airi/stage-ui-live2d-c5'

import type { ModelMetadata } from '../composables/model'

import { validateLive2DZip } from '@proj-airi/stage-ui-live2d-c5'
import { Button } from '@proj-airi/ui'
import { useFileDialog } from '@vueuse/core'
import { nanoid } from 'nanoid'
import { storeToRefs } from 'pinia'
import { DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal, DropdownMenuRoot, DropdownMenuTrigger, EditableArea, EditableEditTrigger, EditableInput, EditablePreview, EditableRoot, EditableSubmitTrigger } from 'reka-ui'
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AuditModal from './AuditModal.vue'

import { useModelsStore } from '../composables/model'

const emits = defineEmits<{
  (e: 'close', value: void): void
  (e: 'pick', value: string): void
}>()

const modelStore = useModelsStore()
const { selectedModel, models } = storeToRefs(modelStore)
const { t } = useI18n()

const loadedModels = ref<{ metadata: ModelMetadata, preview: string }[]>([])
watch([models], async () => {
  const modelData = await Promise.all(models.value.map(m => modelStore.getModel(m.identifier))).then(m => m.filter(m => !!m))
  const newData = await Promise.all(modelData.map(async m => ({ metadata: m.metadata, preview: URL.createObjectURL(m.preview) })))
  const old = loadedModels.value
  loadedModels.value = newData
  old.forEach(m => URL.revokeObjectURL(m.preview))
  console.info(models.value)
}, { immediate: true })

function handleRemoveModel(id: string) {
  modelStore.removeModel(id)
}

const showReportModal = ref(false)
const pendingFile = ref<File | null>(null)
const validationReport = ref<Live2DValidationReport | null>(null)

async function handleAddLive2DModel(file: FileList | null) {
  if (file === null || file.length === 0)
    return
  if (!file[0].name.endsWith('.zip'))
    return

  const report = await validateLive2DZip(file[0])
  validationReport.value = report
  pendingFile.value = file[0]

  if (report.status === 'VALID' && report.errors.length === 0) {
    await confirmImport()
    return
  }

  showReportModal.value = true
}

async function confirmImport() {
  if (pendingFile.value === null || validationReport.value === null)
    return

  const metadata: ModelMetadata = {
    name: validationReport.value.fileName,
    identifier: `${validationReport.value.fileName}.${nanoid()}`,
    importedAt: Date.now(),
  }

  // NOTICE:
  // Keep this await. Model picking can happen immediately after import from this dialog.
  // If addDisplayModel is fire-and-forget, updateStageModel may read the new display-model id
  // before IndexedDB or the in-memory displayModels list is ready and fall back to the default model.
  // Source/context: model selector import flow -> settings model pick -> settings-stage-model.getDisplayModel().
  // Removal condition: addDisplayModel becomes a synchronous transaction or pick is blocked by explicit import state.
  await modelStore.addModel(metadata, pendingFile.value)
  pendingFile.value = null
}

function handleFixError(error: string) {
  void error
}

function handlePick(id: string) {
  selectedModel.value = id
  emits('pick', id)
  emits('close', undefined)
}

const live2dDialog = useFileDialog({ accept: '.zip', multiple: false, reset: true })

live2dDialog.onChange(handleAddLive2DModel)

onMounted(() => {
  modelStore.initialize()
})
</script>

<template>
  <div pt="4 sm:0" gap="4 sm:6" h-full flex flex-col>
    <AuditModal
      v-model:open="showReportModal" :report="validationReport" @confirm="confirmImport"
      @fix-error="handleFixError"
    />
    <div flex justify-between>
      <h2 text-xl>
        {{ t('settings.model-select.select-model.title') }}
      </h2>
      <Button @click="live2dDialog.open">
        <div i-solar:add-circle-bold />
        <div>Add Model</div>
      </Button>
    </div>
    <div
      class="flex-1 overflow-x-auto overflow-y-hidden md:flex-none sm:overflow-x-hidden sm:overflow-y-scroll" h-full
      w-full
    >
      <div class="h-full w-full flex gap-2 md:grid lg:grid-cols-2 md:grid-cols-1 lg:max-h-80dvh">
        <div
          v-for="(model) of loadedModels" :key="model.metadata.identifier" v-auto-animate relative gap-2
          class="block h-full w-full md:flex md:flex-row" @click="() => selectedModel = model.metadata.identifier"
        >
          <div absolute left-3 top-4 z-1>
            <DropdownMenuRoot>
              <DropdownMenuTrigger
                :class="[
                  'bg-neutral-900/20 hover:bg-neutral-900/45 active:bg-neutral-900/60 dark:bg-neutral-950/50 hover:dark:bg-neutral-900/65 active:dark:bg-neutral-900/90',
                ]" text="white" h-7 w-7 flex items-center justify-center rounded-lg backdrop-blur-sm
                transition="colors duration-200 ease-in-out" aria-label="Options for Display Models"
              >
                <div i-solar:menu-dots-bold />
              </DropdownMenuTrigger>
              <DropdownMenuPortal>
                <DropdownMenuContent
                  :class="[
                    'will-change-[opacity,transform] z-10000 max-w-45 rounded-lg p-0.5 text-white shadow-md outline-none data-[side=bottom]:animate-slideUpAndFade data-[side=left]:animate-slideRightAndFade data-[side=right]:animate-slideLeftAndFade data-[side=top]:animate-slideDownAndFade dark:text-black',
                    'bg-neutral-900/30 dark:bg-neutral-950/50',
                    'backdrop-blur-sm',
                  ]" transition="colors duration-200 ease-in-out" align="start" side="bottom" :side-offset="4"
                >
                  <DropdownMenuItem
                    :class="[
                      'relative flex cursor-pointer select-none items-center rounded-md px-3 py-2 text-base leading-none outline-none data-[disabled]:pointer-events-none sm:text-sm',
                      'data-[highlighted]:bg-red-900/20 dark:data-[highlighted]:bg-red-100/20',
                      'text-white dark:text-white data-[highlighted]:text-red-200 dark:data-[highlighted]:text-red-200',
                    ]" transition="colors duration-200 ease-in-out"
                  >
                    <button flex items-center gap-1 outline-none @click="handleRemoveModel(model.metadata.identifier)">
                      <div i-solar:trash-bin-minimalistic-bold-duotone />
                      <div>{{ t('settings.model-select.select-model.remove') }}</div>
                    </button>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenuPortal>
            </DropdownMenuRoot>
          </div>
          <div class="h-full min-w-80 w-full lg:min-h-60 md:min-w-70 sm:min-w-65" aspect="12/16" px-1 py-2>
            <img
              v-if="model.preview" :src="model.preview" :class="[
                'h-full w-full rounded-xl object-cover',
                'transition-all duration-200 ease-in-out',
                selectedModel === model.metadata.identifier ? 'ring-3 ring-primary-400' : 'ring-0 ring-transparent',
              ]"
            >
            <div
              v-else bg="neutral-100 dark:neutral-900" relative h-full w-full flex flex-col items-center
              justify-center gap-2 overflow-hidden rounded-xl
              :class="[selectedModel === model.metadata.identifier ? 'ring-3 ring-primary-400' : 'ring-0 ring-transparent']"
              transition="all duration-200 ease-in-out"
            >
              <div i-solar:question-square-bold-duotone text-4xl opacity-75 />
              <div translate-y="100%" absolute top-0 flex flex-col translate-x--7 rotate-45 scale-250 gap-0 opacity-5>
                <div text="sm sm:sm" translate-x-7 translate-y--2 text-nowrap>
                  unavailable Preview unavailable Preview
                </div>
                <div text="sm sm:sm" translate-x-0 translate-y--0 text-nowrap>
                  Preview unavailable Preview unavailable
                </div>
                <div text="sm sm:sm" translate-x--7 translate-y-2 text-nowrap>
                  unavailable Preview unavailable Preview
                </div>
              </div>
            </div>
          </div>
          <div w-full flex flex-col>
            <div w-full flex-1 px-2 py-4>
              <EditableRoot
                v-slot="{ isEditing }" :default-value="model.metadata.name" placeholder="Model Name..."
                class="flex gap-2" auto-resize
              >
                <EditableArea class="w-[calc(100%-8px-1rem)] dark:text-white">
                  <EditablePreview class="line-clamp-1 w-[calc(100%-8px)] overflow-hidden text-ellipsis" />
                  <EditableInput
                    class="w-[calc(100%-8px)]! placeholder:text-neutral-700 dark:placeholder:text-neutral-600"
                  />
                </EditableArea>
                <EditableEditTrigger v-if="!isEditing">
                  <div i-solar:pen-2-line-duotone opacity-50 />
                </EditableEditTrigger>
                <div v-else class="flex gap-2">
                  <EditableSubmitTrigger>
                    <div i-solar:check-read-line-duotone opacity-50 />
                  </EditableSubmitTrigger>
                </div>
              </EditableRoot>
            </div>
            <Button class="hidden md:block" variant="secondary" @click="handlePick(model.metadata.identifier)">
              {{ t('settings.model-select.select-model.select') }}
            </Button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
