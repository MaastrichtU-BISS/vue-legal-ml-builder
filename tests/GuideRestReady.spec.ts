import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import AnnotationWorkspace from '../src/components/AnnotationWorkspace.vue'
import type { AnnotationStats, AnnotationTask, LlmEstimate, LlmJob, LlmSuggestion, MLAdapter } from '../src/types'
import { createTestAdapter } from './testAdapter'
import { llmAgreement, llmMethods, llmStatus, llmSuggestion, refusal } from './fixtures/llm'

// Steps 5 and 6 of the guide, "Do the rest" and "Ready to train" (BAIGLE #196),
// inside AnnotationWorkspace, driven by what the fake adapter reports.

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  document.body.innerHTML = ''
})

const item = { id: 't1', dataset_id: 'ds-1', item_index: 0, text: 'Clause one.', status: 'pending' as const, created_at: '', updated_at: '' }
const pendingTask = (i: number): AnnotationTask => ({ ...item, id: `p${i}`, item_index: i, text: `Clause ${i}.` })

/** The check passed for the model and prompt in use. */
const passed = llmAgreement({ model: 'mistral-small', prompt_version: 0, checked: 30, agreed: 27, rate: 0.9, unlocked: true })
const estimate = (overrides: Partial<LlmEstimate> = {}): LlmEstimate => ({
  tasks: 28, estimated_tokens: 42000, remaining_tokens: 158000, within_budget: true, destination: 'openrouter.ai', ...overrides,
})
const aiLabel = (i: number) => llmSuggestion({ id: `s${i}`, task_id: `p${i}`, label: i % 2 ? 'Civil' : 'Criminal' })
const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `p${from + i}`)

/** The server's suggestion list: every status, or only the one asked for. */
const suggestionList = (all: () => LlmSuggestion[]) =>
  vi.fn(async (_datasetId: string, status?: string) => (status ? all().filter((s) => s.status === status) : all()))

interface Setup {
  counts?: Record<string, number>
  stats?: AnnotationStats
  overrides?: Partial<MLAdapter>
  props?: Record<string, unknown>
}

/** Enough shown and the check passed, with 28 items still to label: the guide is on Do the rest. */
async function mounted({
  counts = { Civil: 6, Criminal: 6 },
  stats = { total: 40, annotated: 12, percentage: 30 },
  overrides = {},
  props = {},
}: Setup = {}) {
  const adapter = createTestAdapter({
    getNextAnnotationTask: vi.fn().mockResolvedValue({ task: item, stats }),
    getDataset: vi.fn().mockResolvedValue({ id: 'ds-1', labels: ['Civil', 'Criminal'] }),
    pageAnnotationTasks: vi.fn(async (_projectId: string, filter: { label?: string }) =>
      filter.label !== undefined ? { tasks: [], total: counts[filter.label] ?? 0 } : { tasks: [], total: 0 },
    ),
    listAnnotationTasks: vi.fn().mockResolvedValue(Array.from({ length: 28 }, (_, i) => pendingTask(i))),
    ...llmMethods({ getLlmAgreement: vi.fn().mockResolvedValue(passed) }),
    ...overrides,
  })
  const wrapper = mount(AnnotationWorkspace, {
    props: { adapter, projectId: 'p1', datasetId: 'ds-1', guide: 'shown', ...props },
    attachTo: document.body,
    global: { provide: { 'vmlb:pollInterval': 5 } },
  })
  await flushPromises()
  return { adapter, wrapper }
}

type Wrapper = Awaited<ReturnType<typeof mounted>>['wrapper']

const guide = (wrapper: Wrapper) => wrapper.find('section[aria-labelledby="vmlb-guide-title"]')
const currentStep = (wrapper: Wrapper) => wrapper.find('nav li[aria-current="step"]')
const stepHeading = (wrapper: Wrapper) => guide(wrapper).find('h3')
const liveRegion = (wrapper: Wrapper) => guide(wrapper).find('[aria-live="polite"]')
const alerts = (wrapper: Wrapper) => wrapper.findAll('[role="alert"]').map((a) => a.text())
const button = (wrapper: Wrapper, text: string) => wrapper.findAll('button').find((b) => b.text() === text)

async function click(wrapper: Wrapper, text: string) {
  const found = button(wrapper, text)
  if (!found) throw new Error(`no button "${text}"`)
  await found.trigger('click')
  await flushPromises()
}

/** Lets the job's polling run a few times. */
async function poll() {
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await flushPromises()
  }
}

