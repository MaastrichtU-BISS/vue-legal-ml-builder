import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import AnnotationWorkspace from '../src/components/AnnotationWorkspace.vue'
import type { AnnotationStats, MLAdapter } from '../src/types'
import { createTestAdapter } from './testAdapter'
import { DEFAULT_TEMPLATE, llmAgreement, llmMethods, llmStatus, llmSuggestion } from './fixtures/llm'

// The guided "Label with AI help" mode inside AnnotationWorkspace, driven by
// what the fake adapter reports.

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
})

const item = { id: 't1', dataset_id: 'ds-1', item_index: 0, text: 'Clause one.', status: 'pending' as const, created_at: '', updated_at: '' }

interface Setup {
  labels?: string[]
  /** Confirmed labels per label, as the server counts them. */
  counts?: Record<string, number>
  stats?: AnnotationStats
  overrides?: Partial<MLAdapter>
  props?: Record<string, unknown>
}

async function mounted({ labels = [], counts = {}, stats = { total: 40, annotated: 0, percentage: 0 }, overrides = {}, props = {} }: Setup = {}) {
  const adapter = createTestAdapter({
    getNextAnnotationTask: vi.fn().mockResolvedValue({ task: item, stats }),
    getDataset: vi.fn().mockResolvedValue({ id: 'ds-1', labels }),
    pageAnnotationTasks: vi.fn(async (_projectId: string, filter: { label?: string }) => ({ tasks: [], total: counts[filter.label ?? ''] ?? 0 })),
    ...llmMethods(),
    ...overrides,
  })
  const wrapper = mount(AnnotationWorkspace, {
    props: { adapter, projectId: 'p1', datasetId: 'ds-1', ...props },
    attachTo: document.body,
  })
  await flushPromises()
  return { adapter, wrapper }
}

type Wrapper = Awaited<ReturnType<typeof mounted>>['wrapper']

const guide = (wrapper: Wrapper) => wrapper.find('section[aria-labelledby="vmlb-guide-title"]')
const currentStep = (wrapper: Wrapper) => wrapper.find('nav li[aria-current="step"]')
const stepHeading = (wrapper: Wrapper) => wrapper.find('.vmlb-guide-step h3')
const button = (wrapper: Wrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)

async function click(wrapper: Wrapper, text: string) {
  const found = button(wrapper, text)
  if (!found) throw new Error(`no button "${text}"`)
  await found.trigger('click')
  await flushPromises()
}

function nameInputs(wrapper: Wrapper) {
  return wrapper.findAll('input[placeholder="Label name"]')
}

function descriptionInputs(wrapper: Wrapper) {
  return wrapper.findAll('input[placeholder="One sentence saying when to use it"]')
}

async function fillLabels(wrapper: Wrapper, rows: [string, string][]) {
  while (descriptionInputs(wrapper).length < rows.length) await click(wrapper, 'Add a label')
  const names = nameInputs(wrapper)
  const offset = descriptionInputs(wrapper).length - names.length
  for (const [i, [name, description]] of rows.entries()) {
    if (i >= offset) await names[i - offset].setValue(name)
    await descriptionInputs(wrapper)[i].setValue(description)
  }
}

