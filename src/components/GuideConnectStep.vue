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
  /** Allows sending to the destination shown; resolves with the refusal's
   * code, or null once saved. */
  allow: () => Promise<{ code: string | null } | null>
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
/** Listing the provider's models with the key typed in. */
const checking = ref(false)
/** Saving the key, its check included; guards against a second submit. */
const saving = ref(false)
const busy = computed(() => checking.value || saving.value)
const keyError = ref<string | null>(null)
const listNote = ref('')
/** The key saved in this visit was checked with the provider. Without a
 * check, consent says the key is saved, not that it works. */
const keyVerified = ref(false)
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

/** A refusal in plain words. Only `key_rejected` comes from the provider; the
 * server never passes the provider's own text through. An address the
 * platform won't use is not the key's fault. */
function refused(message: string, code: string | null): string {
  if (code === 'key_rejected') return `That key was refused by ${provider.value.name}. Check it and paste it again.`
  // `credential_unusable` from saving is also how the platform says it can't
  // store keys at all; only its base-URL refusals are about the address.
  if (code === 'base_url_refused' || (code === 'credential_unusable' && /base URL/i.test(message))) {
    return `That provider address can't be used: ${message}`
  }
  return `Couldn't save your key: ${message}`
}

/** What a check of the key with the provider found. `unchecked`: it could
 * not be checked (provider unreachable, no listing), which never blocks saving. */
interface KeyCheck {
  outcome: 'ok' | 'key_rejected' | 'address_refused' | 'unchecked'
  code: string | null
  message: string
  models: LlmModelOption[]
}
/** The last check, by key, provider and address, so one is not run twice. */
let lastCheck: { signature: string; result: Promise<KeyCheck>; settled: KeyCheck | null } | null = null
/** A check still running, which a save waits for. */
let running: Promise<KeyCheck> | null = null

function signature(input: { base_url: string; api_key: string }) {
  return JSON.stringify([providerId.value, input.base_url, input.api_key])
}

/** Lists the provider's models with this key, which checks it. A check
 * running or passed for the same key, provider and address is reused. */
function checkKey(input: { base_url: string; api_key: string }): Promise<KeyCheck> {
  const sig = signature(input)
  if (lastCheck?.signature === sig && lastCheck.settled?.outcome !== 'unchecked') return lastCheck.result
  const result = props.adapter.listLlmModels!(input).then(
    (answer): KeyCheck => ({ outcome: 'ok', code: null, message: '', models: answer.models }),
    (err): KeyCheck => {
      const refusal = err as LlmRefusalError
      const code = refusal?.code ?? null
      const message = refusal?.message ?? ''
      if (code === 'key_rejected') return { outcome: 'key_rejected', code, message, models: [] }
      if (code === 'base_url_refused') return { outcome: 'address_refused', code, message, models: [] }
      return { outcome: 'unchecked', code, message, models: [] }
    },
  )
  const entry: { signature: string; result: Promise<KeyCheck>; settled: KeyCheck | null } = { signature: sig, result, settled: null }
  void result.then((check) => {
    entry.settled = check
    if (running === result) running = null
  })
  lastCheck = entry
  running = result
  return result
}

async function showRefusal(check: KeyCheck) {
  keyError.value = refused(check.message, check.code)
  await nextTick()
  keyInput.value?.focus()
}

/** Lists the provider's models with the key typed in, which also checks it.
 * Any failure but a refused key or address leaves the model as a text field,
 * so saving is never blocked. */
async function listModels() {
  if (!props.adapter.listLlmModels || !apiKey.value.trim() || !baseUrl.value) return
  const mine = ++lookup
  checking.value = true
  keyError.value = null
  listNote.value = ''
  try {
    const check = await checkKey({ base_url: baseUrl.value, api_key: apiKey.value.trim() })
    if (mine !== lookup) return
    if (check.outcome === 'ok') {
      models.value = check.models
      const offered = modelOptions.value
      if (!offered.some((o) => o.id === model.value.trim())) model.value = offered[0]?.id ?? ''
      if (!offered.length) {
        models.value = null
        listNote.value = "This provider didn't list any models. Type the model's name."
      }
    } else {
      models.value = null
      if (check.outcome === 'unchecked') listNote.value = "Couldn't list this provider's models. Type the model's name."
      else await showRefusal(check)
    }
  } finally {
    if (mine === lookup) checking.value = false
  }
}

/** Checks the key with the provider unless that already passed for this key,
 * then saves it. A refused key or address is not saved; a key that could not
 * be checked is, and consent then says it is saved, not that it works. A save
 * asked for while the models are being listed waits for that listing. */
