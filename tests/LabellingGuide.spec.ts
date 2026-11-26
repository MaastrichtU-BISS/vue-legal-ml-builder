import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import AnnotationWorkspace from '../src/components/AnnotationWorkspace.vue'
import GuideLabelsStep from '../src/components/GuideLabelsStep.vue'
import LabellingGuide from '../src/components/LabellingGuide.vue'
import type { ActiveLearningState, AnnotationStats, MLAdapter } from '../src/types'
import { AnnotatorView } from 'legal-annotation-kit'
import { createTestAdapter } from './testAdapter'
import { DEFAULT_TEMPLATE, llmAgreement, llmMethods, llmStatus, llmSuggestion, refusal } from './fixtures/llm'

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
    // One label's count, or a page of every labelled item, as the server answers.
    pageAnnotationTasks: vi.fn(async (_projectId: string, filter: { label?: string; limit?: number; offset?: number }) => {
      if (filter.label !== undefined) return { tasks: [], total: counts[filter.label] ?? 0 }
      const all = Object.entries(counts).flatMap(([label, n]) =>
        Array.from({ length: n }, (_, i) => ({ ...item, id: `${label}-${i}`, status: 'annotated' as const, annotation_label: label })),
      )
      const offset = filter.offset ?? 0
      return { tasks: all.slice(offset, offset + (filter.limit ?? all.length)), total: all.length }
    }),
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
/** The current step's heading: the guide's only h3 before the step's own content. */
const stepHeading = (wrapper: Wrapper) => guide(wrapper).find('h3')
const alerts = (wrapper: Wrapper) => wrapper.findAll('[role="alert"]').map((a) => a.text())
const labelRows = (wrapper: Wrapper) => guide(wrapper).findAll('form li')
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
    // The step's own key form, not today's panel.
    expect(guide(wrapper).find('[aria-label="LLM suggestions"]').exists()).toBe(false)
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
    // Read by the guide on load; acknowledged after the click.
    const getLlmStatus = vi.fn().mockResolvedValueOnce(llmStatus({ acknowledged: false })).mockResolvedValue(llmStatus())
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
    expect(guide(wrapper).text()).not.toMatch(/About \d+ minutes|A few minutes/)
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
    expect(guide(wrapper).find('[role="status"]').text()).toContain('Loading your labelling progress')
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
    expect(alerts(wrapper).some((text) => text.includes("'Civil' is already used on an item"))).toBe(true)
    expect(nameInputs(wrapper).map((input) => (input.element as HTMLInputElement).value)).toEqual(['Contract', 'Tort'])
    expect(descriptionInputs(wrapper).map((input) => (input.element as HTMLInputElement).value)).toEqual(['Agreements.', 'Wrongs.'])
    expect(button(wrapper, 'Save labels')).toBeDefined()
    wrapper.unmount()
  })

  it('locks a label already in use as read-only', async () => {
    const { adapter, wrapper } = await mounted({ labels: ['Civil'], counts: { Civil: 3 } })

    const lockedRow = labelRows(wrapper)[0]
    expect(lockedRow.text()).toContain('Civil')
    expect(lockedRow.text()).toContain('In use')
    expect(nameInputs(wrapper)).toHaveLength(1)
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
    // Done steps are marked by an icon, the others by number: never colour alone.
    expect(steps[3].text()).toContain('4')
    expect(guide(wrapper).text()).toContain('Step 3 of 6 · Show it how')
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

describe('the guide is the one next action', () => {
  const AL_SETTINGS = {
    strategies: ['prediction_entropy', 'random'],
    default_strategy: 'prediction_entropy',
    default_batch_size: 20,
    min_per_class: 5,
    default_holdout_percent: 20,
    max_holdout_percent: 50,
    seed_sources: { random: true, llm: false },
  }
  // Fresh mocks per test: afterEach restores every mock.
  const alState = () => ({
    getActiveLearningSettings: vi.fn().mockResolvedValue(AL_SETTINGS),
    getActiveLearningState: vi.fn().mockResolvedValue({ active: false }),
  })
  const LOOP_HEADING = 'Let the Model choose what to label next'

  it('leaves out "Let the Model choose what to label next" while the guide shows', async () => {
    const { wrapper } = await mounted({ overrides: alState() })
    expect(guide(wrapper).exists()).toBe(true)
    expect(wrapper.text()).not.toContain(LOOP_HEADING)
    wrapper.unmount()
  })

  it('keeps it in the hidden-guide view', async () => {
    const { wrapper } = await mounted({ overrides: alState(), props: { guide: 'hidden' } })
    expect(guide(wrapper).exists()).toBe(false)
    expect(wrapper.findAll('h2').some((h) => h.text() === LOOP_HEADING)).toBe(true)
    wrapper.unmount()
  })

  it('is not offered by a host without LLM help, which keeps the Model-led panel', async () => {
    const { wrapper } = await mounted({ overrides: { ...alState(), getLlmStatus: undefined } })
    expect(guide(wrapper).exists()).toBe(false)
    expect(button(wrapper, 'Show guide')).toBeUndefined()
    expect(wrapper.findAll('h2').some((h) => h.text() === LOOP_HEADING)).toBe(true)
    wrapper.unmount()
  })

  it('opens on today’s panels for a Dataset whose Model-led loop already runs, with nothing stored', async () => {
    const running = {
      active: true, strategy: 'random', seed_source: 'random', batch_size: 20, min_per_class: 5, model_id: null,
      round: { number: 0, status: 'labelling', strategy: 'random', model_id: null, job_id: null, labels_used: null, metrics: null, error: null, created_at: '', completed_at: null },
      label_counts: { Civil: 1 }, typed_labels: false,
      retrain: { new_labels: 0, allowed: false, suggested: false, classes_short: {}, needs_second_label: false, labels_total: 1, label_cap: 100, classes_left_out: [], classes_unseen: [], classes_to_train: 1, labels_needed: 1 },
      holdout: { percent: 20, size: 10, labelled: 0, label_counts: {}, needed: 10, verification: null },
    } as unknown as ActiveLearningState
    const overrides = { ...alState(), getActiveLearningState: vi.fn().mockResolvedValue(running) }
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides })
    expect(guide(wrapper).exists()).toBe(false)
    expect(wrapper.find('section[aria-label="Active learning"]').exists()).toBe(true)
    expect(button(wrapper, 'Show guide')).toBeDefined()
    expect(localStorage.getItem('vmlb-guide-hidden:ds-1')).toBeNull()
    wrapper.unmount()
  })

  it('labels every field with visible text, not only a placeholder', async () => {
    const { wrapper } = await mounted()
    const labels = guide(wrapper).findAll('form label').map((l) => l.text())
    expect(labels.filter((t) => t.startsWith('Label name')).length).toBeGreaterThanOrEqual(2)
    expect(labels.filter((t) => t.startsWith('When to use it')).length).toBeGreaterThanOrEqual(2)
    wrapper.unmount()
  })
})

describe('the guide: what is left', () => {
  it('is not Ready to train when the queue is empty but rows still need a label', async () => {
    const stats = { total: 0, annotated: 0, percentage: 0 }
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      stats,
      overrides: { getNextAnnotationTask: vi.fn().mockResolvedValue({ task: null, stats }) },
      props: { unlabelledRows: 12 },
    })

    expect(currentStep(wrapper).text()).not.toContain('Ready to train')
    expect(currentStep(wrapper).text()).toContain('Show it how')
    wrapper.unmount()
  })

  it('marks steps passed over because nothing was left as skipped, not done', async () => {
    const none = llmStatus({ mode: 'none', destination: null, model: null, shared_key_allowed: false, remaining_tokens: null, acknowledged: false })
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 20, Criminal: 20 },
      stats: { total: 40, annotated: 40, percentage: 100 },
      overrides: { getLlmStatus: vi.fn().mockResolvedValue(none) },
    })

    const steps = wrapper.findAll('nav ol > li')
    expect(currentStep(wrapper).text()).toContain('Ready to train')
    expect(steps[0].text()).toContain('Done:')
    expect(steps[1].text()).toContain('Skipped:')
    expect(steps[1].text()).not.toContain('Done:')
    expect(steps[1].text()).toContain('2')
    // Enough shown: done, though the AI was never connected.
    expect(steps[2].text()).toContain('Done:')
    expect(steps[3].text()).toContain('Skipped:')
    expect(steps[4].text()).toContain('Skipped:')
    wrapper.unmount()
  })
})

describe('the guide: labels already in use on a Dataset that names none', () => {
  it('locks the labels found on items as In use, and lets the student add new ones', async () => {
    const { adapter, wrapper } = await mounted({ counts: { Civil: 2, Criminal: 1 } })

    const rows = labelRows(wrapper)
    expect(rows.map((row) => row.text().includes('In use'))).toEqual([true, true])
    expect(rows[0].text()).toContain('Civil')
    expect(rows[1].text()).toContain('Criminal')
    expect(nameInputs(wrapper)).toHaveLength(0)
    expect(adapter.pageAnnotationTasks).toHaveBeenCalledWith('p1', expect.objectContaining({ status: 'annotated', datasetId: 'ds-1', includeHoldout: true }))

    await click(wrapper, 'Add a label')
    await nameInputs(wrapper)[0].setValue('Tort')
    const sentences = descriptionInputs(wrapper)
    await sentences[0].setValue('Private rights.')
    await sentences[1].setValue('Offences.')
    await sentences[2].setValue('Wrongs.')
    await click(wrapper, 'Save labels')
    expect(adapter.setDatasetLabels).toHaveBeenCalledWith('ds-1', ['Civil', 'Criminal', 'Tort'])
    wrapper.unmount()
  })

  it('keeps the form behind the skeleton until the labels in use are known', async () => {
    const pageAnnotationTasks = vi.fn(() => new Promise<never>(() => {}))
    const { wrapper } = await mounted({ overrides: { pageAnnotationTasks } })

    expect(guide(wrapper).find('[role="status"]').text()).toContain('Loading your labelling progress')
    expect(guide(wrapper).find('form').exists()).toBe(false)
    wrapper.unmount()
  })

  it('adds labels in use that arrive late, locked, without touching what was typed', async () => {
    const adapter = createTestAdapter()
    const wrapper = mount(GuideLabelsStep, {
      props: { adapter, datasetId: 'ds-1', labels: [], inUse: [], descriptions: {} },
      attachTo: document.body,
    })
    const names = () => wrapper.findAll('input[placeholder="Label name"]')
    const sentences = () => wrapper.findAll('input[placeholder="One sentence saying when to use it"]')
    await names()[0].setValue('Tort')
    await sentences()[0].setValue('Wrongs.')

    await wrapper.setProps({ inUse: ['Civil'], descriptions: { Civil: 'Private rights.', Tort: 'Something else.' } })
    const rows = wrapper.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('Civil')
    expect(rows[0].text()).toContain('In use')
    expect((sentences()[0].element as HTMLInputElement).value).toBe('Private rights.')
    expect(names().map((input) => (input.element as HTMLInputElement).value)).toEqual(['Tort'])
    expect((sentences()[1].element as HTMLInputElement).value).toBe('Wrongs.')
    wrapper.unmount()
  })
})

