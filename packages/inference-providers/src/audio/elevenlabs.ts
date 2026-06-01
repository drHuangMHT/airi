export default {
  id: 'elevenlabs',
  category: 'speech',
  tasks: ['text-to-speech'],
  nameKey: 'settings.pages.providers.provider.elevenlabs.title',
  name: 'ElevenLabs',
  descriptionKey: 'settings.pages.providers.provider.elevenlabs.description',
  description: 'elevenlabs.io',
  icon: 'i-simple-icons:elevenlabs',
  defaultOptions: () => ({
    baseUrl: 'https://unspeech.hyp3r.link/v1/',
    voiceSettings: {
      similarityBoost: 0.75,
      stability: 0.5,
    },
  }),
  createProvider: async config => createUnElevenLabs((config.apiKey as string).trim(), (config.baseUrl as string).trim()) as SpeechProviderWithExtraOptions<string, UnElevenLabsOptions>,
  capabilities: {
    listModels: async () => {
      return elevenLabsModels.map((model) => {
        return {
          id: model.model_id,
          name: model.name,
          provider: 'elevenlabs',
          description: model.description,
          contextLength: 0,
          deprecated: false,
        } satisfies ModelInfo
      })
    },
    listVoices: async (config) => {
      const provider = createUnElevenLabs((config.apiKey as string).trim(), (config.baseUrl as string).trim()) as VoiceProviderWithExtraOptions<UnElevenLabsOptions>

      const voices = await listVoices({
        ...provider.voice(),
      })

      if (!voices || !Array.isArray(voices)) {
        return []
      }

      // Find indices of Aria and Bill
      const ariaIndex = voices.findIndex(voice => voice.name.includes('Aria'))
      const billIndex = voices.findIndex(voice => voice.name.includes('Bill'))

      // Determine the range to move (ensure valid indices and proper order)
      const startIndex = ariaIndex !== -1 ? ariaIndex : 0
      const endIndex = billIndex !== -1 ? billIndex : voices.length - 1
      const lowerIndex = Math.min(startIndex, endIndex)
      const higherIndex = Math.max(startIndex, endIndex)

      // Rearrange voices: voices outside the range first, then voices within the range
      const rearrangedVoices = [
        ...voices.slice(0, lowerIndex),
        ...voices.slice(higherIndex + 1),
        ...voices.slice(lowerIndex, higherIndex + 1),
      ]

      return rearrangedVoices.map((voice) => {
        return {
          id: voice.id,
          name: voice.name,
          provider: 'elevenlabs',
          previewURL: voice.preview_audio_url,
          languages: voice.languages,
        }
      })
    },
  },
  validators: {
    chatPingCheckAvailable: false,
    validateProviderConfig: (config) => {
      const errors = [
        !config.apiKey && new Error('API key is required.'),
        !config.baseUrl && new Error('Base URL is required.'),
      ].filter(Boolean)

      const res = baseUrlValidator.value(config.baseUrl)
      if (res) {
        return res
      }

      return {
        errors,
        reason: errors.filter(e => e).map(e => String(e)).join(', ') || '',
        valid: !!config.apiKey && !!config.baseUrl,
      }
    },
  },
}
