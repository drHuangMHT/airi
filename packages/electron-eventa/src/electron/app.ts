import { defineInvokeEventa } from '@moeru/eventa'

const quit = defineInvokeEventa<void>('eventa:invoke:electron:app:quit')

export const app = {
  quit,
}