describe('step 5, Do the rest: the estimate', () => {
  it('defaults to every item still to label, with only the next N items as an option', async () => {
    const { wrapper } = await mounted()

    expect(currentStep(wrapper).text()).toContain('Do the rest')
    const every = wrapper.find('input[type="radio"][value="all"]')
    const next = wrapper.find('input[type="radio"][value="next"]')
    expect((every.element as HTMLInputElement).checked).toBe(true)
    expect(every.element.closest('label')!.textContent).toContain('Every item still to label (28)')
    expect((next.element as HTMLInputElement).checked).toBe(false)
    expect(next.element.closest('label')!.textContent).toContain('Only the next N items')
    // Not today's panel: the step has its own controls.
    expect(guide(wrapper).find('section[aria-label="LLM suggestions"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('shows "Working out the cost…" on the button, then reads the estimate in tokens and what is left this month', async () => {
    let answer: (value: LlmEstimate) => void = () => undefined
    const estimateLlmAnnotation = vi.fn(() => new Promise<LlmEstimate>((resolve) => { answer = resolve }))
    const { adapter, wrapper } = await mounted({ overrides: { estimateLlmAnnotation } })

    await click(wrapper, 'Work out the cost')
    const busy = button(wrapper, 'Working out the cost…')
    expect(busy).toBeDefined()
    expect(busy!.attributes('disabled')).toBeDefined()

    answer(estimate())
    await flushPromises()

    // Every item the AI can label, named, so the server counts only those.
    expect(adapter.estimateLlmAnnotation).toHaveBeenCalledWith('ds-1', ids(0, 28))
    expect(guide(wrapper).text()).toContain('About 42,000 tokens. You have 158,000 left this month.')
    expect(guide(wrapper).text()).not.toContain('provider charges')
    expect(button(wrapper, 'Start labelling 28 items')).toBeDefined()
    expect(adapter.startLlmAnnotation).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('moves focus to Start once the estimate replaces the button pressed', async () => {
    const { wrapper } = await mounted({ overrides: { estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate()) } })

    const work = button(wrapper, 'Work out the cost')!
    ;(work.element as HTMLButtonElement).focus()
    await click(wrapper, 'Work out the cost')

    expect(document.activeElement).toBe(button(wrapper, 'Start labelling 28 items')!.element)
    wrapper.unmount()
  })

  it('estimates only the next N items in queue order when chosen', async () => {
    const { adapter, wrapper } = await mounted({ overrides: { estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate({ tasks: 5 })) } })

    await wrapper.find('input[type="radio"][value="next"]').setValue(true)
    await wrapper.find('input[type="number"]').setValue(5)
    await click(wrapper, 'Work out the cost')

    expect(adapter.listAnnotationTasks).toHaveBeenCalledWith('p1', { status: 'pending', datasetId: 'ds-1' })
    expect(adapter.estimateLlmAnnotation).toHaveBeenCalledWith('ds-1', ['p0', 'p1', 'p2', 'p3', 'p4'])
    expect(button(wrapper, 'Start labelling 5 items')).toBeDefined()
    wrapper.unmount()
  })

  it('notes that the provider charges when the student uses their own key', async () => {
    const own = llmStatus({ mode: 'byok', remaining_tokens: null, key: { base_url: 'https://openrouter.ai/api/v1', model: 'mistral-small' } })
    const { wrapper } = await mounted({
      overrides: {
        getLlmStatus: vi.fn().mockResolvedValue(own),
        estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate({ remaining_tokens: null })),
      },
    })

    await click(wrapper, 'Work out the cost')

    expect(guide(wrapper).text()).toContain('About 42,000 tokens.')
    expect(guide(wrapper).text()).not.toContain('left this month')
    expect(guide(wrapper).text()).toContain('This uses your own key, so your AI provider charges you for these tokens.')
    wrapper.unmount()
  })

  it('does not start a job larger than what is left this month', async () => {
    const { wrapper } = await mounted({ overrides: { estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate({ within_budget: false, remaining_tokens: 1000 })) } })

    await click(wrapper, 'Work out the cost')

    expect(alerts(wrapper)).toContain("That's more than you have left this month. Choose fewer items, or add your own key.")
    expect(button(wrapper, 'Start labelling 28 items')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('step 5, Do the rest: the running job', () => {
  it('starts the job on the items estimated and shows its progress in the polite live region', async () => {
    const running: LlmJob = { status: 'running', total: 28, done: 12, created: 12 }
    const { adapter, wrapper } = await mounted({
      overrides: {
        estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate()),
        startLlmAnnotation: vi.fn().mockResolvedValue({ job_id: 'job-1', estimate: estimate() }),
        getLlmJob: vi.fn().mockResolvedValue(running),
      },
    })

    await click(wrapper, 'Work out the cost')
    await click(wrapper, 'Start labelling 28 items')
    await poll()

    expect(adapter.startLlmAnnotation).toHaveBeenCalledWith('ds-1', ids(0, 28))
    expect(adapter.getLlmJob).toHaveBeenCalledWith('job-1')
    expect(guide(wrapper).text()).toContain('12 of 28 items done')
    expect(guide(wrapper).find('[role="progressbar"]').attributes('aria-valuenow')).toBe('12')
    expect(liveRegion(wrapper).text()).toBe('Labelling: 12 of 28 done.')
    // One live region for the whole guide.
    expect(guide(wrapper).findAll('[aria-live="polite"]')).toHaveLength(1)
    expect(guide(wrapper).text()).toContain('You can leave this page.')
    wrapper.unmount()
  })

  it('picks a job left running up again from the server when the student comes back', async () => {
    const getLlmJob = vi.fn().mockResolvedValue({ status: 'running', total: 28, done: 20, created: 20 })
    const { adapter, wrapper } = await mounted({ overrides: { getLlmJob } })
    expect(guide(wrapper).text()).not.toContain('items done')
    wrapper.unmount()

    // The first visit started it; only its id was kept in the browser.
    localStorage.setItem('vmlb-guide-job:ds-1', 'job-1')
    const again = await mounted({ overrides: { getLlmJob } })

    expect(getLlmJob).toHaveBeenCalledWith('job-1')
    expect(guide(again.wrapper).text()).toContain('20 of 28 items done')
    expect(liveRegion(again.wrapper).text()).toBe('Labelling: 20 of 28 done.')
    expect(adapter.startLlmAnnotation).not.toHaveBeenCalled()
    again.wrapper.unmount()
  })

  it('forgets a job the server no longer knows', async () => {
    localStorage.setItem('vmlb-guide-job:ds-1', 'job-gone')
    const getLlmJob = vi.fn().mockRejectedValue(refusal('Job not found', undefined, { status: 404 }))
    const { wrapper } = await mounted({ overrides: { getLlmJob } })

    expect(button(wrapper, 'Work out the cost')).toBeDefined()
    wrapper.unmount()
    // Not asked about again on the next visit.
    getLlmJob.mockClear()
    const again = await mounted({ overrides: { getLlmJob } })
    expect(getLlmJob).not.toHaveBeenCalled()
    again.wrapper.unmount()
  })

  it('keeps following a job when reading it failed on the network, not because the server lost it', async () => {
    localStorage.setItem('vmlb-guide-job:ds-1', 'job-1')
    const getLlmJob = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ status: 'running', total: 28, done: 20, created: 20 })
    const { wrapper } = await mounted({ overrides: { getLlmJob } })
    await poll()

    expect(guide(wrapper).text()).toContain('20 of 28 items done')
    wrapper.unmount()
  })

  it('announces the start, then only each quarter passed, while the bar has the exact count', async () => {
    let job: LlmJob = { status: 'running', total: 28, done: 1, created: 1 }
    const { wrapper } = await mounted({
      overrides: {
        estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate()),
        startLlmAnnotation: vi.fn().mockResolvedValue({ job_id: 'job-1', estimate: estimate() }),
        getLlmJob: vi.fn(async () => job),
      },
    })

    await click(wrapper, 'Work out the cost')
    await click(wrapper, 'Start labelling 28 items')
    await poll()
    expect(liveRegion(wrapper).text()).toBe('Labelling: 1 of 28 done.')

    job = { ...job, done: 5, created: 5 }
    await poll()
    expect(guide(wrapper).find('[role="progressbar"]').attributes('aria-valuenow')).toBe('5')
    expect(liveRegion(wrapper).text()).toBe('Labelling: 1 of 28 done.')

    job = { ...job, done: 7, created: 7 }
    await poll()
    expect(liveRegion(wrapper).text()).toBe('Labelling: 7 of 28 done.')

    job = { status: 'completed', total: 28, done: 28, created: 28 }
    await poll()
    expect(liveRegion(wrapper).text()).not.toContain('Labelling:')
    wrapper.unmount()
  })
})

describe('step 5, Do the rest: a failed job', () => {
  it('says how many were kept and carries on with a new estimate for the items still without an AI label', async () => {
    localStorage.setItem('vmlb-guide-job:ds-1', 'job-1')
    // Before it stopped, the job worked through 10 items: 8 AI labels made, 2 answers that weren't a label.
    const made = Array.from({ length: 8 }, (_, i) => aiLabel(i))
    const getLlmJob = vi.fn().mockResolvedValue({ status: 'failed', total: 28, done: 10, created: 8, invalid: 2, error: 'The LLM service returned an error.' })
    const { adapter, wrapper } = await mounted({
      overrides: {
        getLlmJob,
        listLlmSuggestions: suggestionList(() => made),
        estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate({ tasks: 20 })),
      },
    })

    expect(alerts(wrapper)).toContain('Labelling stopped after 10 of 28. Those 8 are kept.')
    // Not a key failure: the guide stays on Do the rest.
    expect(currentStep(wrapper).text()).toContain('Do the rest')

    await click(wrapper, 'Carry on')

    // The 8 waiting are left out. The 2 answers that weren't a label left nothing behind, so those are asked again.
    expect(adapter.estimateLlmAnnotation).toHaveBeenLastCalledWith('ds-1', ids(8, 28))
    expect(alerts(wrapper)).not.toContain('Labelling stopped after 10 of 28. Those 8 are kept.')
    expect(guide(wrapper).text()).toContain('8 AI labels are already waiting. They are kept, and you accept them with the rest.')
    expect(button(wrapper, 'Start labelling 20 items')).toBeDefined()
    expect(button(wrapper, 'Accept 8 AI labels')).toBeUndefined()
    wrapper.unmount()

    // The stopped job isn't picked up again on the next visit.
    getLlmJob.mockClear()
    const again = await mounted({ overrides: { getLlmJob, listLlmSuggestions: suggestionList(() => made) } })
    expect(getLlmJob).not.toHaveBeenCalled()
    again.wrapper.unmount()
  })
})