describe('the guide: saving the sentences', () => {
  it('says when the labels saved but the sentences did not, and tries again', async () => {
    const updateLlmPrompt = vi
      .fn()
      .mockRejectedValueOnce(new Error('The prompt check failed.'))
      .mockImplementation(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 1, ...edit }))
    const { wrapper } = await mounted({ overrides: { updateLlmPrompt } })
    await fillLabels(wrapper, [['Civil', 'Private rights.'], ['Criminal', 'Offences.']])
    await click(wrapper, 'Save labels')

    const message = "Your labels are saved, but their sentences aren't saved yet: The prompt check failed."
    expect(alerts(wrapper)).toContain(message)
    await click(wrapper, 'Try again')
    expect(updateLlmPrompt).toHaveBeenCalledTimes(2)
    expect(updateLlmPrompt).toHaveBeenLastCalledWith('ds-1', { template: DEFAULT_TEMPLATE, definitions: { Civil: 'Private rights.', Criminal: 'Offences.' } })
    expect(alerts(wrapper)).not.toContain(message)
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).toBeNull()
    wrapper.unmount()
  })

  it('fills only empty definitions from sentences waiting since an earlier visit', async () => {
    localStorage.setItem('vmlb-guide-descriptions:ds-1', JSON.stringify({ Civil: 'Old.', Criminal: 'Offences.' }))
    const getLlmPrompt = vi.fn().mockResolvedValue({ version: 3, template: DEFAULT_TEMPLATE, definitions: { Civil: 'Newer.' } })
    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 4, ...edit }))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmPrompt, updateLlmPrompt } })

    expect(updateLlmPrompt).toHaveBeenCalledWith('ds-1', { template: DEFAULT_TEMPLATE, definitions: { Civil: 'Newer.', Criminal: 'Offences.' } })
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).toBeNull()
    wrapper.unmount()
  })

  it('drops waiting sentences once the prompt already defines those labels', async () => {
    localStorage.setItem('vmlb-guide-descriptions:ds-1', JSON.stringify({ Civil: 'Old.' }))
    const getLlmPrompt = vi.fn().mockResolvedValue({ version: 3, template: DEFAULT_TEMPLATE, definitions: { Civil: 'Newer.' } })
    const { adapter, wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmPrompt } })

    expect(adapter.updateLlmPrompt).not.toHaveBeenCalled()
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).toBeNull()
    expect(wrapper.find('dl[aria-label="What your labels mean"]').text()).toContain('Newer.')
    wrapper.unmount()
  })

  it('runs a save asked for while the prompt still loads, once it has loaded', async () => {
    let release!: (value: unknown) => void
    const getLlmPrompt = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
      .mockResolvedValue({ version: 0, template: DEFAULT_TEMPLATE, definitions: {} })
    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 1, ...edit }))
    const { wrapper } = await mounted({ overrides: { getLlmPrompt, updateLlmPrompt } })
    await fillLabels(wrapper, [['Civil', 'Private rights.'], ['Criminal', 'Offences.']])
    await click(wrapper, 'Save labels')
    expect(updateLlmPrompt).not.toHaveBeenCalled()

    release({ version: 0, template: DEFAULT_TEMPLATE, definitions: {} })
    await flushPromises()
    expect(updateLlmPrompt).toHaveBeenCalledWith('ds-1', { template: DEFAULT_TEMPLATE, definitions: { Civil: 'Private rights.', Criminal: 'Offences.' } })
    wrapper.unmount()
  })
})

describe('the guide: rows and Datasets', () => {
  it('moves focus to the next row after Remove, or to Add a label when none is left', async () => {
    const { wrapper } = await mounted()
    await click(wrapper, 'Add a label')
    const names = nameInputs(wrapper)
    await names[0].setValue('A')
    await names[1].setValue('B')
    await names[2].setValue('C')

    await wrapper.findAll('button').filter((b) => b.text() === 'Remove')[0].trigger('click')
    await flushPromises()
    expect(nameInputs(wrapper).map((input) => (input.element as HTMLInputElement).value)).toEqual(['B', 'C'])
    expect(document.activeElement).toBe(nameInputs(wrapper)[0].element)

    await wrapper.findAll('button').filter((b) => b.text() === 'Remove')[1].trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(button(wrapper, 'Add a label')!.element)
    wrapper.unmount()
  })

  it('starts again for another Dataset', async () => {
    const { adapter, wrapper } = await mounted({ labels: ['Civil', 'Criminal'] })
    await wrapper.setProps({ datasetId: 'ds-2' })
    await flushPromises()
    expect(adapter.getLlmStatus).toHaveBeenCalledWith('ds-2')
    expect(guide(wrapper).exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('finding the labels in use (review round 2)', () => {
  const annotated = (labels: string[]) => labels.map((annotation_label, i) => ({ id: `t${i}`, annotation_label }))

  function guideWith(pageAnnotationTasks: ReturnType<typeof vi.fn>) {
    const adapter = createTestAdapter({ pageAnnotationTasks, ...llmMethods() })
    return mount(LabellingGuide, {
      props: {
        adapter, projectId: 'p1', datasetId: 'ds-1', labels: [], inUse: [],
        stats: { total: 40, annotated: 3, percentage: 7 }, statsLoading: false, labelsVersion: 0,
      },
      attachTo: document.body,
    })
  }

  it('pages the labelled items once on load, not again after each saved item', async () => {
    const pageAnnotationTasks = vi.fn().mockResolvedValue({ tasks: annotated(['Civil', 'Criminal']), total: 2 })
    const wrapper = guideWith(pageAnnotationTasks)
    await flushPromises()
    const afterLoad = pageAnnotationTasks.mock.calls.length

    await wrapper.setProps({ labelsVersion: 1 })
    await flushPromises()
    await wrapper.setProps({ labelsVersion: 2 })
    await flushPromises()

    expect(afterLoad).toBeGreaterThan(0)
    expect(pageAnnotationTasks.mock.calls.length).toBe(afterLoad)
    wrapper.unmount()
  })

  it('advances by the rows that came back, so a short page skips nothing', async () => {
    const all = annotated(['Civil', 'Civil', 'Criminal', 'Tort'])
    const pageAnnotationTasks = vi.fn(async (_p: string, filter: { offset?: number }) => {
      const offset = filter.offset ?? 0
      return { tasks: all.slice(offset, offset + 2), total: all.length }
    })
    const wrapper = guideWith(pageAnnotationTasks)
    await flushPromises()

    expect(pageAnnotationTasks.mock.calls.map(([, f]) => (f as { offset: number }).offset)).toEqual([0, 2])
    expect(wrapper.text()).toContain('Tort')
    wrapper.unmount()
  })
})

describe('a label in use arriving late matches what was typed ignoring case', () => {
  it('locks the typed row with the server spelling instead of adding a duplicate', async () => {
    const adapter = createTestAdapter()
    const wrapper = mount(GuideLabelsStep, {
      props: { adapter, datasetId: 'ds-1', labels: [], inUse: [], descriptions: {} },
      attachTo: document.body,
    })
    await wrapper.findAll('input[type="text"]')[0].setValue('civil')
    await wrapper.setProps({ inUse: ['Civil'] })
    await flushPromises()

    expect(wrapper.text().match(/In use/g)).toHaveLength(1)
    expect(wrapper.text()).toContain('Civil')
    expect(wrapper.findAll('input[type="text"]').map((i) => (i.element as HTMLInputElement).value)).not.toContain('civil')
    wrapper.unmount()
  })
})

describe('saving the sentences waits for the go-ahead to send text (BAIGLE #199 review)', () => {
  it('keeps the sentences, with no prompt save and no alert, until the Project allows sending', async () => {
    const updateLlmPrompt = vi.fn()
    const getLlmStatus = vi.fn().mockResolvedValue(llmStatus({ acknowledged: false }))
    const { wrapper } = await mounted({ overrides: { getLlmStatus, updateLlmPrompt } })
    await fillLabels(wrapper, [['Civil', 'Disputes between private parties.'], ['Criminal', 'Offences the state prosecutes.']])

    await click(wrapper, 'Save labels')

    expect(updateLlmPrompt).not.toHaveBeenCalled()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(JSON.parse(localStorage.getItem('vmlb-guide-descriptions:ds-1') ?? '{}')).toMatchObject({ Civil: 'Disputes between private parties.' })
    wrapper.unmount()
  })

  it('saves the waiting sentences once, when the student allows sending in step 2', async () => {
    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 1, ...edit }))
    const getLlmStatus = vi.fn().mockResolvedValue(llmStatus({ acknowledged: false }))
    const { wrapper } = await mounted({ overrides: { getLlmStatus, updateLlmPrompt } })
    await fillLabels(wrapper, [['Civil', 'Disputes between private parties.'], ['Criminal', 'Offences the state prosecutes.']])
    await click(wrapper, 'Save labels')
    expect(updateLlmPrompt).not.toHaveBeenCalled()

    getLlmStatus.mockResolvedValue(llmStatus({ acknowledged: true }))
    await click(wrapper, 'Allow sending to openrouter.ai')
    await flushPromises()

    expect(updateLlmPrompt).toHaveBeenCalledTimes(1)
    expect(updateLlmPrompt.mock.calls[0][1].definitions).toEqual({
      Civil: 'Disputes between private parties.',
      Criminal: 'Offences the state prosecutes.',
    })
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).toBeNull()
    wrapper.unmount()
  })
})

describe("a host's guide: 'shown'", () => {
  it('opens the guide for this visit even when it was hidden before', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '1')
    const { wrapper } = await mounted({ props: { guide: 'shown' } })

    expect(guide(wrapper).exists()).toBe(true)
    // The stored choice is the student's; one visit doesn't change it.
    expect(localStorage.getItem('vmlb-guide-hidden:ds-1')).toBe('1')
    wrapper.unmount()
  })
})

