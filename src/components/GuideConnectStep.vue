<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import {
  CUSTOM_LLM_PROVIDER,
  DEFAULT_LLM_PROVIDER,
  LLM_PROVIDERS,
  llmModelOptions,
  llmProviderById,
} from '../annotation/llmProviders'
import type { LlmKeyInput, LlmModelOption, LlmRefusalError, LlmStatus, MLAdapter } from '../types'
import Icon from './shared/Icon.vue'

// Step 2, "Connect AI": the shared key first when the account has one, else an
// own key; then plain consent to send text. The saving and the consent go
// through the guide's `useLlmAssist`, passed in as `saveKey` and `allow`.

const props = defineProps<{
  adapter: MLAdapter
  status: LlmStatus | null
  /** `useLlmAssist`'s `hasAccess`. */
  hasAccess: boolean
  /** The shared key's monthly allowance is used up. */
  budgetExhausted: boolean
  /** Saves the key; resolves with the refusal, or null once saved. */
  saveKey: (key: LlmKeyInput) => Promise<{ message: string; code: string | null } | null>
  /** Allows sending to the destination shown; resolves true once saved. */
  allow: () => Promise<boolean>
}>()
const emit = defineEmits<{
  /** "Label it myself instead": hide the guide for this Dataset. */
  (e: 'myself'): void
}>()

/** The student asked for their own key while the shared one works. */
const ownKeyChosen = ref(false)
const sharedDown = computed(() => props.status?.mode === 'shared' && props.status.shared_key_available === false)
const outOfTokens = computed(() => props.budgetExhausted && props.status?.mode === 'shared' && !sharedDown.value)
const showKeyForm = computed(() => !props.hasAccess || outOfTokens.value || ownKeyChosen.value)
const destination = computed(() => props.status?.destination ?? '')

// The own-key form. The key is read when sent and cleared straight after.
const providerId = ref(DEFAULT_LLM_PROVIDER)
const provider = computed(() => llmProviderById(providerId.value))
const customUrl = ref('')
const model = ref(provider.value.defaultModel ?? '')
const apiKey = ref('')
const baseUrl = computed(() => (provider.value.id === CUSTOM_LLM_PROVIDER ? customUrl.value.trim() : provider.value.baseUrl))
/** The provider's models once listed; null shows a text field. */
const models = ref<LlmModelOption[] | null>(null)
const modelOptions = computed(() => (models.value ? llmModelOptions(models.value, provider.value) : []))
/** Checking the key: listing its models, or saving it. */
const checking = ref(false)
const keyError = ref<{ text: string; reason: string | null } | null>(null)
const listNote = ref('')
let lookup = 0

const keyInput = ref<HTMLInputElement | null>(null)

function onProviderChange() {
  model.value = provider.value.defaultModel ?? ''
  models.value = null
  listNote.value = ''
  keyError.value = null
  lookup++
  if (apiKey.value.trim()) void listModels()
}

function refused(message: string, code: string | null): { text: string; reason: string | null } {
  if (code === 'key_rejected' || code === 'credential_unusable') {
    return { text: `That key was refused by ${provider.value.name}. Check it and paste it again.`, reason: message || null }
  }
  return { text: `Couldn't save your key: ${message}`, reason: null }
}

/** Lists the provider's models with the key typed in, which also checks it.
 * Any failure leaves the model as a text field, so saving is never blocked. */
async function listModels() {
  if (!props.adapter.listLlmModels || !apiKey.value.trim() || !baseUrl.value) return
  const mine = ++lookup
  checking.value = true
  keyError.value = null
  listNote.value = ''
  try {
    const answer = await props.adapter.listLlmModels({ base_url: baseUrl.value, api_key: apiKey.value.trim() })
    if (mine !== lookup) return
    models.value = answer.models
    const offered = modelOptions.value
    if (!offered.some((o) => o.id === model.value.trim())) model.value = offered[0]?.id ?? ''
    if (!offered.length) {
      models.value = null
      listNote.value = "This provider didn't list any models. Type the model's name."
    }
  } catch (err) {
    if (mine !== lookup) return
    models.value = null
    const refusal = err as LlmRefusalError
    if (refusal?.code === 'key_rejected') {
      keyError.value = refused(refusal.message, refusal.code)
      await nextTick()
      keyInput.value?.focus()
    } else {
      listNote.value = "Couldn't list this provider's models. Type the model's name."
    }
  } finally {
    if (mine === lookup) checking.value = false
  }
}

