export default {
  id: 'deepgram-tts',
  category: 'speech',
  tasks: ['text-to-speech'],
  nameKey: 'settings.pages.providers.provider.deepgram-tts.title',
  name: 'Deepgram',
  descriptionKey: 'settings.pages.providers.provider.deepgram-tts.description',
  description: 'deepgram.com',
  icon: 'i-simple-icons:deepgram',
  defaultOptions: () => ({
    baseUrl: 'https://unspeech.hyp3r.link/v1/',
  }),
  createProvider: async (config) => {
    const provider = createUnDeepgram((config.apiKey as string).trim(), (config.baseUrl as string).trim()) as SpeechProviderWithExtraOptions<string, UnDeepgramOptions>
    return provider
  },
  capabilities: {
    listModels: async () => {
      return [
        {
          id: 'aura-2',
          name: 'Aura 2',
          provider: 'deepgram-tts',
          description: 'Latest generation Aura model',
          contextLength: 0,
          deprecated: false,
        },
        {
          id: 'aura-1',
          name: 'Aura 1',
          provider: 'deepgram-tts',
          description: 'First generation Aura model',
          contextLength: 0,
          deprecated: false,
        },
        {
          id: 'aura',
          name: 'Aura (Legacy)',
          provider: 'deepgram-tts',
          description: 'Original Aura model',
          contextLength: 0,
          deprecated: true,
        },
      ]
    },
    listVoices: async (config) => {
      const provider = createUnDeepgram((config.apiKey as string).trim(), (config.baseUrl as string).trim()) as VoiceProviderWithExtraOptions<UnDeepgramOptions>

      const voices = await listVoices({
        ...provider.voice(),
      })

      return voices.map((voice) => {
        return {
          id: voice.id,
          name: voice.name,
          provider: 'deepgram-tts',
          description: voice.description,
          languages: voice.languages,
          gender: voice.labels?.gender,
        }
      })
    },
  },
  validators: {
    chatPingCheckAvailable: false,
    validateProviderConfig: (config) => {
      const errors: Error[] = []
      if (!config.apiKey) {
        errors.push(new Error('API key is required.'))
      }

      const baseUrlValidationResult = baseUrlValidator.value(config.baseUrl)
      if (baseUrlValidationResult) {
        errors.push(...(baseUrlValidationResult.errors as Error[]))
      }

      return {
        errors,
        reason: errors.map(e => e.message).join(', '),
        valid: errors.length === 0,
      }
    },
  },
}