// ---------------------------------------------------------------------------
// Step 2, Connect AI, and step 3, Show it how (BAIGLE #194).
// ---------------------------------------------------------------------------

const noShared = () =>
  llmStatus({ mode: 'none', destination: null, model: null, shared_key_allowed: false, shared_key_configured: false, remaining_tokens: null, acknowledged: false })
const ownKey = (overrides = {}) =>
  llmStatus({ mode: 'byok', destination: 'openrouter.ai', key: { base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5' }, remaining_tokens: null, acknowledged: false, ...overrides })
const fieldLabel = (wrapper: Wrapper, id: string) => wrapper.find(`label[for="${id}"]`)

async function typeKey(wrapper: Wrapper, key = 'sk-test') {
  const input = guide(wrapper).find('input[type="password"]')
  await input.setValue(key)
  return input
}

async function submitKey(wrapper: Wrapper) {
  await guide(wrapper).find('form').trigger('submit')
  await flushPromises()
}

describe('step 2, Connect AI: the key', () => {
  it('offers the shared key first, straight to consent', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(llmStatus({ acknowledged: false })) } })

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(guide(wrapper).text()).toContain("You can use this platform's shared AI.")
    expect(guide(wrapper).find('input[type="password"]').exists()).toBe(false)
    expect(button(wrapper, 'Use my own key instead')).toBeDefined()
    wrapper.unmount()
  })

  it('without a shared key, shows the own-key form with a plain line on keys and charges', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()) } })

    expect(guide(wrapper).text()).toContain(
      'This platform has no shared AI. To get suggestions, add a key from an AI provider. A key is like a password that lets this platform use your account there; the provider may charge you for what it uses.',
    )
    expect(fieldLabel(wrapper, 'vmlb-guide-provider').text()).toBe('Provider')
    expect(fieldLabel(wrapper, 'vmlb-guide-model').text()).toBe('Model')
    expect(fieldLabel(wrapper, 'vmlb-guide-api-key').text()).toBe('API key')
    expect(button(wrapper, 'Save key')).toBeDefined()
    expect(button(wrapper, 'Label it myself instead')).toBeDefined()
    wrapper.unmount()
  })

  it('shows Checking your key… on the button while the key is saved', async () => {
    let finish: (value: unknown) => void = () => undefined
    const saveLlmKey = vi.fn(() => new Promise((resolve) => { finish = resolve }))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), saveLlmKey } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    const busy = wrapper.findAll('button').find((b) => b.text() === 'Checking your key…')
    expect(busy?.attributes('disabled')).toBeDefined()
    expect(saveLlmKey).toHaveBeenCalledWith({ base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5', api_key: 'sk-test' })
    // The key leaves the form once sent.
    expect((guide(wrapper).find('input[type="password"]').element as HTMLInputElement).value).toBe('')
    finish({ base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5' })
    await flushPromises()
    wrapper.unmount()
  })

  it.each([
    ['The base URL must point to a public host.'],
    ['This base URL is not allowed on this platform.'],
  ])('blames the address, not the key, when saving refuses the base URL: %s', async (message) => {
    // legal-ml-core's PUT /llm/key: validate_byok_url refuses as credential_unusable.
    const saveLlmKey = vi.fn().mockRejectedValue(refusal(message, 'credential_unusable'))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), saveLlmKey } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    expect(alerts(wrapper)).toEqual([`That provider address can't be used: ${message}`])
    expect(guide(wrapper).text()).not.toContain('refused by OpenRouter')
    expect(guide(wrapper).text()).not.toContain('said:')
    expect(button(wrapper, 'Save key')).toBeDefined()
    wrapper.unmount()
  })

  it("says a platform that can't store keys plainly, without blaming the key or the address", async () => {
    // legal-ml-core's PUT /llm/key: encrypt_key refuses as credential_unusable too.
    const saveLlmKey = vi.fn().mockRejectedValue(refusal('Storing API keys is not configured on this platform.', 'credential_unusable'))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), saveLlmKey } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    expect(alerts(wrapper)).toEqual(["Couldn't save your key: Storing API keys is not configured on this platform."])
    wrapper.unmount()
  })

  it('blames the address when the key check refuses the base URL, and saves nothing', async () => {
    // legal-ml-core's POST /llm/models: base_url_refused.
    const listLlmModels = vi.fn().mockRejectedValue(refusal('The base URL must be a plain https URL.', 'base_url_refused'))
    const saveLlmKey = vi.fn()
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels, saveLlmKey } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    expect(alerts(wrapper)).toEqual(["That provider address can't be used: The base URL must be a plain https URL."])
    expect(saveLlmKey).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('checks the key before saving it, and saves nothing when the provider refuses it', async () => {
    // legal-ml-core's POST /llm/models: key_rejected, "The provider rejected this API key."
    const listLlmModels = vi.fn().mockRejectedValue(refusal('The provider rejected this API key.', 'key_rejected'))
    const saveLlmKey = vi.fn()
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels, saveLlmKey } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    expect(listLlmModels).toHaveBeenCalledWith({ base_url: 'https://openrouter.ai/api/v1', api_key: 'sk-test' })
    expect(saveLlmKey).not.toHaveBeenCalled()
    expect(alerts(wrapper)).toEqual(['That key was refused by OpenRouter. Check it and paste it again.'])
    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(guide(wrapper).text()).not.toContain('Your key works.')
    wrapper.unmount()
  })

  it('shows Checking your key… while the key is checked before saving', async () => {
    let answer: (value: unknown) => void = () => undefined
    const listLlmModels = vi.fn(() => new Promise((resolve) => { answer = resolve }))
    const saveLlmKey = vi.fn().mockResolvedValue({ base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5' })
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels, saveLlmKey } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    expect(button(wrapper, 'Checking your key…')).toBeDefined()
    expect(saveLlmKey).not.toHaveBeenCalled()
    answer({ models: [{ id: 'anthropic/claude-haiku-5.5' }] })
    await flushPromises()
    expect(saveLlmKey).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('says the key works only after the provider accepted it, and checks it once', async () => {
    const listLlmModels = vi.fn().mockResolvedValue({ models: [{ id: 'anthropic/claude-haiku-5.5' }] })
    const getLlmStatus = vi.fn().mockResolvedValueOnce(noShared()).mockResolvedValue(ownKey())
    const { adapter, wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus, listLlmModels } })
    await (await typeKey(wrapper)).trigger('change')
    await flushPromises()
    await submitKey(wrapper)

    // The check on paste passed for this key, so saving doesn't run it again.
    expect(listLlmModels).toHaveBeenCalledTimes(1)
    expect(adapter.saveLlmKey).toHaveBeenCalledTimes(1)
    expect(guide(wrapper).text()).toContain("Your key works. One thing first: to suggest labels, the text of this project's items is sent to openrouter.ai.")
    wrapper.unmount()
  })

  it("saves a key the provider couldn't be asked about, and says it is saved, not that it works", async () => {
    // legal-ml-core's POST /llm/models: provider_unreachable (502).
    const listLlmModels = vi.fn().mockRejectedValue(refusal('The provider could not be reached. Check the base URL and try again.', 'provider_unreachable'))
    const getLlmStatus = vi.fn().mockResolvedValueOnce(noShared()).mockResolvedValue(ownKey())
    const { adapter, wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus, listLlmModels } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    expect(adapter.saveLlmKey).toHaveBeenCalledTimes(1)
    expect(guide(wrapper).text()).toContain("Your key is saved. One thing first: to suggest labels, the text of this project's items is sent to openrouter.ai.")
    expect(guide(wrapper).text()).not.toContain('Your key works.')
    wrapper.unmount()
  })

  it('keeps a save asked for while the pasted key is still being checked, and saves once after', async () => {
    let answer: (value: unknown) => void = () => undefined
    const listLlmModels = vi.fn(() => new Promise((resolve) => { answer = resolve }))
    const saveLlmKey = vi.fn().mockResolvedValue({ base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5' })
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels, saveLlmKey } })
    const key = await typeKey(wrapper)

    // Clicking Save straight after pasting: the field's change (on blur) and the submit in one tick.
    void key.trigger('change')
    void guide(wrapper).find('form').trigger('submit')
    await flushPromises()
    expect(saveLlmKey).not.toHaveBeenCalled()
    expect(button(wrapper, 'Checking your key…')).toBeDefined()

    answer({ models: [{ id: 'anthropic/claude-haiku-5.5' }] })
    await flushPromises()
    expect(listLlmModels).toHaveBeenCalledTimes(1)
    expect(saveLlmKey).toHaveBeenCalledTimes(1)
    expect(saveLlmKey).toHaveBeenCalledWith({ base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5', api_key: 'sk-test' })
    wrapper.unmount()
  })

  it('keeps a click on Save made while the pasted key is being checked, and saves the model the check picked', async () => {
    let answer: (value: unknown) => void = () => undefined
    const listLlmModels = vi.fn(() => new Promise((resolve) => { answer = resolve }))
    const saveLlmKey = vi.fn().mockResolvedValue({ base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-x' })
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels, saveLlmKey } })
    const key = await typeKey(wrapper)

    // As in a browser: leaving the field starts the check and the page redraws before the click lands.
    await key.trigger('change')
    await button(wrapper, 'Checking your key…')!.trigger('click')
    await flushPromises()
    expect(saveLlmKey).not.toHaveBeenCalled()

    // The provider doesn't offer the default model, so the check picks its first one.
    answer({ models: [{ id: 'openai/gpt-x' }] })
    await flushPromises()
    expect(listLlmModels).toHaveBeenCalledTimes(1)
    expect(saveLlmKey).toHaveBeenCalledTimes(1)
    expect(saveLlmKey).toHaveBeenCalledWith({ base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-x', api_key: 'sk-test' })
    wrapper.unmount()
  })

  it('leaves the key out of password managers', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()) } })
    const key = guide(wrapper).find('input[type="password"]')

    expect(key.attributes('autocomplete')).toBe('new-password')
    expect(key.attributes('data-1p-ignore')).toBeDefined()
    expect(key.attributes('data-lpignore')).toBe('true')
    wrapper.unmount()
  })

  it("checks the key by listing the provider's models, and offers them to pick from", async () => {
    const listLlmModels = vi.fn().mockResolvedValue({ models: [{ id: 'openai/gpt-x' }, { id: 'anthropic/claude-haiku-5.5', name: 'Claude Haiku' }] })
    const { adapter, wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels } })
    const key = await typeKey(wrapper)
    await key.trigger('change')
    await flushPromises()

    expect(listLlmModels).toHaveBeenCalledWith({ base_url: 'https://openrouter.ai/api/v1', api_key: 'sk-test' })
    const options = guide(wrapper).findAll('select#vmlb-guide-model option').map((o) => o.text())
    expect(options).toEqual(['anthropic/claude-haiku-5.5 · Claude Haiku', 'openai/gpt-x'])
    await guide(wrapper).find('select#vmlb-guide-model').setValue('openai/gpt-x')
    await submitKey(wrapper)
    expect(adapter.saveLlmKey).toHaveBeenCalledWith({ base_url: 'https://openrouter.ai/api/v1', model: 'openai/gpt-x', api_key: 'sk-test' })
    wrapper.unmount()
  })

  it('says when the provider refuses the key while listing its models', async () => {
    const listLlmModels = vi.fn().mockRejectedValue(refusal('The provider rejected this API key.', 'key_rejected'))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels } })
    await (await typeKey(wrapper)).trigger('change')
    await flushPromises()

    expect(alerts(wrapper).join(' ')).toContain('That key was refused by OpenRouter. Check it and paste it again.')
    // The model stays a text field, so saving is never blocked.
    expect(guide(wrapper).find('input#vmlb-guide-model').exists()).toBe(true)
    wrapper.unmount()
  })

  it("saves nothing for a key the server says has characters a key can't contain", async () => {
    // legal-ml-core's POST /llm/models: 400 invalid_request, BAD_KEY.
    const listLlmModels = vi.fn().mockRejectedValue(refusal("The API key has characters an API key can't contain.", 'invalid_request'))
    const saveLlmKey = vi.fn()
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels, saveLlmKey } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    expect(saveLlmKey).not.toHaveBeenCalled()
    expect(alerts(wrapper).join(' ')).toContain("The API key has characters an API key can't contain. Check it and paste it again.")
    wrapper.unmount()
  })

  it('asks the provider again for a key it refused before, in case the account was fixed', async () => {
    // Typing the key checks it; Save asks again rather than trusting the refusal.
    const listLlmModels = vi.fn()
      .mockRejectedValueOnce(refusal('The provider rejected this API key.', 'key_rejected'))
      .mockRejectedValueOnce(refusal('The provider rejected this API key.', 'key_rejected'))
      .mockResolvedValue({ models: [{ id: 'anthropic/claude-haiku-5.5' }] })
    const saveLlmKey = vi.fn().mockResolvedValue({ base_url: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5' })
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()), listLlmModels, saveLlmKey } })
    await typeKey(wrapper)
    await submitKey(wrapper)
    expect(saveLlmKey).not.toHaveBeenCalled()

    await typeKey(wrapper)
    await submitKey(wrapper)
    expect(listLlmModels.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(saveLlmKey).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('says when the shared key’s meter is down, with the own-key form open', async () => {
    const down = llmStatus({ shared_key_available: false, acknowledged: false })
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(down) } })

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(alerts(wrapper).join(' ')).toContain("The shared AI can't be used right now")
    expect(guide(wrapper).find('input[type="password"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('returns to Connect AI when the shared allowance is used up, keeping what was done', async () => {
    const spent = llmStatus({ remaining_tokens: 0, acknowledged: true })
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 6, Criminal: 6 },
      overrides: { getLlmStatus: vi.fn().mockResolvedValue(spent) },
    })

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(alerts(wrapper).join(' ')).toContain(
      "This month's shared AI allowance is used up. The suggestions already made are kept. Add your own key to carry on, or label the rest yourself.",
    )
    expect(guide(wrapper).find('input[type="password"]').exists()).toBe(true)
    wrapper.unmount()
  })
})