describe('step 5, Do the rest: when the AI has finished', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => aiLabel(i))

  it("arriving from Try it with its suggestion for the item on screen, still chooses the items and sees the cost first", async () => {
    const leftover = llmSuggestion({ id: 'left', task_id: item.id, label: 'Civil' })
    const { wrapper } = await mounted({
      overrides: {
        listLlmSuggestions: vi.fn().mockResolvedValue([leftover]),
        listAnnotationTasks: vi.fn().mockResolvedValue([item, ...Array.from({ length: 27 }, (_, i) => pendingTask(i + 1))]),
      },
    })

    expect(guide(wrapper).text()).toContain('1 AI label is already waiting. It is kept, and you accept it with the rest.')
    expect(button(wrapper, 'Work out the cost')).toBeDefined()
    expect(button(wrapper, 'Accept 1 AI label')).toBeUndefined()
    wrapper.unmount()
  })

  it('when the item on screen is the only one left, offers its AI label to accept instead of another estimate', async () => {
    const leftover = llmSuggestion({ id: 'left', task_id: item.id, label: 'Civil' })
    const { wrapper } = await mounted({
      counts: { Civil: 1, Criminal: 12 },
      stats: { total: 14, annotated: 13, percentage: 93 },
      overrides: { listLlmSuggestions: vi.fn().mockResolvedValue([leftover]), listAnnotationTasks: vi.fn().mockResolvedValue([item]) },
    })

    expect(currentStep(wrapper).text()).toContain('Do the rest')
    expect(button(wrapper, 'Accept 1 AI label')).toBeDefined()
    expect(button(wrapper, 'Work out the cost')).toBeUndefined()
    wrapper.unmount()
  })

  it('says plainly what is left for the student when the AI already answered on every item left', async () => {
    // Rejected in "Check 10 at random": the server won't ask the AI about these again.
    // Civil is still one short of the two Ready to train needs, and only one item is left.
    const rejected = [llmSuggestion({ id: 'r0', task_id: 'p0', status: 'rejected' })]
    const { adapter, wrapper } = await mounted({
      counts: { Civil: 1, Criminal: 11 },
      stats: { total: 13, annotated: 12, percentage: 92 },
      overrides: { listLlmSuggestions: suggestionList(() => rejected), listAnnotationTasks: vi.fn().mockResolvedValue([pendingTask(0)]) },
    })

    expect(currentStep(wrapper).text()).toContain('Do the rest')
    expect(guide(wrapper).text()).toContain('1 item is left for you to label.')
    expect(guide(wrapper).text()).toContain('Label it yourself in the item below.')
    expect(button(wrapper, 'Work out the cost')).toBeUndefined()
    expect(adapter.estimateLlmAnnotation).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('accepts the AI labels only on the explicit button', async () => {
    const bulkAcceptLlmSuggestions = vi.fn().mockResolvedValue({ accepted: 12, agreement: passed })
    const { adapter, wrapper } = await mounted({
      overrides: { listLlmSuggestions: vi.fn().mockResolvedValue(twelve), bulkAcceptLlmSuggestions },
    })

    expect(guide(wrapper).text()).toContain('The AI labelled 12 items.')
    expect(adapter.bulkAcceptLlmSuggestions).not.toHaveBeenCalled()
    expect(adapter.confirmLlmSuggestion).not.toHaveBeenCalled()

    await click(wrapper, 'Accept 12 AI labels')

    expect(bulkAcceptLlmSuggestions).toHaveBeenCalledWith('ds-1')
    expect(liveRegion(wrapper).text()).toBe('12 AI labels accepted.')
    wrapper.unmount()
  })

  it('announces how many the server accepted', async () => {
    const bulkAcceptLlmSuggestions = vi.fn().mockResolvedValue({ accepted: 11, agreement: passed })
    const { wrapper } = await mounted({ overrides: { listLlmSuggestions: vi.fn().mockResolvedValue(twelve), bulkAcceptLlmSuggestions } })

    await click(wrapper, 'Accept 12 AI labels')

    expect(liveRegion(wrapper).text()).toBe('11 AI labels accepted.')
    wrapper.unmount()
  })

  it('lets the AI label more first, estimating only the items without its label', async () => {
    const { adapter, wrapper } = await mounted({
      overrides: { listLlmSuggestions: vi.fn().mockResolvedValue(twelve), estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate({ tasks: 16 })) },
    })

    await click(wrapper, 'Let the AI label more first')
    expect(wrapper.find('input[type="radio"][value="all"]').element.closest('label')!.textContent).toContain('Every item still to label (16)')
    await click(wrapper, 'Work out the cost')

    expect(adapter.estimateLlmAnnotation).toHaveBeenLastCalledWith('ds-1', ids(12, 28))
    expect(button(wrapper, 'Start labelling 16 items')).toBeDefined()
    expect(button(wrapper, 'Accept 12 AI labels')).toBeUndefined()

    // The next 5 are the next 5 it hasn't labelled, not the 5 it already did.
    await wrapper.find('input[type="radio"][value="next"]').setValue(true)
    await wrapper.find('input[type="number"]').setValue(5)
    await click(wrapper, 'Work out the cost')
    expect(adapter.estimateLlmAnnotation).toHaveBeenLastCalledWith('ds-1', ids(12, 17))
    wrapper.unmount()
  })

  it('counts only the AI labels from the model and prompt the passed check is for', async () => {
    const older = llmSuggestion({ id: 'old', task_id: 'p99', prompt_version: -1 })
    const otherModel = llmSuggestion({ id: 'other', task_id: 'p98', model: 'gpt-x' })
    // Its item was labelled outside the guide: the server accepts only labels for items still to label.
    const labelledElsewhere = llmSuggestion({ id: 'gone', task_id: 'done-1' })
    const { wrapper } = await mounted({ overrides: { listLlmSuggestions: vi.fn().mockResolvedValue([...twelve, older, otherModel, labelledElsewhere]) } })

    expect(button(wrapper, 'Accept 12 AI labels')).toBeDefined()
    wrapper.unmount()
  })

  it('says which reason when accepting is refused, and accepts nothing', async () => {
    const bulkAcceptLlmSuggestions = vi.fn().mockRejectedValue(refusal('Bulk accept needs 30 checked items at 80% agreement.', 'agreement_not_met'))
    const { wrapper } = await mounted({ overrides: { listLlmSuggestions: vi.fn().mockResolvedValue(twelve), bulkAcceptLlmSuggestions } })

    await click(wrapper, 'Accept 12 AI labels')

    expect(alerts(wrapper)).toContain('Bulk accept needs 30 checked items at 80% agreement.')
    wrapper.unmount()
  })

  it('offers Ready to train once every label has two confirmed, while the AI could still label more', async () => {
    const { wrapper } = await mounted({ props: { createModelHref: '/models/create?project=p1' } })

    expect(currentStep(wrapper).text()).toContain('Do the rest')
    await click(wrapper, 'Go to Ready to train')

    expect(currentStep(wrapper).text()).toContain('Ready to train')
    expect(guide(wrapper).text()).toContain('28 items are still unlabelled. You can train now, or label them later.')
    expect(guide(wrapper).find('a[href="/models/create?project=p1"]').text()).toBe('Create model')
    wrapper.unmount()
  })

  it('does not offer Ready to train while a label has fewer than two confirmed', async () => {
    const { wrapper } = await mounted({ counts: { Civil: 1, Criminal: 11 } })

    expect(button(wrapper, 'Go to Ready to train')).toBeUndefined()
    wrapper.unmount()
  })

  it('opens the review screen on 10 of the AI labels picked at random, where each must be accepted', async () => {
    const { adapter, wrapper } = await mounted({ overrides: { listLlmSuggestions: vi.fn().mockResolvedValue(twelve) } })

    await click(wrapper, 'Check 10 at random first')

    const review = wrapper.find('section[aria-label="Check the AI\'s labels"]')
    expect(review.exists()).toBe(true)
    expect(review.find('h2').text()).toBe("Check 10 of the AI's labels")
    expect(document.activeElement).toBe(review.find('h2').element)
    expect(review.text()).toContain("The AI's label, not accepted yet")
    // The first item opened is one of the twelve.
    const opened = vi.mocked(adapter.getAnnotationAssignment).mock.calls.map(([id]) => id)
    expect(twelve.map((s) => s.task_id)).toContain(opened[opened.length - 1])
    expect(adapter.confirmLlmSuggestion).not.toHaveBeenCalled()
    // The notice's live region is there before anything is put in it, so what it says is announced.
    const status = review.find('[role="status"]')
    expect(status.exists()).toBe(true)
    expect(status.text()).toBe('')

    const accept = review.findAll('button').find((b) => b.text() === 'Accept')
    await accept!.trigger('click')
    await flushPromises()
    expect(review.find('[role="status"]').element).toBe(status.element)
    expect(status.text()).not.toBe('')

    expect(adapter.confirmLlmSuggestion).toHaveBeenCalledTimes(1)
    const [confirmedId] = vi.mocked(adapter.confirmLlmSuggestion!).mock.calls[0]
    expect(twelve.map((s) => s.id)).toContain(confirmedId)
    expect(adapter.bulkAcceptLlmSuggestions).not.toHaveBeenCalled()

    await click(wrapper, 'Back to the guide')
    expect(wrapper.find('section[aria-label="Check the AI\'s labels"]').exists()).toBe(false)
    expect(document.activeElement).toBe(stepHeading(wrapper).element)
    wrapper.unmount()
  })
})

