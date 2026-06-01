export default {
  id: 'microsoft-speech',
  category: 'speech',
  tasks: ['text-to-speech'],
  nameKey: 'settings.pages.providers.provider.microsoft-speech.title',
  name: 'Microsoft / Azure Speech',
  descriptionKey: 'settings.pages.providers.provider.microsoft-speech.description',
  description: 'speech.microsoft.com',
  iconColor: 'i-lobe-icons:microsoft',
  defaultOptions: () => ({
    baseUrl: 'https://unspeech.hyp3r.link/v1/',
  }),
  createProvider: async config => createUnMicrosoft((config.apiKey as string).trim(), (config.baseUrl as string).trim()) as SpeechProviderWithExtraOptions<string, UnMicrosoftOptions>,
  capabilities: {
    listModels: async () => {
      return [
        {
          id: 'v1',
          name: 'v1',
          provider: 'microsoft-speech',
          description: '',
          contextLength: 0,
          deprecated: false,
        },
      ]
    },
    listVoices: async (config) => {
      const provider = createUnMicrosoft((config.apiKey as string).trim(), (config.baseUrl as string).trim()) as VoiceProviderWithExtraOptions<UnMicrosoftOptions>

      const voices = await listVoices({
        ...provider.voice({ region: config.region as string }),
      })

      return voices.map((voice) => {
        return {
          id: voice.id,
          name: voice.name,
          provider: 'microsoft-speech',
          previewURL: voice.preview_audio_url,
          languages: voice.languages,
          gender: voice.labels?.gender,
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