describe('step 2, Connect AI: consent', () => {
  it('after a saved key, says what is sent and where, and that held-out items never are', async () => {
    const getLlmStatus = vi.fn().mockResolvedValueOnce(noShared()).mockResolvedValue(ownKey())
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    const text = guide(wrapper).text()
    // No key check here (the adapter can't list models), so the key is saved, not known to work.
    expect(text).toContain("Your key is saved. One thing first: to suggest labels, the text of this project's items is sent to openrouter.ai.")
    expect(text).toContain('Only the item text, your label descriptions and a few items you labelled, as examples, are sent.')
    expect(text).toContain('Items kept aside to test your model are never sent.')
    expect(button(wrapper, 'Allow sending to openrouter.ai')).toBeDefined()
    expect(button(wrapper, 'Label it myself instead')).toBeDefined()
    wrapper.unmount()
  })

  it("says Couldn't save that. Try again. when the consent isn't saved", async () => {
    const acknowledgeLlmDestination = vi.fn().mockRejectedValue(new Error('Server error'))
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      overrides: { getLlmStatus: vi.fn().mockResolvedValue(ownKey()), acknowledgeLlmDestination },
    })
    await click(wrapper, 'Allow sending to openrouter.ai')

    expect(alerts(wrapper)).toContain("Couldn't save that. Try again.")
    expect(currentStep(wrapper).text()).toContain('Connect AI')
    wrapper.unmount()
  })

  it('says where the AI now sends text when the destination changed before Allow', async () => {
    // legal-ml-core's POST .../acknowledgement: 409 destination_changed, with the new destination.
    const acknowledgeLlmDestination = vi.fn().mockRejectedValue(
      refusal('The LLM destination has changed. Please review it again.', 'destination_changed', { destination: 'api.openai.com' }),
    )
    const getLlmStatus = vi.fn().mockResolvedValueOnce(ownKey()).mockResolvedValue(ownKey({ destination: 'api.openai.com' }))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus, acknowledgeLlmDestination } })
    await click(wrapper, 'Allow sending to openrouter.ai')

    expect(alerts(wrapper)).toContain('The AI destination changed to api.openai.com. Check it and allow again.')
    expect(alerts(wrapper)).not.toContain("Couldn't save that. Try again.")
    expect(button(wrapper, 'Allow sending to api.openai.com')).toBeDefined()
    expect(currentStep(wrapper).text()).toContain('Connect AI')
    wrapper.unmount()
  })

  it('hands off to Show it how once sending is allowed', async () => {
    const getLlmStatus = vi.fn().mockResolvedValueOnce(ownKey()).mockResolvedValue(ownKey({ acknowledged: true }))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus } })
    await click(wrapper, 'Allow sending to openrouter.ai')

    expect(currentStep(wrapper).text()).toContain('Show it how')
    expect(guide(wrapper).text()).toContain('Connected. Before it suggests anything, show it 10 examples so it learns what you mean. About 5 minutes.')
    wrapper.unmount()
  })

  it.each([
    ['the consent', () => llmStatus({ acknowledged: false })],
    ['the key form', noShared],
  ])('Label it myself instead, from %s, hides the guide for this Dataset and remembers it', async (_where, status) => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(status()) } })
    await click(wrapper, 'Label it myself instead')

    expect(guide(wrapper).exists()).toBe(false)
    expect(localStorage.getItem('vmlb-guide-hidden:ds-1')).toBe('1')
    wrapper.unmount()
  })
})

describe('step 3, Show it how', () => {
  const liveCount = (wrapper: Wrapper) => wrapper.find('[aria-live="polite"]')

  it('shows a count per label, marking those with enough, and the total out of 10 in a polite live region', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], counts: { Civil: 3, Criminal: 1 }, stats: { total: 40, annotated: 4, percentage: 10 } })

    expect(currentStep(wrapper).text()).toContain('Show it how')
    expect(guide(wrapper).text()).toContain(
      'Label a few items yourself first. The AI learns what you mean from these: at least 3 of each label, 10 in total.',
    )
    const chips = guide(wrapper).find('ul[aria-label="Examples so far"]').findAll('li').map((li) => li.text())
    expect(chips[0]).toContain('Done:')
    expect(chips[0]).toContain('Civil 3 of 3')
    expect(chips[1]).toContain('Criminal 1 of 3')
    expect(chips[1]).not.toContain('Done:')
    expect(liveCount(wrapper).text()).toBe('4 of 10 examples labelled.')
    wrapper.unmount()
  })

  it('keeps the item in its own box below the panel', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], counts: { Civil: 1, Criminal: 1 } })

    expect(currentStep(wrapper).text()).toContain('Show it how')
    expect(guide(wrapper).text()).not.toContain('Clause one.')
    const html = wrapper.html()
    expect(html.indexOf('Clause one.')).toBeGreaterThan(html.indexOf('Label with AI help'))
    wrapper.unmount()
  })

  it('says a held-out item is kept aside and never seen by the AI', async () => {
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 1, Criminal: 1 },
      overrides: { getNextAnnotationTask: vi.fn().mockResolvedValue({ task: { ...item, is_holdout: true }, stats: { total: 40, annotated: 2, percentage: 5 } }) },
    })

    expect(guide(wrapper).text()).toContain(
      "This item is kept aside to test your model later. You label these yourself; the AI never sees them. It doesn't count toward the 10.",
    )
    wrapper.unmount()
  })

  it("says when a label can't reach 3 because too few items are left", async () => {
    // Two items left: Other can reach 2 at most; Civil can still reach 3.
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal', 'Other'],
      counts: { Civil: 1, Criminal: 8, Other: 0 },
      stats: { total: 11, annotated: 9, percentage: 82 },
    })

    expect(currentStep(wrapper).text()).toContain('Show it how')
    expect(guide(wrapper).text()).toContain("Only 2 items are left to label, so Other can reach at most 2. That's enough to continue.")
    expect(guide(wrapper).text()).not.toContain('so Civil can reach')
    expect(liveCount(wrapper).text()).toBe('9 of 10 examples labelled.')
    wrapper.unmount()
  })

  it('says one item is left in the singular', async () => {
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal', 'Other'],
      counts: { Civil: 4, Criminal: 4, Other: 1 },
      stats: { total: 10, annotated: 9, percentage: 90 },
    })

    expect(guide(wrapper).text()).toContain("Only 1 item is left to label, so Other can reach at most 2. That's enough to continue.")
    wrapper.unmount()
  })

  it('folds to one line with a Details toggle, for phones', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], counts: { Civil: 3, Criminal: 3 }, stats: { total: 40, annotated: 6, percentage: 15 } })

    const details = button(wrapper, 'Details')!
    expect(details.attributes('aria-expanded')).toBe('false')
    const body = wrapper.find(`#${details.attributes('aria-controls')}`)
    expect(body.exists()).toBe(true)
    expect(body.text()).toContain('Show the AI how you label')
    expect(details.element.parentElement!.textContent).toContain('Step 3 of 6 · 6 of 10 examples')
    await details.trigger('click')
    expect(details.attributes('aria-expanded')).toBe('true')
    wrapper.unmount()
  })

  it('offers no Details toggle in other steps', async () => {
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus: vi.fn().mockResolvedValue(noShared()) } })

    expect(button(wrapper, 'Details')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('waiting sentences save on consent with the guide hidden (BAIGLE #194 follow-up)', () => {
  it("are saved by today's panel when the student allows sending there", async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '1')
    localStorage.setItem('vmlb-guide-descriptions:ds-1', JSON.stringify({ Civil: 'Private disputes.', Criminal: 'Offences.' }))
    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 1, ...edit }))
    const getLlmStatus = vi.fn().mockResolvedValue(llmStatus({ acknowledged: false }))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus, updateLlmPrompt } })
    expect(guide(wrapper).exists()).toBe(false)
    expect(updateLlmPrompt).not.toHaveBeenCalled()

    getLlmStatus.mockResolvedValue(llmStatus({ acknowledged: true }))
    await click(wrapper, 'Allow sending to openrouter.ai')
    await flushPromises()

    expect(updateLlmPrompt).toHaveBeenCalledTimes(1)
    expect(updateLlmPrompt).toHaveBeenCalledWith('ds-1', { template: DEFAULT_TEMPLATE, definitions: { Civil: 'Private disputes.', Criminal: 'Offences.' } })
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).toBeNull()
    wrapper.unmount()
  })

  it("doesn't announce a new prompt version for this save, which the student didn't make", async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '1')
    localStorage.setItem('vmlb-guide-descriptions:ds-1', JSON.stringify({ Civil: 'Private disputes.' }))
    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 1, ...edit }))
    const getLlmStatus = vi.fn().mockResolvedValue(llmStatus({ acknowledged: false }))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus, updateLlmPrompt } })

    getLlmStatus.mockResolvedValue(llmStatus({ acknowledged: true }))
    await click(wrapper, 'Allow sending to openrouter.ai')
    await flushPromises()

    expect(updateLlmPrompt).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).not.toContain('Saved as version')
    wrapper.unmount()
  })

  it('stay waiting when the prompt save is refused', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '1')
    localStorage.setItem('vmlb-guide-descriptions:ds-1', JSON.stringify({ Civil: 'Private disputes.' }))
    const updateLlmPrompt = vi.fn().mockRejectedValue(new Error('Refused'))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { updateLlmPrompt } })

    expect(updateLlmPrompt).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).not.toBeNull()
    wrapper.unmount()
  })
})

