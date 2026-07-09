export interface SignInProviderDefinition {
  id: any
  name: string
  icon: string
}

export const defaultSignInProviders = [
  {
    id: 'google',
    name: 'Google',
    icon: 'i-simple-icons-google',
  },
  {
    id: 'github',
    name: 'GitHub',
    icon: 'i-simple-icons-github',
  },
] satisfies SignInProviderDefinition[]