async function onSaveKey() {
  if (saving.value) return
  saving.value = true
  try {
    // The key field's change (on blur, or Enter) may have started a listing
    // just before this submit: wait for it, so the save isn't lost to it.
    if (running) await running
    const key: LlmKeyInput = { base_url: baseUrl.value, model: model.value.trim(), api_key: apiKey.value.trim() }
    if (!key.base_url || !key.model || !key.api_key) {
      keyError.value = 'Fill in the provider, the model and your key.'
      return
    }
    lookup++
    checking.value = false
    keyError.value = null
    let verified = false
    if (props.adapter.listLlmModels) {
      const check = await checkKey({ base_url: key.base_url, api_key: key.api_key })
      if (check.outcome === 'key_rejected' || check.outcome === 'address_refused') {
        apiKey.value = ''
        await showRefusal(check)
        return
      }
      verified = check.outcome === 'ok'
    }
    apiKey.value = ''
    const failed = await props.saveKey(key)
    if (failed) keyError.value = refused(failed.message, failed.code)
    else {
      keyVerified.value = verified
      ownKeyChosen.value = false
    }
  } finally {
    saving.value = false
  }
}

// Consent.
const allowing = ref(false)
const consentFailed = ref<string | null>(null)

async function onAllow() {
  if (allowing.value) return
  allowing.value = true
  consentFailed.value = null
  try {
    const failed = await props.allow()
    if (failed) consentFailed.value = failed.code ?? 'failed'
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
          <select id="vmlb-guide-provider" v-model="providerId" name="provider" class="vmlb-guide-input" :disabled="busy" @change="onProviderChange">
            <option v-for="p in LLM_PROVIDERS" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
        </div>
        <div v-if="provider.id === CUSTOM_LLM_PROVIDER" class="vmlb-field">
          <label for="vmlb-guide-base-url">Provider address</label>
          <input id="vmlb-guide-base-url" v-model="customUrl" name="base_url" type="url" class="vmlb-guide-input" placeholder="https://api.example.com/v1" :disabled="busy" @change="onProviderChange" />
        </div>
        <div class="vmlb-field">
          <label for="vmlb-guide-model">Model</label>
          <select v-if="models" id="vmlb-guide-model" v-model="model" name="model" class="vmlb-guide-input" :disabled="busy">
            <option v-for="o in modelOptions" :key="o.id" :value="o.id">{{ o.label }}</option>
          </select>
          <input v-else id="vmlb-guide-model" v-model="model" name="model" type="text" class="vmlb-guide-input" :disabled="busy" />
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
            autocomplete="new-password"
            data-1p-ignore
            data-lpignore="true"
            :disabled="busy"
            :aria-invalid="keyError ? 'true' : undefined"
            @change="listModels"
          />
        </div>
        <div v-if="keyError" class="vmlb-guide-error" role="alert">
          <p><Icon name="alert" /> {{ keyError }}</p>
        </div>
        <div class="vmlb-guide-actions">
          <button type="submit" class="vmlb-btn-primary vmlb-guide-target" :disabled="saving" :aria-busy="busy ? 'true' : undefined">
            {{ busy ? 'Checking your key…' : 'Save key' }}
          </button>
          <button type="button" class="vmlb-btn-secondary vmlb-guide-target" @click="emit('myself')">Label it myself instead</button>
          <button v-if="ownKeyChosen" type="button" class="vmlb-btn-tertiary vmlb-guide-target" @click="ownKeyChosen = false">Use the shared AI</button>
        </div>
      </form>
    </template>

    <template v-else>
      <p class="vmlb-guide-text">
        <template v-if="status?.mode === 'shared'">You can use this platform's shared AI.</template>
        <template v-else-if="keyVerified">Your key works.</template>
        <template v-else>Your key is saved.</template>
        One thing first: to suggest labels, the text of this project's items is sent to <strong>{{ destination }}</strong>.
      </p>
      <ul class="vmlb-guide-bullets">
        <li><Icon name="check" /> Only the item text, your label descriptions and a few items you labelled, as examples, are sent.</li>
        <li><Icon name="lock" /> Items kept aside to test your model are never sent.</li>
      </ul>
      <p v-if="consentFailed === 'destination_changed'" class="vmlb-guide-error" role="alert">
        <Icon name="alert" /> The AI destination changed to {{ destination }}. Check it and allow again.
      </p>
      <p v-else-if="consentFailed !== null" class="vmlb-guide-error" role="alert"><Icon name="alert" /> Couldn't save that. Try again.</p>
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
</style>