describe('phones: the folded Show it how (PR #18 review)', () => {
  // The guide folds Show it how under this media query; jsdom has no matchMedia.
  function onPhone() {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query === '(max-width: 640px)', media: query, addEventListener() {}, removeEventListener() {} }),
    })
  }
  afterEach(() => {
    delete (window as { matchMedia?: unknown }).matchMedia
  })

  it('opens Details after Allow, so the hand-off line is seen, and focuses the step heading', async () => {
    onPhone()
    const getLlmStatus = vi.fn().mockResolvedValueOnce(ownKey()).mockResolvedValue(ownKey({ acknowledged: true }))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus } })
    await click(wrapper, 'Allow sending to openrouter.ai')
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Show it how')
    expect(button(wrapper, 'Details')!.attributes('aria-expanded')).toBe('true')
    expect(guide(wrapper).text()).toContain('Connected. Before it suggests anything, show it 10 examples so it learns what you mean.')
    expect(document.activeElement).toBe(stepHeading(wrapper).element)
    wrapper.unmount()
  })

  it('moves focus to Details, not the folded-away heading, when the step becomes Show it how', async () => {
    onPhone()
    const { wrapper } = await mounted()
    await fillLabels(wrapper, [['Civil', 'Private rights.'], ['Criminal', 'Offences.']])
    await click(wrapper, 'Save labels')
    await flushPromises()

    const details = button(wrapper, 'Details')!
    expect(details.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(details.element)
    wrapper.unmount()
  })

  it('opens with no hand-off line when access arrives without Allow', async () => {
    // A key saved for a destination this Project already allowed: ready rises, but nothing was allowed now.
    const getLlmStatus = vi.fn().mockResolvedValueOnce(noShared()).mockResolvedValue(ownKey({ acknowledged: true }))
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], overrides: { getLlmStatus } })
    await typeKey(wrapper)
    await submitKey(wrapper)

    expect(currentStep(wrapper).text()).toContain('Show it how')
    expect(guide(wrapper).text()).not.toContain('Connected. Before it suggests anything')
    expect(guide(wrapper).text()).toContain('About 5 minutes')
    wrapper.unmount()
  })
})

describe('waiting sentences with the guide on Do the rest (PR #18 review)', () => {
  it('are saved once, by the guide, with no panel of its own in the step', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    localStorage.setItem('vmlb-guide-descriptions:ds-1', JSON.stringify({ Civil: 'Private disputes.', Criminal: 'Offences.' }))
    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 1, ...edit }))
    // The prompt answers only once both the guide and the panel have asked for
    // it, so both still see the sentences waiting when their access arrives.
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const getLlmPrompt = vi.fn(async () => {
      await gate
      return { version: 0, template: DEFAULT_TEMPLATE, definitions: {} }
    })
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 6, Criminal: 6 },
      stats: { total: 40, annotated: 12, percentage: 30 },
      overrides: {
        updateLlmPrompt,
        getLlmPrompt,
        getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ checked: 30, agreed: 27, rate: 0.9, unlocked: true })),
      },
    })
    await flushPromises()
    release()
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Do the rest')
    // Do the rest has its own controls (BAIGLE #196), not today's panel.
    expect(guide(wrapper).find('section[aria-label="LLM suggestions"]').exists()).toBe(false)
    expect(button(wrapper, 'Work out the cost')).toBeDefined()
    expect(updateLlmPrompt).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('vmlb-guide-descriptions:ds-1')).toBeNull()
    wrapper.unmount()
  })
})

describe('step 4, Try it', () => {
  /** Enough shown (6 of each, 12 in all) with 40 items: the guide is on Try it. */
  const shown = { labels: ['Civil', 'Criminal'], counts: { Civil: 6, Criminal: 6 }, stats: { total: 40, annotated: 12, percentage: 30 } }
  const suggested = () => vi.fn().mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 })
  const card = (wrapper: Wrapper) => guide(wrapper).find('[aria-label="The AI\'s suggestion"]')
  const liveCount = (wrapper: Wrapper) => guide(wrapper).find('[aria-live="polite"]')

  async function onTry(overrides: Partial<MLAdapter> = {}, setup: Setup = {}) {
    return mounted({ ...shown, ...setup, overrides: { createLlmSuggestions: suggested(), ...overrides } })
  }

  it("asks the AI about the item on screen and shows its label and reason with Accept <label>", async () => {
    const { adapter, wrapper } = await onTry()

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(stepHeading(wrapper).text()).toBe('Try the AI on a few items')
    expect(adapter.createLlmSuggestions).toHaveBeenCalledTimes(1)
    expect(adapter.createLlmSuggestions).toHaveBeenCalledWith('ds-1', ['t1'])
    expect(card(wrapper).text()).toContain('The AI suggests Criminal')
    expect(card(wrapper).text()).toContain('The clause sets out a penalty for an offence.')
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    // The item's own proposal isn't shown as well: one Accept, in the guide.
    expect(button(wrapper, 'Accept')).toBeUndefined()
    wrapper.unmount()
  })

  it('accepts the suggestion, which saves it as the label', async () => {
    const { adapter, wrapper } = await onTry()

    await click(wrapper, 'Accept Criminal')

    expect(adapter.confirmLlmSuggestion).toHaveBeenCalledTimes(1)
    expect(adapter.confirmLlmSuggestion).toHaveBeenCalledWith('s1')
    wrapper.unmount()
  })

  it("picking another label rejects the suggestion and saves the student's label", async () => {
    const { adapter, wrapper } = await onTry()

    const other = card(wrapper).findAll('button').find((b) => b.text() === 'Civil')!
    expect(card(wrapper).findAll('button').some((b) => b.text() === 'Criminal')).toBe(false)
    await other.trigger('click')
    await flushPromises()

    expect(adapter.confirmLlmSuggestion).toHaveBeenCalledWith('s1', 'Civil')
    wrapper.unmount()
  })

  it('accepts a focused suggestion with Enter, and skips with S', async () => {
    const { adapter, wrapper } = await onTry({ skipAnnotation: vi.fn().mockResolvedValue({}) })

    ;(card(wrapper).element as HTMLElement).focus()
    await card(wrapper).trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(adapter.confirmLlmSuggestion).toHaveBeenCalledWith('s1')

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true }))
    await flushPromises()
    expect(adapter.skipAnnotation).toHaveBeenCalledWith('t1')
    wrapper.unmount()
  })

  it('counts the checks still needed from the server’s settings, in a polite live region', async () => {
    const { wrapper } = await onTry()
    expect(liveCount(wrapper).text()).toBe('30 more to check before it can label the rest.')
    wrapper.unmount()

    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const other = await onTry({
      getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ checked: 12, agreed: 10, rate: 10 / 12, min_sample: 20, threshold: 0.9 })),
    })
    expect(liveCount(other.wrapper).text()).toBe('The AI agreed with you on 10 of 12. 8 more to check before it can label the rest.')
    other.wrapper.unmount()
  })

  it('shows Asking the AI… in the suggestion’s place while it waits', async () => {
    let answer: (batch: unknown) => void = () => undefined
    const createLlmSuggestions = vi.fn(() => new Promise((resolve) => { answer = resolve }))
    const { wrapper } = await onTry({ createLlmSuggestions: createLlmSuggestions as MLAdapter['createLlmSuggestions'] })

    const asking = guide(wrapper).findAll('[role="status"]').find((s) => s.text() === 'Asking the AI…')!
    expect(asking).toBeDefined()
    expect(button(wrapper, 'Accept Criminal')).toBeUndefined()
    const box = asking.element.parentElement!

    answer({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 })
    await flushPromises()
    expect(guide(wrapper).text()).not.toContain('Asking the AI…')
    expect(box.contains(card(wrapper).element)).toBe(true)
    wrapper.unmount()
  })

  it("says when the AI didn't answer, and tries again", async () => {
    const createLlmSuggestions = vi.fn()
      .mockRejectedValueOnce(refusal('Provider unavailable', 'llm_failed'))
      .mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 })
    const { adapter, wrapper } = await onTry({ createLlmSuggestions })

    expect(alerts(wrapper)).toContain("The AI didn't answer. Label this one yourself, or try again.")
    await click(wrapper, 'Try again')

    expect(adapter.createLlmSuggestions).toHaveBeenCalledTimes(2)
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    wrapper.unmount()
  })

  it("reports an answer that wasn't one of the labels as skipped", async () => {
    const { wrapper } = await onTry({ createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [], skipped: 0, invalid: 1 }) })

    expect(guide(wrapper).text()).toContain("Skipped: the AI's answer wasn't one of your labels. Label this one yourself.")
    expect(button(wrapper, 'Accept Criminal')).toBeUndefined()
    wrapper.unmount()
  })

  it('shows no suggestion for a held-out item, and says why', async () => {
    const { adapter, wrapper } = await onTry({
      getNextAnnotationTask: vi.fn().mockResolvedValue({ task: { ...item, is_holdout: true }, stats: shown.stats }),
    })

    expect(adapter.createLlmSuggestions).not.toHaveBeenCalled()
    expect(guide(wrapper).text()).toContain('This item is kept aside to test your model later. You label these yourself; the AI never sees them.')
    expect(button(wrapper, 'Accept Criminal')).toBeUndefined()
    wrapper.unmount()
  })

  it('moves to Do the rest once the check passes', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const getLlmAgreement = vi.fn()
      .mockResolvedValueOnce(llmAgreement({ model: 'mistral-small', prompt_version: 0, checked: 29, agreed: 26, rate: 26 / 29 }))
      .mockResolvedValue(llmAgreement({ model: 'mistral-small', prompt_version: 0, checked: 30, agreed: 27, rate: 0.9, unlocked: true }))
    const { wrapper } = await onTry({ getLlmAgreement })
    expect(liveCount(wrapper).text()).toBe('The AI agreed with you on 26 of 29. 1 more to check before it can label the rest.')

    await click(wrapper, 'Accept Criminal')
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Do the rest')
    expect(document.activeElement).toBe(stepHeading(wrapper).element)
    wrapper.unmount()
  })
})