describe('out of tokens or a failed key: back to Connect AI', () => {
  it('returns to Connect AI with the reason when the shared allowance runs out mid-job, keeping what was made', async () => {
    const { wrapper } = await mounted({
      overrides: {
        estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate()),
        startLlmAnnotation: vi.fn().mockResolvedValue({ job_id: 'job-1', estimate: estimate() }),
        getLlmJob: vi.fn().mockResolvedValue({ status: 'budget_exhausted', total: 28, done: 9, created: 9 }),
      },
    })

    await click(wrapper, 'Work out the cost')
    await click(wrapper, 'Start labelling 28 items')
    await poll()

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(alerts(wrapper).join(' ')).toContain("This month's shared AI allowance is used up. The suggestions already made are kept.")
    expect(guide(wrapper).find('input[type="password"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('returns to Connect AI when starting is refused for the allowance', async () => {
    const { wrapper } = await mounted({
      overrides: {
        estimateLlmAnnotation: vi.fn().mockResolvedValue(estimate()),
        startLlmAnnotation: vi.fn().mockRejectedValue(refusal("You've reached the monthly limit. Add your own API key to continue.", 'budget_exhausted')),
      },
    })

    await click(wrapper, 'Work out the cost')
    await click(wrapper, 'Start labelling 28 items')

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(alerts(wrapper).join(' ')).toContain("This month's shared AI allowance is used up.")
    wrapper.unmount()
  })

  it('returns to Connect AI with the reason when the provider refuses the key during the job', async () => {
    const own = llmStatus({ mode: 'byok', remaining_tokens: null, key: { base_url: 'https://openrouter.ai/api/v1', model: 'mistral-small' } })
    localStorage.setItem('vmlb-guide-job:ds-1', 'job-1')
    const { adapter, wrapper } = await mounted({
      overrides: {
        getLlmStatus: vi.fn().mockResolvedValue(own),
        getLlmJob: vi.fn().mockResolvedValue({ status: 'failed', total: 28, done: 9, created: 9, error: 'The LLM service rejected the API key.' }),
      },
    })

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(alerts(wrapper).join(' ')).toContain('The AI key stopped working: The LLM service rejected the API key. The labels the AI already made are kept.')
    expect(guide(wrapper).find('input[type="password"]').exists()).toBe(true)
    // Nothing the AI made was thrown away.
    expect(adapter.rejectLlmSuggestion).not.toHaveBeenCalled()

    // A key saved again brings the guide back to where it was, with the stopped job to carry on.
    await wrapper.find('input[type="password"]').setValue('sk-new')
    await wrapper.find('form.vmlb-guide-key').trigger('submit')
    await flushPromises()
    expect(adapter.saveLlmKey).toHaveBeenCalled()
    expect(currentStep(wrapper).text()).toContain('Do the rest')
    expect(alerts(wrapper)).toContain('Labelling stopped after 9 of 28. Those 9 are kept.')
    wrapper.unmount()
  })

  it('does not send the student back to Connect AI on the next visit once a new key is saved', async () => {
    const own = llmStatus({ mode: 'byok', remaining_tokens: null, key: { base_url: 'https://openrouter.ai/api/v1', model: 'mistral-small' } })
    localStorage.setItem('vmlb-guide-job:ds-1', 'job-1')
    const overrides = {
      getLlmStatus: vi.fn().mockResolvedValue(own),
      getLlmJob: vi.fn().mockResolvedValue({ status: 'failed', total: 28, done: 9, created: 9, error: 'The LLM service rejected the API key.' }),
    }
    const first = await mounted({ overrides })
    expect(currentStep(first.wrapper).text()).toContain('Connect AI')
    await first.wrapper.find('input[type="password"]').setValue('sk-new')
    await first.wrapper.find('form.vmlb-guide-key').trigger('submit')
    await flushPromises()
    expect(currentStep(first.wrapper).text()).toContain('Do the rest')
    first.wrapper.unmount()

    const again = await mounted({ overrides })

    expect(currentStep(again.wrapper).text()).toContain('Do the rest')
    expect(guide(again.wrapper).find('input[type="password"]').exists()).toBe(false)
    expect(button(again.wrapper, 'Work out the cost')).toBeDefined()
    again.wrapper.unmount()
  })

  it('returns to Connect AI from Try it when the provider refuses the key', async () => {
    const { wrapper } = await mounted({
      overrides: {
        getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ model: 'mistral-small', prompt_version: 0, checked: 3, agreed: 3, rate: 1 })),
        createLlmSuggestions: vi.fn().mockRejectedValue(refusal('The LLM service rejected the API key.', 'llm_failed')),
      },
    })

    expect(currentStep(wrapper).text()).toContain('Connect AI')
    expect(alerts(wrapper).join(' ')).toContain('The AI key stopped working: The LLM service rejected the API key.')
    wrapper.unmount()
  })

  it('stays in Try it when the AI only failed to answer', async () => {
    const { wrapper } = await mounted({
      overrides: {
        getLlmAgreement: vi.fn().mockResolvedValue(llmAgreement({ model: 'mistral-small', prompt_version: 0, checked: 3, agreed: 3, rate: 1 })),
        createLlmSuggestions: vi.fn().mockRejectedValue(refusal('The LLM service is rate limiting this key. Try again later.', 'llm_failed')),
      },
    })

    expect(currentStep(wrapper).text()).toContain('Try it')
    wrapper.unmount()
  })
})