async function onSaveKey() {
  if (checking.value) return
  const key: LlmKeyInput = { base_url: baseUrl.value, model: model.value.trim(), api_key: apiKey.value.trim() }
  if (!key.base_url || !key.model || !key.api_key) {
    keyError.value = { text: 'Fill in the provider, the model and your key.', reason: null }
    return
  }
  lookup++
  apiKey.value = ''
  checking.value = true
  keyError.value = null
  try {
    const failed = await props.saveKey(key)
    if (failed) keyError.value = refused(failed.message, failed.code)
    else ownKeyChosen.value = false
  } finally {
    checking.value = false
  }
}

// Consent.
const allowing = ref(false)
const consentFailed = ref(false)

async function onAllow() {
  if (allowing.value) return
  allowing.value = true
  consentFailed.value = false
  try {
    consentFailed.value = !(await props.allow())
  } finally {
    allowing.value = false
  }
}
</script>

<template>
  <div class="vmlb-guide-connect">
    <template v-if="showKeyForm">
      <p v-if="outOfTokens" class="vmlb-guide-warning" role="alert">
        <Icon name="alert" />
        <span>This month's shared AI allowance is used up. The suggestions already made are kept. Add your own key to carry on, or label the rest yourself.</span>
      </p>
      <p v-else-if="sharedDown" class="vmlb-guide-warning" role="alert">
        <Icon name="alert" />
        <span>The shared AI can't be used right now, because its usage can't be checked. Add your own key to carry on, or label it yourself.</span>
      </p>
      <p v-else-if="ownKeyChosen" class="vmlb-guide-text">
        Add a key from an AI provider. A key is like a password that lets this platform use your account there; the
        provider may charge you for what it uses.
      </p>
      <p v-else-if="status?.key" class="vmlb-guide-text">
        Your saved key can't be used right now. Add a key from an AI provider again. A key is like a password that lets
        this platform use your account there; the provider may charge you for what it uses.
      </p>
      <p v-else-if="status?.shared_key_configured === false" class="vmlb-guide-text">
        This platform has no shared AI. To get suggestions, add a key from an AI provider. A key is like a password that
        lets this platform use your account there; the provider may charge you for what it uses.
      </p>
      <p v-else class="vmlb-guide-text">
        Your account can't use the shared AI. To get suggestions, add a key from an AI provider. A key is like a password
        that lets this platform use your account there; the provider may charge you for what it uses.
      </p>
      <p v-if="outOfTokens || sharedDown" class="vmlb-guide-text">
        A key is like a password that lets this platform use your account at an AI provider; the provider may charge you
        for what it uses.
      </p>

      <form class="vmlb-guide-key" autocomplete="off" novalidate @submit.prevent="onSaveKey">
        <div class="vmlb-field">
          <label for="vmlb-guide-provider">Provider</label>
          <select id="vmlb-guide-provider" v-model="providerId" name="provider" class="vmlb-guide-input" :disabled="checking" @change="onProviderChange">
            <option v-for="p in LLM_PROVIDERS" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div v-if="provider.id === CUSTOM_LLM_PROVIDER" class="vmlb-field">
          <label for="vmlb-guide-base-url">Provider address</label>
          <input id="vmlb-guide-base-url" v-model="customUrl" name="base_url" type="url" class="vmlb-guide-input" placeholder="https://api.example.com/v1" :disabled="checking" @change="onProviderChange" />
        </div>
        <div class="vmlb-field">
          <label for="vmlb-guide-model">Model</label>
          <select v-if="models" id="vmlb-guide-model" v-model="model" name="model" class="vmlb-guide-input" :disabled="checking">
            <option v-for="o in modelOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
          <input v-else id="vmlb-guide-model" v-model="model" name="model" type="text" class="vmlb-guide-input" :disabled="checking" />
          <p v-if="listNote" class="vmlb-guide-hint">{{ listNote }}</p>
          <p v-else-if="!models && adapter.listLlmModels" class="vmlb-guide-hint">Paste your key to choose from this provider's models.</p>
        </div>
        <div class="vmlb-field">
          <label for="vmlb-guide-api-key">API key</label>
          <input
            id="vmlb-guide-api-key"
            ref="keyInput"
            v-model="apiKey"
            name="api_key"
            type="password"
            class="vmlb-guide-input"
            placeholder="Paste your key"
            autocomplete="off"
            :disabled="checking"
            :aria-invalid="keyError ? 'true' : undefined"
            @change="listModels"
          />
        </div>
        <div v-if="keyError" class="vmlb-guide-error" role="alert">
          <p><Icon name="alert" /> {{ keyError.text }}</p>
          <p v-if="keyError.reason" class="vmlb-guide-reason">{{ provider.name }} said: {{ keyError.reason }}</p>
        </div>
        <div class="vmlb-guide-actions">
          <button type="submit" class="vmlb-btn-primary vmlb-guide-target" :disabled="checking" :aria-busy="checking ? 'true' : undefined">
            {{ checking ? 'Checking your key…' : 'Save key' }}
          </button>
          <button type="button" class="vmlb-btn-secondary vmlb-guide-target" @click="emit('myself')">Label it myself instead</button>
          <button v-if="ownKeyChosen" type="button" class="vmlb-btn-tertiary vmlb-guide-target" @click="ownKeyChosen = false">Use the shared AI</button>
        </div>
      </form>
    </template>

    <template v-else>
      <p class="vmlb-guide-text">
        <template v-if="status?.mode === 'shared'">You can use this platform's shared AI.</template>
        <template v-else>Your key works.</template>
        One thing first: to suggest labels, the text of this project's items is sent to <strong>{{ destination }}</strong>.
      </p>
      <ul class="vmlb-guide-bullets">
        <li><Icon name="check" /> Only the item text and your label descriptions are sent.</li>
        <li><Icon name="lock" /> Items kept aside to test your model are never sent.</li>
      </ul>
      <p v-if="consentFailed" class="vmlb-guide-error" role="alert"><Icon name="alert" /> Couldn't save that. Try again.</p>
      <div class="vmlb-guide-actions">
        <button type="button" class="vmlb-btn-primary vmlb-guide-target" :disabled="allowing" :aria-busy="allowing ? 'true' : undefined" @click="onAllow">
          Allow sending to {{ destination }}
        </button>
        <button type="button" class="vmlb-btn-secondary vmlb-guide-target" @click="emit('myself')">Label it myself instead</button>
        <button v-if="status?.mode === 'shared'" type="button" class="vmlb-btn-tertiary vmlb-guide-target" @click="ownKeyChosen = true">
          Use my own key instead
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.vmlb-guide-connect { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); }
.vmlb-guide-text { margin: 0; }
.vmlb-guide-hint { margin: var(--vmlb-space-2xs) 0 0; color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-sm); }
.vmlb-guide-key { display: flex; flex-direction: column; gap: var(--vmlb-space-sm); max-width: 28rem; }
/* The form's gap spaces the fields; the shared field margin would double it. */
.vmlb-guide-key .vmlb-field { margin: 0; }
.vmlb-guide-input { min-height: 2.75rem; }
.vmlb-guide-actions { display: flex; flex-wrap: wrap; gap: var(--vmlb-space-sm); }
.vmlb-guide-target { min-height: 2.75rem; }
.vmlb-guide-bullets { display: flex; flex-direction: column; gap: var(--vmlb-space-2xs); margin: 0; padding: 0; list-style: none; }
.vmlb-guide-bullets li { display: flex; align-items: flex-start; gap: var(--vmlb-space-xs); }
.vmlb-guide-bullets :deep(svg) { flex-shrink: 0; margin-top: 0.15rem; color: var(--vmlb-text-muted); }
.vmlb-guide-warning {
  display: flex; align-items: flex-start; gap: var(--vmlb-space-xs); margin: 0;
  padding: var(--vmlb-space-sm) var(--vmlb-space-md); border-radius: var(--vmlb-radius-md);
  background: var(--vmlb-warning-soft); color: var(--vmlb-text);
}
.vmlb-guide-error p { display: flex; align-items: center; gap: var(--vmlb-space-xs); margin: 0; color: var(--vmlb-error); }
p.vmlb-guide-error { display: flex; align-items: center; gap: var(--vmlb-space-xs); margin: 0; color: var(--vmlb-error); }
.vmlb-guide-error .vmlb-guide-reason { margin-top: var(--vmlb-space-2xs); color: var(--vmlb-text-muted); font-size: var(--vmlb-font-size-sm); }
</style>