describe('step 4, Try it (PR #19 review)', () => {
  const shown = { labels: ['Civil', 'Criminal'], counts: { Civil: 6, Criminal: 6 }, stats: { total: 40, annotated: 12, percentage: 30 } }
  const liveRegions = (wrapper: Wrapper) => guide(wrapper).findAll('[aria-live="polite"]')

  it('asks the AI once sending is allowed in the same visit, with the prompt loaded then', async () => {
    const getLlmStatus = vi.fn().mockResolvedValueOnce(llmStatus({ acknowledged: false })).mockResolvedValue(llmStatus())
    const { adapter, wrapper } = await mounted({
      ...shown,
      overrides: { getLlmStatus, createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 }) },
    })
    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(adapter.getLlmPrompt).not.toHaveBeenCalled()

    await click(wrapper, 'Allow sending to openrouter.ai')
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(adapter.getLlmPrompt).toHaveBeenCalledTimes(1)
    expect(adapter.createLlmSuggestions).toHaveBeenCalledTimes(1)
    expect(guide(wrapper).text()).not.toContain('Asking the AI…')
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    wrapper.unmount()
  })

  it('after Allow in the same visit, never shows an older prompt’s passed check while the prompt loads', async () => {
    let release: (prompt: unknown) => void = () => undefined
    const getLlmPrompt = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const getLlmStatus = vi.fn().mockResolvedValueOnce(llmStatus({ acknowledged: false })).mockResolvedValue(llmStatus())
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 20, Criminal: 22 },
      stats: { total: 80, annotated: 42, percentage: 52 },
      overrides: {
        getLlmStatus,
        // Prompt version 0 passed the check; the student has since saved version 1.
        getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ model: 'mistral-small', prompt_version: 0, checked: 30, agreed: 27, rate: 0.9, unlocked: true })),
        getLlmPrompt: getLlmPrompt as MLAdapter['getLlmPrompt'],
        createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion({ id: 's2', prompt_version: 1 })], skipped: 0, invalid: 0 }),
      },
    })
    expect(currentStep(wrapper).text()).toContain('Connect AI')

    await click(wrapper, 'Allow sending to openrouter.ai')
    await flushPromises()

    // The prompt is still loading: the old check doesn't count, so it stays on Try it.
    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(guide(wrapper).text()).not.toContain('Let the AI label the rest')

    release({ version: 1, template: DEFAULT_TEMPLATE, definitions: {} })
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    wrapper.unmount()
  })

  it('keeps one polite live region mounted from the start, and puts the count in it when Try it shows', async () => {
    const getLlmStatus = vi.fn().mockResolvedValueOnce(llmStatus({ acknowledged: false })).mockResolvedValue(llmStatus())
    const { wrapper } = await mounted({ ...shown, overrides: { getLlmStatus } })
    expect(liveRegions(wrapper)).toHaveLength(1)
    const region = liveRegions(wrapper)[0].element
    expect(region.textContent!.trim()).toBe('')

    await click(wrapper, 'Allow sending to openrouter.ai')
    await flushPromises()

    expect(liveRegions(wrapper)).toHaveLength(1)
    expect(liveRegions(wrapper)[0].element).toBe(region)
    expect(region.textContent!.trim()).toBe('30 more to check before it can label the rest.')
    wrapper.unmount()
  })

  it('holds the suggestion card’s rows invisibly while it asks, with the key hint kept in place', async () => {
    const createLlmSuggestions = vi.fn(() => new Promise(() => undefined))
    const { wrapper } = await mounted({ ...shown, overrides: { createLlmSuggestions: createLlmSuggestions as MLAdapter['createLlmSuggestions'] } })

    const held = guide(wrapper).find('.vmlb-guide-placeholder')
    expect(held.attributes('aria-hidden')).toBe('true')
    // The longest label stands in for the suggestion, so a long one never needs more room.
    expect(held.text()).toContain('Accept Criminal')
    expect(held.text()).toContain('Not right? Pick your label:')
    expect(held.findAll('button')).toHaveLength(0)
    expect(guide(wrapper).find('.vmlb-guide-keys').attributes('aria-hidden')).toBe('true')
    wrapper.unmount()
  })

  it('on a return visit, waits for the prompt before showing the check, so an older prompt’s check never shows', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    let release!: (value: unknown) => void
    const getLlmPrompt = vi.fn(() => new Promise((resolve) => { release = resolve }))
    const listLlmSuggestions = vi.fn().mockResolvedValue([])
    const { adapter, wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 20, Criminal: 22 },
      stats: { total: 80, annotated: 42, percentage: 52 },
      overrides: {
        // The check of prompt version 0, too low; the student saved version 1 last visit.
        getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ model: 'mistral-small', prompt_version: 0, checked: 30, agreed: 21, rate: 0.7 })),
        getLlmPrompt: getLlmPrompt as MLAdapter['getLlmPrompt'],
        listLlmSuggestions,
        createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion({ id: 's2', prompt_version: 1 })], skipped: 0, invalid: 0 }),
      },
    })

    expect(guide(wrapper).text()).not.toContain('Make your descriptions clearer')
    expect(guide(wrapper).find('.vmlb-guide-skeleton').exists()).toBe(true)

    release({ version: 1, template: DEFAULT_TEMPLATE, definitions: {} })
    await flushPromises()

    expect(stepHeading(wrapper).text()).toBe('Try the AI on a few items')
    expect(listLlmSuggestions.mock.calls.every(([, status]) => status === 'pending')).toBe(true)
    expect(adapter.createLlmSuggestions).toHaveBeenCalledWith('ds-1', ['t1'])
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    wrapper.unmount()
  })

  it("drops a suggestion it asked for once the item's own controls saved a label for it", async () => {
    const adapter = createTestAdapter({
      ...llmMethods({
        createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 }),
        pageAnnotationTasks: vi.fn(async (_p: string, filter: { label?: string }) => ({ tasks: [], total: filter.label ? 6 : 0 })),
      }),
    })
    const wrapper = mount(LabellingGuide, {
      props: {
        adapter, projectId: 'p1', datasetId: 'ds-1', labels: ['Civil', 'Criminal'], inUse: [],
        stats: { total: 40, annotated: 12, percentage: 30 }, statsLoading: false, labelsVersion: 0, currentTaskId: 't1',
      },
      attachTo: document.body,
    })
    await flushPromises()
    const emitted = () => wrapper.emitted('suggestions') as unknown[][]
    expect((emitted().at(-1)![0] as { id: string }[]).map((s) => s.id)).toEqual(['s1'])

    // Labelled in the item: the server no longer has it waiting.
    await wrapper.setProps({ labelsVersion: 1 })
    await flushPromises()

    expect(emitted().at(-1)![0]).toEqual([])
    wrapper.unmount()
  })
  it("keeps the suggestion to answer when saving the student's answer fails", async () => {
    const confirmLlmSuggestion = vi.fn().mockRejectedValueOnce(new Error('Server error')).mockResolvedValue({})
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    // The server still has it waiting: the save didn't reach it.
    const listLlmSuggestions = vi.fn().mockResolvedValue([llmSuggestion()])
    const { wrapper } = await mounted({
      ...shown,
      overrides: { confirmLlmSuggestion, listLlmSuggestions, createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 }) },
    })

    await click(wrapper, 'Accept Criminal')
    await flushPromises()

    expect(confirmLlmSuggestion).toHaveBeenCalledTimes(1)
    expect(guide(wrapper).text()).not.toContain('The AI has no suggestion for this item.')
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    wrapper.unmount()
  })

  it('drops the suggestion when the save failed on the way back but the server has it answered', async () => {
    const confirmLlmSuggestion = vi.fn().mockRejectedValueOnce(new Error('Network error'))
    const listLlmSuggestions = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([])
    const createLlmSuggestions = vi.fn()
      .mockResolvedValueOnce({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 })
      .mockResolvedValue({ suggestions: [], skipped: 1, invalid: 0 })
    const { wrapper } = await mounted({ ...shown, overrides: { confirmLlmSuggestion, listLlmSuggestions, createLlmSuggestions } })
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()

    await click(wrapper, 'Accept Criminal')
    await flushPromises()

    // Read again: the server no longer has it waiting, so no Accept that can only fail.
    expect(listLlmSuggestions.mock.calls.length).toBeGreaterThan(1)
    expect(button(wrapper, 'Accept Criminal')).toBeUndefined()
    wrapper.unmount()
  })

  it('asks again once the student\'s own key replaces a used-up allowance on the same model', async () => {
    const createLlmSuggestions = vi.fn()
      .mockRejectedValueOnce(refusal('The shared allowance is used up', 'budget_exhausted'))
      .mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 })
    // Then the student's own key, acknowledged already, on the same model.
    const getLlmStatus = vi.fn()
      .mockResolvedValueOnce(llmStatus())
      .mockResolvedValue(ownKey({ acknowledged: true, model: 'mistral-small' }))
    const { wrapper } = await mounted({ ...shown, overrides: { createLlmSuggestions, getLlmStatus } })
    expect(currentStep(wrapper).text()).toContain('Connect AI')

    await typeKey(wrapper, 'sk-own')
    await submitKey(wrapper)

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(createLlmSuggestions).toHaveBeenCalledTimes(2)
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    wrapper.unmount()
  })

  it('never tells the workspace of an older prompt version\'s suggestion while the prompt loads', async () => {
    const old = llmSuggestion({ id: 's-old', prompt_version: 0 })
    let release!: (value: unknown) => void
    const adapter = createTestAdapter({
      ...llmMethods({
        getLlmPrompt: vi.fn(() => new Promise((resolve) => { release = resolve })) as MLAdapter['getLlmPrompt'],
        listLlmSuggestions: vi.fn().mockResolvedValue([old]),
        createLlmSuggestions: vi.fn(() => new Promise(() => undefined)) as MLAdapter['createLlmSuggestions'],
        pageAnnotationTasks: vi.fn(async (_p: string, filter: { label?: string }) => ({ tasks: [], total: filter.label ? 6 : 0 })),
      }),
    })
    const wrapper = mount(LabellingGuide, {
      props: {
        adapter, projectId: 'p1', datasetId: 'ds-1', labels: ['Civil', 'Criminal'], inUse: [],
        stats: { total: 40, annotated: 12, percentage: 30 }, statsLoading: false, labelsVersion: 0, currentTaskId: 't1',
      },
      attachTo: document.body,
    })
    await flushPromises()
    release({ version: 1, template: DEFAULT_TEMPLATE, definitions: {} })
    await flushPromises()

    const emitted = (wrapper.emitted('suggestions') ?? []) as unknown[][]
    for (const [list] of emitted) expect((list as { id: string }[]).map((s) => s.id)).not.toContain('s-old')
    expect(wrapper.findAll('button').some((b) => b.text() === 'Accept Criminal')).toBe(false)
    wrapper.unmount()
  })

  it("tells the workspace only of suggestions from the prompt version in use, so a label picked on the item doesn't answer an older one", async () => {
    const old = llmSuggestion({ id: 's-old', prompt_version: 0 })
    const adapter = createTestAdapter({
      ...llmMethods({
        getLlmPrompt: vi.fn().mockResolvedValue({ version: 1, template: DEFAULT_TEMPLATE, definitions: {} }),
        listLlmSuggestions: vi.fn().mockResolvedValue([old]),
        createLlmSuggestions: vi.fn(() => new Promise(() => undefined)) as MLAdapter['createLlmSuggestions'],
        pageAnnotationTasks: vi.fn(async (_p: string, filter: { label?: string }) => ({ tasks: [], total: filter.label ? 6 : 0 })),
      }),
    })
    const wrapper = mount(LabellingGuide, {
      props: {
        adapter, projectId: 'p1', datasetId: 'ds-1', labels: ['Civil', 'Criminal'], inUse: [],
        stats: { total: 40, annotated: 12, percentage: 30 }, statsLoading: false, labelsVersion: 0, currentTaskId: 't1',
      },
      attachTo: document.body,
    })
    await flushPromises()

    // Asked again for version 1; the version 0 suggestion isn't the one in use.
    expect(adapter.createLlmSuggestions).toHaveBeenCalledTimes(1)
    const emitted = wrapper.emitted('suggestions') as unknown[][]
    expect(emitted.at(-1)![0]).toEqual([])
    wrapper.unmount()
  })

  it('asks again about the item once access is back, instead of keeping "The AI didn\'t answer"', async () => {
    const getLlmStatus = vi.fn()
      .mockResolvedValueOnce(llmStatus())
      .mockResolvedValueOnce(llmStatus({ acknowledged: false }))
      .mockResolvedValue(llmStatus())
    const createLlmSuggestions = vi.fn()
      .mockRejectedValueOnce(refusal('Allow sending first', 'acknowledgement_required'))
      .mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 })
    const { wrapper } = await mounted({ ...shown, overrides: { getLlmStatus, createLlmSuggestions } })
    expect(currentStep(wrapper).text()).toContain('Connect AI')

    await click(wrapper, 'Allow sending to openrouter.ai')
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(createLlmSuggestions).toHaveBeenCalledTimes(2)
    expect(alerts(wrapper)).not.toContain("The AI didn't answer. Label this one yourself, or try again.")
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    wrapper.unmount()
  })
})