describe('the guide: which step it is on', () => {
  it('starts at Your labels when the Dataset names no labels', async () => {
    const { wrapper } = await mounted()

    expect(guide(wrapper).exists()).toBe(true)
    expect(guide(wrapper).text()).toContain('Label with AI help')
    expect(currentStep(wrapper).text()).toContain('Your labels')
    expect(stepHeading(wrapper).text()).toBe('Name your labels')
    expect(guide(wrapper).text()).toContain('About 2 minutes')
    wrapper.unmount()
  })

  it('asks to connect an AI without access', async () => {
    const status = llmStatus({ mode: 'none', destination: null, model: null, shared_key_allowed: false, remaining_tokens: null, acknowledged: false })
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(status) } })

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(stepHeading(wrapper).text()).toBe('Connect an AI')
    // Until later tickets, the step shows today's controls inside the guide.
    expect(guide(wrapper).find('[aria-label="LLM suggestions"]').exists()).toBe(true)
    expect(guide(wrapper).find('input[type="password"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('asks to connect an AI until sending is allowed', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(llmStatus({ acknowledged: false })) } })

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(button(wrapper, 'Allow sending to openrouter.ai')).toBeDefined()
    wrapper.unmount()
  })

  it('moves on once sending is allowed in the step', async () => {
    // Read by the guide, then by today's panel inside the step; acknowledged after the click.
    const unacknowledged = llmStatus({ acknowledged: false })
    const getLlmStatus = vi.fn().mockResolvedValueOnce(unacknowledged).mockResolvedValueOnce(unacknowledged).mockResolvedValue(llmStatus())
    const { adapter, wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus } })

    await click(wrapper, 'Allow sending to openrouter.ai')
    expect(adapter.acknowledgeLlmDestination).toHaveBeenCalledWith('ds-1', 'openrouter.ai')
    expect(currentStep(wrapper).text()).toContain('Show it how')
    wrapper.unmount()
  })

  it('asks for examples while a label has fewer than three', async () => {
    const { adapter, wrapper } = await mounted({ labels: ['Civil', 'Criminal'], counts: { Civil: 9, Criminal: 2 }, stats: { total: 40, annotated: 11, percentage: 27 } })

    expect(currentStep(wrapper).text()).toContain('Show it how')
    expect(guide(wrapper).text()).toContain('About 5 minutes')
    expect(adapter.pageAnnotationTasks).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'annotated', datasetId: 'ds-1', label: 'Criminal' }))
    wrapper.unmount()
  })

  it('tries the AI until the server’s sample is checked', async () => {
    // A Dataset with checked suggestions opens on today's panel unless the guide was chosen.
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 6, Criminal: 6 },
      overrides: { getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ checked: 12, agreed: 10, rate: 10 / 12 })) },
    })

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(guide(wrapper).text()).toContain('About 10 minutes')
    wrapper.unmount()
  })

  it('lets the AI do the rest once the check passed', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 20, Criminal: 20 },
      overrides: { getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ checked: 30, agreed: 27, rate: 0.9, unlocked: true })) },
    })

    expect(currentStep(wrapper).text()).toContain('Do the rest')
    expect(guide(wrapper).text()).toContain('A few minutes')
    wrapper.unmount()
  })

  it('is ready to train when nothing waits for a label, with no time shown', async () => {
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 20, Criminal: 20 },
      stats: { total: 40, annotated: 40, percentage: 100 },
    })

    expect(currentStep(wrapper).text()).toContain('Ready to train')
    expect(stepHeading(wrapper).text()).toBe('Your dataset is ready to train')
    expect(wrapper.find('.vmlb-guide-time').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('the guide: hiding and showing it', () => {
  it('hides for this Dataset, shows today’s panel, and stays hidden next time', async () => {
    const first = await mounted({ labels: ['Civil', 'Criminal'] })
    await click(first.wrapper, 'Hide guide')

    expect(guide(first.wrapper).exists()).toBe(false)
    expect(first.wrapper.find('[aria-label="LLM suggestions"]').text()).toContain('LLM suggestions')
    expect(button(first.wrapper, 'Show guide')).toBeDefined()
    expect(localStorage.getItem('vmlb-guide-hidden:ds-1')).toBe('1')
    first.wrapper.unmount()

    const again = await mounted({ labels: ['Civil', 'Criminal'] })
    expect(guide(again.wrapper).exists()).toBe(false)
    await click(again.wrapper, 'Show guide')
    expect(guide(again.wrapper).exists()).toBe(true)
    expect(localStorage.getItem('vmlb-guide-hidden:ds-1')).toBe('0')
    again.wrapper.unmount()
  })

  it('remembers the choice per Dataset', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-2', '1')
    const { wrapper } = await mounted()

    expect(guide(wrapper).exists()).toBe(true)
    wrapper.unmount()
  })

  it('shows the guide when browser storage is missing', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '1')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage blocked')
    })
    const { wrapper } = await mounted()

    expect(guide(wrapper).exists()).toBe(true)
    await click(wrapper, 'Hide guide')
    expect(guide(wrapper).exists()).toBe(false)
    wrapper.unmount()
  })

  it('opens without the guide for one visit when the host asks', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], props: { guide: 'hidden' } })

    expect(guide(wrapper).exists()).toBe(false)
    expect(wrapper.find('[aria-label="LLM suggestions"]').exists()).toBe(true)
    expect(button(wrapper, 'Show guide')).toBeDefined()
    expect(localStorage.getItem('vmlb-guide-hidden:ds-1')).toBeNull()
    wrapper.unmount()
  })

  it('opens on today’s panel for a Dataset that already has suggestions, unless the guide was chosen', async () => {
    const overrides = { listLlmSuggestions: vi.fn().mockResolvedValue([llmSuggestion()]) }
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides })

    expect(guide(wrapper).exists()).toBe(false)
    expect(wrapper.find('[aria-label="LLM suggestions"]').exists()).toBe(true)
    wrapper.unmount()

    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const chosen = await mounted({ labels: ['Civil', 'Criminal'], overrides })
    expect(guide(chosen.wrapper).exists()).toBe(true)
    chosen.wrapper.unmount()
  })

  it('is replaced by a note for task types without AI help', async () => {
    for (const taskType of ['multi-label', 'ner', 'topic_modeling']) {
      const { adapter, wrapper } = await mounted({ props: { taskType } })

      expect(guide(wrapper).exists()).toBe(false)
      expect(wrapper.text()).toContain("AI help isn't available for this kind of task yet.")
      expect(adapter.getLlmStatus).not.toHaveBeenCalled()
      wrapper.unmount()
    }
  })
})

