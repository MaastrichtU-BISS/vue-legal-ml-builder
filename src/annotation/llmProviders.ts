// AI providers a student can bring their own key for. Each speaks the
// OpenAI-compatible chat API at its base URL; Another provider takes any URL
// the platform allows. Mirrors BAIGLE's `llmProviders.js` (#186, #187).

import type { LlmModelOption } from '../types'
import { isFreeModel } from './llmAssist'

export interface LlmProvider {
  id: string
  name: string
  /** Empty for Another provider, whose URL is typed. */
  baseUrl: string
  /** A model to start from, when there is an obvious one. */
  defaultModel?: string
}

export const CUSTOM_LLM_PROVIDER = 'custom'

export const LLM_PROVIDERS: readonly LlmProvider[] = [
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'anthropic/claude-haiku-5.5' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1' },
  { id: CUSTOM_LLM_PROVIDER, name: 'Another provider', baseUrl: '' },
]

export const DEFAULT_LLM_PROVIDER = 'openrouter'

export function llmProviderById(id: string): LlmProvider {
  return LLM_PROVIDERS.find((p) => p.id === id) ?? LLM_PROVIDERS.find((p) => p.id === CUSTOM_LLM_PROVIDER)!
}

/** A provider's models as options, its default model first when listed. A
 * free model is tagged "(free)", once if its name already says so. `baseUrl`
 * is the one the models came from (a typed one for Another provider): only
 * OpenRouter's `:free` ids are free without the server's flag. */
export function llmModelOptions(
  models: LlmModelOption[],
  provider: LlmProvider,
  baseUrl: string = provider.baseUrl,
): { id: string; label: string; free: boolean }[] {
  const options = models.map((m) => {
    const free = isFreeModel(m, baseUrl)
    const label = m.name && m.name !== m.id ? `${m.id} · ${m.name}` : m.id
    return { id: m.id, label: free && !/\(free\)$/i.test(label) ? `${label} (free)` : label, free }
  })
  const at = provider.defaultModel ? options.findIndex((o) => o.id === provider.defaultModel) : -1
  return at > 0 ? [options[at], ...options.slice(0, at), ...options.slice(at + 1)] : options
}