describe('step 4, Try it: improving the descriptions', () => {
  const shown = { labels: ['Civil', 'Criminal'], counts: { Civil: 20, Criminal: 22 }, stats: { total: 80, annotated: 42, percentage: 52 } }
  const low = llmAgreement({ model: 'mistral-small', prompt_version: 0, checked: 30, agreed: 21, rate: 0.7 })
  const disagreed = { ...item, id: 't9', text: 'A fine is due for late filing.', status: 'annotated' as const, annotation_label: 'Civil' }

  async function improving(overrides: Partial<MLAdapter> = {}) {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    return mounted({
      ...shown,
      overrides: {
        getLlmAgreement: vi.fn().mockResolvedValue(low),
        getLlmPrompt: vi.fn().mockResolvedValue({ version: 0, template: DEFAULT_TEMPLATE, definitions: { Civil: 'Private disputes.', Criminal: 'Offences.' } }),
        listLlmSuggestions: vi.fn(async (_id: string, status?: string) =>
          status === undefined || status === 'corrected' ? [llmSuggestion({ id: 's9', task_id: 't9', label: 'Criminal', status: 'corrected' })] : [],
        ),
        listAnnotationTasks: vi.fn().mockResolvedValue([disagreed]),
        createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion({ id: 's2', prompt_version: 1 })], skipped: 0, invalid: 0 }),
        ...overrides,
      },
    })
  }

  it('becomes Make your descriptions clearer at the full sample under the threshold, listing the disagreements', async () => {
    const { adapter, wrapper } = await improving()

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(stepHeading(wrapper).text()).toBe('Make your descriptions clearer')
    expect(guide(wrapper).text()).toContain('The AI agreed with you on 21 of 30 (70%). It needs 80% before it can label the rest.')
    const rows = guide(wrapper).findAll('li').filter((li) => li.text().includes('A fine is due for late filing.'))
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('Your label: Civil')
    expect(rows[0].text()).toContain("The AI's label: Criminal")
    expect((wrapper.find('textarea[name="description-Civil"]').element as HTMLTextAreaElement).value).toBe('Private disputes.')
    const criminal = wrapper.find('textarea[name="description-Criminal"]').attributes('id')!
    expect(criminal).not.toMatch(/\s/)
    expect(wrapper.find(`label[for="${criminal}"]`).text()).toBe('What Criminal means')
    expect(guide(wrapper).text()).toContain('Saving starts the check again with your new descriptions.')
    // No suggestion is asked for while the descriptions are being improved.
    expect(adapter.createLlmSuggestions).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('lists every suggestion in the check whose label differs from yours, whatever its status', async () => {
    const t10 = { ...disagreed, id: 't10', text: 'The accused was remanded.', annotation_label: 'Criminal' }
    const t11 = { ...disagreed, id: 't11', text: 'Theft is punished by prison.', annotation_label: 'Criminal' }
    const listLlmSuggestions = vi.fn(async (_id: string, status?: string) =>
      status === 'pending' ? [] : [
        llmSuggestion({ id: 's9', task_id: 't9', label: 'Criminal', status: 'corrected' }),
        // Rejected, then labelled by the student: still counted against the AI.
        llmSuggestion({ id: 's10', task_id: 't10', label: 'Civil', status: 'rejected' }),
        llmSuggestion({ id: 's11', task_id: 't11', label: 'Criminal', status: 'accepted' }),
        llmSuggestion({ id: 's12', task_id: 't12', label: 'Civil', status: 'corrected', prompt_version: 3 }),
      ],
    )
    const { wrapper } = await improving({ listLlmSuggestions, listAnnotationTasks: vi.fn().mockResolvedValue([disagreed, t10, t11]) })

    expect(listLlmSuggestions).toHaveBeenCalledWith('ds-1')
    const rows = guide(wrapper).findAll('.vmlb-guide-disagreements li')
    expect(rows.map((r) => r.find('.vmlb-guide-disagreement-text').text())).toEqual(['A fine is due for late filing.', 'The accused was remanded.'])
    expect(rows[1].text()).toContain('Your label: Criminal')
    expect(rows[1].text()).toContain("The AI's label: Civil")
    wrapper.unmount()
  })

  it('saves the descriptions as a new prompt version and returns to Try it, with the check from zero', async () => {
    const updateLlmPrompt = vi.fn(async (_id: string, edit: { template: string; definitions: Record<string, string> }) => ({ version: 1, ...edit }))
    const { adapter, wrapper } = await improving({ updateLlmPrompt })

    await wrapper.find('textarea[name="description-Civil"]').setValue('Disputes between private parties, such as contracts.')
    await click(wrapper, 'Save descriptions')
    await flushPromises()

    expect(updateLlmPrompt).toHaveBeenCalledWith('ds-1', {
      template: DEFAULT_TEMPLATE,
      definitions: { Civil: 'Disputes between private parties, such as contracts.', Criminal: 'Offences.' },
    })
    expect(stepHeading(wrapper).text()).toBe('Try the AI on a few items')
    expect(document.activeElement).toBe(stepHeading(wrapper).element)
    expect(guide(wrapper).find('[aria-live="polite"]').text()).toBe('30 more to check before it can label the rest.')
    expect(adapter.createLlmSuggestions).toHaveBeenCalledWith('ds-1', ['t1'])
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    wrapper.unmount()
  })

  it('returns to Connect AI with the reason when saving the descriptions is refused for the key', async () => {
    const updateLlmPrompt = vi.fn().mockRejectedValue(refusal('The LLM service rejected the API key.', 'llm_failed'))
    const { wrapper } = await improving({ updateLlmPrompt })

    await click(wrapper, 'Save descriptions')
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(alerts(wrapper).join(' ')).toContain('The AI key stopped working: The LLM service rejected the API key.')
    wrapper.unmount()
  })

  it('shows Saving… while it saves, and the reason when the server refuses', async () => {
    let refuse: (err: Error) => void = () => undefined
    const updateLlmPrompt = vi.fn(() => new Promise<never>((_resolve, reject) => { refuse = reject }))
    const { wrapper } = await improving({ updateLlmPrompt: updateLlmPrompt as MLAdapter['updateLlmPrompt'] })

    await button(wrapper, 'Save descriptions')!.trigger('click')
    await flushPromises()
    expect(button(wrapper, 'Saving…')).toBeDefined()

    refuse(refusal('Definitions must only explain how to choose a label.', 'prompt_rejected'))
    await flushPromises()
    expect(alerts(wrapper)).toContain('Definitions must only explain how to choose a label.')
    expect(stepHeading(wrapper).text()).toBe('Make your descriptions clearer')
    wrapper.unmount()
  })

  it('keeps going one item at a time without ever unlocking bulk accept', async () => {
    const { adapter, wrapper } = await improving()

    await click(wrapper, 'Keep going one item at a time')

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(stepHeading(wrapper).text()).toBe('Try the AI on a few items')
    expect(button(wrapper, 'Accept Criminal')).toBeDefined()
    expect(guide(wrapper).find('[aria-live="polite"]').text()).toBe(
      'The AI agreed with you on 21 of 30. It needs to agree at least 80% of the time before it can label the rest.',
    )
    expect(wrapper.text()).not.toContain('Accept all waiting suggestions')
    expect(adapter.bulkAcceptLlmSuggestions).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})

describe('phones: the folded Try it', () => {
  it('reads Step 4 of 6 · Agreed X of Y, with the suggestion outside the folded part', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const { wrapper } = await mounted({
      labels: ['Civil', 'Criminal'],
      counts: { Civil: 10, Criminal: 10 },
      stats: { total: 60, annotated: 20, percentage: 33 },
      overrides: {
        getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ checked: 20, agreed: 17, rate: 0.85 })),
        createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 }),
      },
    })

    const details = button(wrapper, 'Details')!
    expect(details.element.parentElement!.textContent).toContain('Step 4 of 6 · Agreed 17 of 20')
    const body = wrapper.find(`#${details.attributes('aria-controls')}`)
    expect(body.text()).toContain('Try the AI on a few items')
    const accept = button(wrapper, 'Accept Criminal')!
    expect(body.element.contains(accept.element)).toBe(false)
    wrapper.unmount()
  })
})