describe('the guide: loading', () => {
  it('shows a skeleton while it loads', async () => {
    const { wrapper } = await mounted({ overrides: { getLlmStatus: vi.fn(() => new Promise<never>(() => {})) } })

    expect(guide(wrapper).attributes('aria-busy')).toBe('true')
    expect(guide(wrapper).find('.vmlb-guide-skeleton').text()).toContain('Loading your labelling progress')
    expect(wrapper.find('nav').exists()).toBe(false)
    wrapper.unmount()
  })

  it('says when progress could not be loaded, and tries again', async () => {
    const getLlmStatus = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(llmStatus())
    const { wrapper } = await mounted({ overrides: { getLlmStatus } })

    expect(guide(wrapper).find('[role="alert"]').text()).toContain("Couldn't load your labelling progress.")
    await click(wrapper, 'Try again')
    expect(currentStep(wrapper).text()).toContain('Your labels')
    wrapper.unmount()
  })
})

describe('the guide: step 1, Your labels', () => {
  it('marks empty and repeated names on their field, and saves nothing', async () => {
    const { adapter, wrapper } = await mounted()

    await click(wrapper, 'Save labels')
    expect(wrapper.text()).toContain("Label names can't be empty")
    expect(wrapper.findAll('input[aria-invalid="true"]').length).toBeGreaterThan(0)

    await fillLabels(wrapper, [['Civil', 'Private rights.'], ['civil', 'Also private.']])
    await click(wrapper, 'Save labels')
    expect(wrapper.text()).toContain('Two labels have the same name')
    expect(nameInputs(wrapper)[1].attributes('aria-invalid')).toBe('true')

    await wrapper.findAll('button').filter((b) => b.text() === 'Remove')[1].trigger('click')
    await click(wrapper, 'Save labels')
    expect(wrapper.find('[role="alert"]').text()).toBe('Use at least two labels')
    expect(adapter.setDatasetLabels).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows Saving… while it saves', async () => {
    const { wrapper } = await mounted({ overrides: { setDatasetLabels: vi.fn(() => new Promise<never>(() => {})) } })
    await fillLabels(wrapper, [['Civil', 'Private rights.'], ['Criminal', 'Offences.']])

    await click(wrapper, 'Save labels')
    const saving = button(wrapper, 'Saving…')
    expect(saving).toBeDefined()
    expect(saving!.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('keeps what was typed when the server refuses, with its reason', async () => {
    const setDatasetLabels = vi.fn().mockRejectedValue(new Error("'Civil' is already used on an item, so it can't be removed."))
    const { wrapper } = await mounted({ overrides: { setDatasetLabels } })
    await fillLabels(wrapper, [['Contract', 'Agreements.'], ['Tort', 'Wrongs.']])

    await click(wrapper, 'Save labels')
    expect(wrapper.find('.vmlb-guide-server-error').text()).toContain("'Civil' is already used on an item")
    expect(nameInputs(wrapper).map((input) => (input.element as HTMLInputElement).value)).toEqual(['Contract', 'Tort'])
    expect(descriptionInputs(wrapper).map((input) => (input.element as HTMLInputElement).value)).toEqual(['Agreements.', 'Wrongs.'])
    expect(button(wrapper, 'Save labels')).toBeDefined()
    wrapper.unmount()
  })

  it('locks a label already in use as read-only', async () => {
    const { adapter, wrapper } = await mounted({ labels: ['Civil'], counts: { Civil: 3 } })

    const locked = wrapper.find('.vmlb-guide-locked')
    expect(locked.text()).toContain('Civil')
    expect(locked.text()).toContain('In use')
    expect(nameInputs(wrapper)).toHaveLength(1)
    const lockedRow = wrapper.findAll('.vmlb-guide-label-row')[0]
    expect(lockedRow.findAll('button').filter((b) => b.text() === 'Remove')).toHaveLength(0)

    await fillLabels(wrapper, [['Civil', 'Private rights.'], ['Criminal', 'Offences.']])
    await click(wrapper, 'Save labels')
    expect(adapter.setDatasetLabels).toHaveBeenCalledWith('ds-1', ['Civil', 'Criminal'])
    wrapper.unmount()
  })

  it('saves the labels, then a prompt version with the sentences as definitions', async () => {
    const order: string[] = []
    const setDatasetLabels = vi.fn(async (id: string, labels: string[]) => {
      order.push('labels')
      return { id, labels } as never
    })
    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => {
      order.push('prompt')
      return { version: 1, ...edit }
    })
    const { wrapper } = await mounted({ overrides: { setDatasetLabels, updateLlmPrompt } })
    await fillLabels(wrapper, [['Civil', 'Disputes between private parties.'], ['Criminal', 'Offences the state prosecutes.']])

    await click(wrapper, 'Save labels')
    expect(setDatasetLabels).toHaveBeenCalledWith('ds-1', ['Civil', 'Criminal'])
    expect(updateLlmPrompt).toHaveBeenCalledWith('ds-1', {
      template: DEFAULT_TEMPLATE,
      definitions: { Civil: 'Disputes between private parties.', Criminal: 'Offences the state prosecutes.' },
    })
    expect(order).toEqual(['labels', 'prompt'])
    // The labels are set, so the guide moves on.
    expect(currentStep(wrapper).text()).toContain('Show it how')
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).toBeNull()
    wrapper.unmount()
  })

  it('keeps the sentences without AI access, and saves them when the prompt next loads', async () => {
    const none = llmStatus({ mode: 'none', destination: null, model: null, shared_key_allowed: false, remaining_tokens: null, acknowledged: false })
    const first = await mounted({ overrides: { getLlmStatus: vi.fn().mockResolvedValue(none) } })
    await fillLabels(first.wrapper, [['Civil', 'Private rights.'], ['Criminal', 'Offences.']])
    await click(first.wrapper, 'Save labels')

    expect(first.adapter.updateLlmPrompt).not.toHaveBeenCalled()
    expect(currentStep(first.wrapper).text()).toContain('Connect AI')
    expect(JSON.parse(localStorage.getItem('vmlb-guide-descriptions:ds-1')!)).toEqual({ Civil: 'Private rights.', Criminal: 'Offences.' })
    first.wrapper.unmount()

    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 1, ...edit }))
    const later = await mounted({ labels: ['Civil', 'Criminal'], overrides: { updateLlmPrompt } })
    expect(updateLlmPrompt).toHaveBeenCalledWith('ds-1', { template: DEFAULT_TEMPLATE, definitions: { Civil: 'Private rights.', Criminal: 'Offences.' } })
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).toBeNull()
    later.wrapper.unmount()
  })

  it('shows each label’s sentence in the labelling sidebar', async () => {
    const getLlmPrompt = vi.fn().mockResolvedValue({ version: 2, template: DEFAULT_TEMPLATE, definitions: { Civil: 'Disputes between private parties.' } })
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmPrompt } })

    const notes = wrapper.find('dl[aria-label="What your labels mean"]')
    expect(notes.exists()).toBe(true)
    expect(notes.text()).toContain('Civil')
    expect(notes.text()).toContain('Disputes between private parties.')
    wrapper.unmount()
  })
})

