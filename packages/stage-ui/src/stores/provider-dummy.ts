import type { ModelInfo, ProviderMetadata } from './providers-minimized'

import { Task } from './providers-minimized'

export const dummyProviderAlice: ProviderMetadata = {
  id: 'airi.builtin.test.dummyProviderAlice',
  name: 'Dummy Provider Alice',
  description: 'A dummy provider for test only',
  ordering: 1,
  tasks: [Task.GEN_TEXT, Task.TO_TEXT],
  i18nNameKey: 'airi.builtin.test.dummyProviderAlice.name',
  i18nDescriptionKey: 'airi.builtin.test.dummyProviderAlice.description',
  icon: 'http://127.0.0.1/test',
  defaultOptions: {
    baseUrl: 'http://127.0.0.1/v1',
  },
  requiresCredentials: false,
  providerTag: ['free', 'local'],
  beginnerRecommended: true,
  additionalHeaders: {
    'x-application-test-header': 'test-only',
  },
  models: [
    'dummyProviderAlice.gen_text.model1',
    'dummyProviderAlice.to_text.model2',
  ],
}

export const dummyProviderAliceModel1: ModelInfo = {
  id: 'dummyProviderAlice.gen_text.model1',
  name: 'ASR Model 1',
  providerId: 'airi.builtin.test.dummyProviderAlice',
  description: '',
  tags: ['free'],
}

export const dummyProviderAliceModel2: ModelInfo = {
  id: 'dummyProviderAlice.gen_text.model2',
  name: 'LLM Model 1',
  providerId: 'airi.builtin.test.dummyProviderAlice',
  description: '',
  tags: ['paid'],
}

export const dummyProviderBob: ProviderMetadata = {
  id: 'airi.builtin.test.dummyProviderBob',
  name: 'Dummy Provider Bob',
  description: 'A dummy provider for test only',
  ordering: 1,
  tasks: [Task.GEN_IMAGE, Task.GEN_AUDIO, Task.TO_EMBED],
  i18nNameKey: 'airi.builtin.test.dummyProviderBob.name',
  i18nDescriptionKey: 'airi.builtin.test.dummyProviderBob.description',
  icon: 'http://127.0.0.2/test',
  defaultOptions: {
    baseUrl: 'http://127.0.0.2/v1',
  },
  requiresCredentials: false,
  providerTag: ['paid', 'cloud'],
  beginnerRecommended: true,
  additionalHeaders: {
    'x-application-test-header': 'test-only',
  },
  models: [
    'dummyProviderAlice.gen_image.model1',
    'dummyProviderAlice.gen_audio.model1',
    'dummyProviderAlice.to_embed.model3',
  ],
}