describe('Try it follow-ups (BAIGLE #211)', () => {
  const shown = { labels: ['Civil', 'Criminal'], counts: { Civil: 6, Criminal: 6 }, stats: { total: 40, annotated: 12, percentage: 30 } }
  const second = { ...item, id: 't2', item_index: 1, text: 'Clause two.' }
  const kitText = (wrapper: Wrapper) => wrapper.findComponent(AnnotatorView).props('document').full_text

  async function labelOnItem(wrapper: Wrapper, name: string) {
    const tag = wrapper.findAll('.doc-tag').find((t) => t.text().startsWith(name))
    if (!tag) throw new Error(`no tag "${name}"`)
    await tag.trigger('click')
    await wrapper.find('.btn--save').trigger('click')
    await flushPromises()
  }

  it('reads again what waits when a label picked on the item over the suggestion fails to save', async () => {
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const confirmLlmSuggestion = vi.fn().mockRejectedValue(new Error('Server error'))
    // The server still has it waiting: the save didn't reach it.
    const listLlmSuggestions = vi.fn().mockResolvedValue([llmSuggestion()])
    const { wrapper } = await mounted({
      ...shown,
      overrides: { confirmLlmSuggestion, listLlmSuggestions, createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 }) },
    })
    const reads = listLlmSuggestions.mock.calls.length

    await labelOnItem(wrapper, 'Civil')

    expect(confirmLlmSuggestion).toHaveBeenCalledWith('s1', 'Civil')
    expect(listLlmSuggestions.mock.calls.length).toBeGreaterThan(reads)
    expect(kitText(wrapper)).toBe('Clause one.')
    wrapper.unmount()
  })

  it('loads the next item when an Accept reached the server but its reply was lost', async () => {
    const confirmLlmSuggestion = vi.fn().mockRejectedValue(new Error('Network error'))
    const getNextAnnotationTask = vi.fn()
      .mockResolvedValueOnce({ task: item, stats: shown.stats })
      .mockResolvedValue({ task: second, stats: { total: 40, annotated: 13, percentage: 33 } })
    const createLlmSuggestions = vi.fn()
      .mockResolvedValueOnce({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 })
      .mockResolvedValue({ suggestions: [llmSuggestion({ id: 's2', task_id: 't2', label: 'Civil' })], skipped: 0, invalid: 0 })
    const { wrapper } = await mounted({ ...shown, overrides: { confirmLlmSuggestion, getNextAnnotationTask, createLlmSuggestions } })
    expect(kitText(wrapper)).toBe('Clause one.')

    await click(wrapper, 'Accept Criminal')
    await flushPromises()

    // Read again, the server no longer has it waiting: the item is answered.
    expect(kitText(wrapper)).toBe('Clause two.')
    expect(guide(wrapper).text()).not.toContain('The AI has no suggestion for this item.')
    expect(button(wrapper, 'Accept Civil')).toBeDefined()
    wrapper.unmount()
  })

  it('loads the next item when a label picked on the item reached the server but its reply was lost', async () => {
    const confirmLlmSuggestion = vi.fn().mockRejectedValue(new Error('Network error'))
    const getNextAnnotationTask = vi.fn()
      .mockResolvedValueOnce({ task: item, stats: shown.stats })
      .mockResolvedValue({ task: second, stats: { total: 40, annotated: 13, percentage: 33 } })
    const { wrapper } = await mounted({
      ...shown,
      overrides: { confirmLlmSuggestion, getNextAnnotationTask, createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [llmSuggestion()], skipped: 0, invalid: 0 }) },
    })

    await labelOnItem(wrapper, 'Civil')
    await flushPromises()

    expect(kitText(wrapper)).toBe('Clause two.')
    wrapper.unmount()
  })

  it("never shows an older prompt version's waiting suggestion when the prompt fails to load", async () => {
    // A Dataset with suggestions opens with the guide hidden unless told otherwise.
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const old = llmSuggestion({ id: 's-old', prompt_version: 0 })
    const { wrapper } = await mounted({
      ...shown,
      overrides: {
        getLlmPrompt: vi.fn().mockRejectedValue(new Error('Server error')),
        listLlmSuggestions: vi.fn().mockResolvedValue([old]),
        createLlmSuggestions: vi.fn(() => new Promise(() => undefined)) as MLAdapter['createLlmSuggestions'],
      },
    })

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(button(wrapper, 'Accept Criminal')).toBeUndefined()
    const guideView = wrapper.findComponent(LabellingGuide)
    for (const [list] of (guideView.emitted('suggestions') ?? []) as unknown[][]) {
      expect((list as { id: string }[]).map((s) => s.id)).not.toContain('s-old')
    }
    wrapper.unmount()
  })

  it('still shows the suggestion it asks for when the prompt fails to load', async () => {
    // A Dataset with suggestions opens with the guide hidden unless told otherwise.
    localStorage.setItem('vmlb-guide-hidden:ds-1', '0')
    const old = llmSuggestion({ id: 's-old', prompt_version: 0 })
    const fresh = llmSuggestion({ id: 's-new', prompt_version: 3, label: 'Civil', created_at: '2026-11-06T10:00:00' })
    const { adapter, wrapper } = await mounted({
      ...shown,
      overrides: {
        getLlmPrompt: vi.fn().mockRejectedValue(new Error('Server error')),
        listLlmSuggestions: vi.fn().mockResolvedValue([old]),
        createLlmSuggestions: vi.fn().mockResolvedValue({ suggestions: [fresh], skipped: 0, invalid: 0 }),
      },
    })

    expect(adapter.createLlmSuggestions).toHaveBeenCalledTimes(1)
    expect(button(wrapper, 'Accept Civil')).toBeDefined()
    const emitted = (wrapper.findComponent(LabellingGuide).emitted('suggestions') ?? []) as unknown[][]
    expect((emitted.at(-1)![0] as { id: string }[]).map((s) => s.id)).toEqual(['s-new'])
    wrapper.unmount()
  })

  it("asks no more when the student's own key on another model replaces a used-up allowance and that model's suggestion waits", async () => {
    let ownKeySaved = false
    const waitingFromOwn = llmSuggestion({ id: 's-gpt', model: 'gpt-x', label: 'Civil' })
    const createLlmSuggestions = vi.fn()
      .mockRejectedValueOnce(refusal('The shared allowance is used up', 'budget_exhausted'))
      // Already asked with this model: the server skips the item.
      .mockResolvedValue({ suggestions: [], skipped: 1, invalid: 0 })
    const { wrapper } = await mounted({
      ...shown,
      overrides: {
        createLlmSuggestions,
        saveLlmKey: vi.fn(async () => {
          ownKeySaved = true
          return { base_url: 'https://api.example.com/v1', model: 'gpt-x' }
        }),
        getLlmStatus: vi.fn(async () => (ownKeySaved ? ownKey({ acknowledged: true, model: 'gpt-x' }) : llmStatus())),
        listLlmSuggestions: vi.fn(async () => (ownKeySaved ? [waitingFromOwn] : [])),
      },
    })
    expect(currentStep(wrapper).text()).toContain('Connect AI')

    await typeKey(wrapper, 'sk-own')
    await submitKey(wrapper)

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(button(wrapper, 'Accept Civil')).toBeDefined()
    expect(createLlmSuggestions).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('folds the phone Details again on entering Try it', async () => {
    const counts = { Civil: 6, Criminal: 3 }
    const { wrapper } = await mounted({ labels: ['Civil', 'Criminal'], counts, stats: { total: 40, annotated: 9, percentage: 23 } })
    expect(currentStep(wrapper).text()).toContain('Show it how')
    await button(wrapper, 'Details')!.trigger('click')
    expect(button(wrapper, 'Details')!.attributes('aria-expanded')).toBe('true')

    // The tenth example: the guide moves on to Try it.
    counts.Criminal = 4
    await labelOnItem(wrapper, 'Criminal')
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Try it')
    expect(button(wrapper, 'Details')!.attributes('aria-expanded')).toBe('false')
    wrapper.unmount()
  })
})