describe('the guide: accessibility', () => {
  it('is an ordered list in a nav, with the current step and hidden Done: on finished ones', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], counts: { Civil: 1, Criminal: 0 } })

    const steps = wrapper.findAll('nav ol > li')
    expect(steps).toHaveLength(6)
    expect(steps[2].attributes('aria-current')).toBe('step')
    expect(wrapper.findAll('[aria-current]')).toHaveLength(1)
    expect(steps[0].text()).toContain('Done:')
    expect(steps[1].text()).toContain('Done:')
    expect(steps[2].text()).not.toContain('Done:')
    expect(steps[0].find('.vmlb-guide-sr').text()).toBe('Done:')
    // Done steps are marked by an icon, the others by number: never colour alone.
    expect(steps[3].text()).toContain('4')
    expect(wrapper.find('.vmlb-guide-compact').text()).toContain('Step 3 of 6 · Show it how')
    wrapper.unmount()
  })

  it('moves focus to the step heading when the step changes, not on first load', async () => {
    const { wrapper } = await mounted()
    expect(document.activeElement).not.toBe(stepHeading(wrapper).element)

    await fillLabels(wrapper, [['Civil', 'Private rights.'], ['Criminal', 'Offences.']])
    await click(wrapper, 'Save labels')
    await flushPromises()
    expect(stepHeading(wrapper).text()).toBe('Show the AI how you label')
    expect(document.activeElement).toBe(stepHeading(wrapper).element)
    expect(stepHeading(wrapper).attributes('tabindex')).toBe('-1')
    wrapper.unmount()
  })
})