describe('step 6, Ready to train', () => {
  const done = { total: 72, annotated: 72, percentage: 100 }

  it('shows the counts per label and opens Create model, with no warning when each label has 50 or more', async () => {
    const { wrapper } = await mounted({ counts: { Civil: 60, Criminal: 52 }, stats: { total: 112, annotated: 112, percentage: 100 }, props: { createModelHref: '/models/create?project=p1' } })

    expect(currentStep(wrapper).text()).toContain('Ready to train')
    const counts = guide(wrapper).find('ul[aria-label="Examples per label"]')
    expect(counts.text()).toContain('Civil 60')
    expect(counts.text()).toContain('Criminal 52')
    expect(guide(wrapper).text()).not.toContain('Only ')
    const create = guide(wrapper).find('a[href="/models/create?project=p1"]')
    expect(create.text()).toBe('Create model')
    expect(create.classes()).toContain('vmlb-btn-primary')
    wrapper.unmount()
  })

  it('names any label under 50 in a warning', async () => {
    const { wrapper } = await mounted({ counts: { Civil: 60, Criminal: 12 }, stats: done, props: { createModelHref: '/models/create?project=p1' } })

    expect(guide(wrapper).text()).toContain('Only 12 “Criminal” examples. Your model may miss this label; 50 or more works better.')
    expect(guide(wrapper).text()).not.toContain('“Civil” examples')
    expect(guide(wrapper).find('a[href="/models/create?project=p1"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('blocks Create model and names the label when a label has no examples', async () => {
    const { wrapper } = await mounted({ counts: { Civil: 72, Criminal: 0 }, stats: done, props: { createModelHref: '/models/create?project=p1' } })

    expect(guide(wrapper).find('a[href="/models/create?project=p1"]').exists()).toBe(false)
    const create = button(wrapper, 'Create model')
    expect(create!.attributes('disabled')).toBeDefined()
    const reason = wrapper.find(`#${create!.attributes('aria-describedby')}`)
    expect(reason.text()).toContain('“Criminal” has none yet, so Create model can\'t start.')
    wrapper.unmount()
  })

  it('comes once every label has two confirmed and the AI has already answered on every item left', async () => {
    const rejected = [llmSuggestion({ id: 'r0', task_id: 'p0', status: 'rejected' }), llmSuggestion({ id: 'r1', task_id: 'p1', status: 'rejected' })]
    const { wrapper } = await mounted({
      stats: { total: 14, annotated: 12, percentage: 86 },
      props: { createModelHref: '/models/create?project=p1' },
      overrides: { listLlmSuggestions: suggestionList(() => rejected), listAnnotationTasks: vi.fn().mockResolvedValue([pendingTask(0), pendingTask(1)]) },
    })

    expect(currentStep(wrapper).text()).toContain('Ready to train')
    expect(guide(wrapper).text()).toContain('2 items are still unlabelled. You can train now, or label them later.')
    expect(guide(wrapper).find('a[href="/models/create?project=p1"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('on a return visit, opens on Ready to train without passing through Do the rest or taking focus', async () => {
    const rejected = [llmSuggestion({ id: 'r0', task_id: 'p0', status: 'rejected' }), llmSuggestion({ id: 'r1', task_id: 'p1', status: 'rejected' })]
    const seen: string[] = []
    const observer = new MutationObserver(() => {
      const title = document.querySelector('.vmlb-guide-step-title')?.textContent?.trim()
      if (title && seen[seen.length - 1] !== title) seen.push(title)
    })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    const { wrapper } = await mounted({
      stats: { total: 14, annotated: 12, percentage: 86 },
      overrides: { listLlmSuggestions: suggestionList(() => rejected), listAnnotationTasks: vi.fn().mockResolvedValue([pendingTask(0), pendingTask(1)]) },
    })
    observer.disconnect()

    expect(currentStep(wrapper).text()).toContain('Ready to train')
    expect(seen).not.toContain('Let the AI label the rest')
    expect(document.activeElement?.tagName).not.toBe('H3')
    wrapper.unmount()
  })

  it('does not offer Ready to train while the AI labels wait, so they can still be accepted', async () => {
    const { wrapper } = await mounted({
      counts: { Civil: 6, Criminal: 6 },
      overrides: { listLlmSuggestions: suggestionList(() => Array.from({ length: 28 }, (_, i) => aiLabel(i))) },
    })

    expect(button(wrapper, 'Accept 28 AI labels')).toBeDefined()
    expect(button(wrapper, 'Go to Ready to train')).toBeUndefined()
    wrapper.unmount()
  })

  it('says it, not they, when the AI labelled one item', async () => {
    const { wrapper } = await mounted({
      stats: { total: 13, annotated: 12, percentage: 92 },
      overrides: {
        listLlmSuggestions: suggestionList(() => [aiLabel(0)]),
        listAnnotationTasks: vi.fn().mockResolvedValue([pendingTask(0)]),
      },
    })

    expect(guide(wrapper).text()).toContain("The AI labelled 1 item. It isn't a label yet: accept it to make it yours, or check it first.")
    wrapper.unmount()
  })

  it('moves focus to Ready to train once the AI labels are accepted and nothing is left', async () => {
    let accepted = false
    const getNextAnnotationTask = vi.fn(async () =>
      accepted ? { task: null, stats: { total: 40, annotated: 40, percentage: 100 } } : { task: item, stats: { total: 40, annotated: 12, percentage: 30 } },
    )
    const counts: Record<string, number> = { Civil: 6, Criminal: 6 }
    const { wrapper } = await mounted({
      counts,
      overrides: {
        getNextAnnotationTask,
        listLlmSuggestions: suggestionList(() => (accepted ? [] : Array.from({ length: 28 }, (_, i) => aiLabel(i)))),
        listAnnotationTasks: vi.fn(async () => (accepted ? [] : Array.from({ length: 28 }, (_, i) => pendingTask(i)))),
        bulkAcceptLlmSuggestions: vi.fn(async () => {
          accepted = true
          counts.Civil = 20
          counts.Criminal = 20
          return { accepted: 28, agreement: passed }
        }),
      },
    })

    await click(wrapper, 'Accept 28 AI labels')
    await flushPromises()

    expect(currentStep(wrapper).text()).toContain('Ready to train')
    expect(document.activeElement).toBe(stepHeading(wrapper).element)
    expect(guide(wrapper).text()).toContain('Only 20 “Civil” examples.')
    wrapper.unmount()
  })
})
