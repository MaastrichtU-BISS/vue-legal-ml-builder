import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GUIDE_STEPS,
  agreementLine,
  aiLabellable,
  aiLabelsToAccept,
  jobKeyFailureReason,
  jobProgressLine,
  readyToTrain,
  keyFailureReason,
  pickAtRandom,
  readGuideJob,
  readySummary,
  writeGuideJob,
  agreementLow,
  agreementPassed,
  currentAgreement,
  definitionsToFill,
  showTargets,
  guideStep,
  isSingleLabelTask,
  labelsShortOfReady,
  readGuidePreference,
  readPendingDescriptions,
  stepsMet,
  validateLabels,
  writeGuidePreference,
  writePendingDescriptions,
  type GuideProgress,
} from '../src/annotation/guide'
import { isOpenRouterUrl, waitingSuggestion } from '../src/annotation/llmAssist'
import { llmAgreement, llmSuggestion } from './fixtures/llm'

const passed = llmAgreement({ checked: 30, agreed: 27, rate: 0.9, unlocked: true })

/** A Dataset part way: two labels, AI connected, enough shown, check passed, items left. */
function progress(overrides: Partial<GuideProgress> = {}): GuideProgress {
  return {
    labels: ['Civil', 'Criminal'],
    hasAccess: true,
    acknowledged: true,
    confirmedPerLabel: { Civil: 6, Criminal: 6 },
    confirmedTotal: 12,
    pending: 40,
    agreement: passed,
    ...overrides,
  }
}

describe('guideStep', () => {
  it('starts at Your labels with fewer than two named labels', () => {
    expect(guideStep(progress({ labels: [] }))).toBe('labels')
    expect(guideStep(progress({ labels: ['Civil'] }))).toBe('labels')
  })

  it('asks to connect an AI without usable access or without the acknowledgement', () => {
    expect(guideStep(progress({ hasAccess: false }))).toBe('connect')
    expect(guideStep(progress({ acknowledged: false }))).toBe('connect')
  })

  it('asks for examples while a label has fewer than three', () => {
    expect(guideStep(progress({ confirmedPerLabel: { Civil: 8, Criminal: 2 }, confirmedTotal: 10 }))).toBe('show')
    expect(guideStep(progress({ confirmedPerLabel: { Civil: 10 }, confirmedTotal: 10 }))).toBe('show')
  })

  it('asks for examples while fewer than ten are labelled in total', () => {
    expect(guideStep(progress({ confirmedPerLabel: { Civil: 4, Criminal: 4 }, confirmedTotal: 8 }))).toBe('show')
  })

  it('uses the total alone when the server cannot count per label', () => {
    expect(guideStep(progress({ confirmedPerLabel: null, confirmedTotal: 9 }))).toBe('show')
    expect(guideStep(progress({ confirmedPerLabel: null, confirmedTotal: 10 }))).toBe('rest')
  })

  it('tries the AI until the server’s sample size is checked', () => {
    expect(guideStep(progress({ agreement: llmAgreement({ checked: 29, agreed: 29, rate: 1 }) }))).toBe('try')
    expect(guideStep(progress({ agreement: null }))).toBe('try')
  })

  it('stays on Try it, improving, while the rate is below the server’s threshold', () => {
    expect(guideStep(progress({ agreement: llmAgreement({ checked: 30, agreed: 21, rate: 0.7 }) }))).toBe('try')
    // The server's own threshold and sample, not constants.
    expect(guideStep(progress({ agreement: llmAgreement({ checked: 12, agreed: 12, rate: 1, min_sample: 10, threshold: 0.95 }) }))).toBe('rest')
  })

  it('lets the AI do the rest once the check passed and items remain', () => {
    expect(guideStep(progress())).toBe('rest')
    expect(guideStep(progress({ pending: null }))).toBe('rest')
  })

  it('is ready to train when no item waits for a label', () => {
    expect(guideStep(progress({ pending: 0 }))).toBe('ready')
    // Nothing left to label: neither the AI nor more examples can help.
    expect(guideStep(progress({ pending: 0, hasAccess: false, confirmedTotal: 4, confirmedPerLabel: { Civil: 2, Criminal: 2 } }))).toBe('ready')
  })

  it('is ready to train with items left once every label has two confirmed and the AI can label nothing more', () => {
    expect(guideStep(progress({ aiCanLabelMore: false, aiLabelsWaiting: 0 }))).toBe('ready')
    // The AI's labels still wait to be accepted, or it can still label some: Do the rest.
    expect(guideStep(progress({ aiCanLabelMore: false, aiLabelsWaiting: 3 }))).toBe('rest')
    expect(guideStep(progress({ aiCanLabelMore: true }))).toBe('rest')
    // A label short of two: what is left is the student's, in Do the rest.
    expect(guideStep(progress({ aiCanLabelMore: false, pending: 1, confirmedPerLabel: { Civil: 1, Criminal: 11 } }))).toBe('rest')
    expect(stepsMet(progress({ aiCanLabelMore: false })).rest).toBe(true)
  })

  it('is ready to train only when every label has two confirmed, as the server counts them', () => {
    expect(readyToTrain({ labels: ['Civil', 'Criminal'], confirmedPerLabel: { Civil: 2, Criminal: 2 } })).toBe(true)
    expect(readyToTrain({ labels: ['Civil', 'Criminal'], confirmedPerLabel: { Civil: 2 } })).toBe(false)
    expect(readyToTrain({ labels: ['Civil', 'Criminal'], confirmedPerLabel: null })).toBe(false)
  })

  it('names the labels short of two confirmed examples for the Ready step', () => {
    expect(labelsShortOfReady({ labels: ['Civil', 'Criminal'], confirmedPerLabel: { Civil: 2, Criminal: 1 } })).toEqual(['Criminal'])
    expect(labelsShortOfReady({ labels: ['Civil', 'Criminal'], confirmedPerLabel: null })).toEqual([])
  })
})

describe('stepsMet', () => {
  it('calls a step done only when its own condition is met', () => {
    expect(stepsMet(progress({ confirmedPerLabel: { Civil: 5, Criminal: 5 }, confirmedTotal: 10, agreement: passed, pending: 0 }))).toEqual({
      labels: true, connect: true, show: true, try: true, rest: true, ready: true,
    })
  })

  it('leaves steps passed over because nothing was left as not done', () => {
    const met = stepsMet(progress({ hasAccess: false, acknowledged: false, confirmedPerLabel: { Civil: 1, Criminal: 0 }, confirmedTotal: 1, pending: 0, agreement: null }))
    expect(met).toEqual({ labels: true, connect: false, show: false, try: false, rest: false, ready: true })
  })
})

describe('agreementPassed', () => {
  it('needs the sample and the threshold', () => {
    expect(agreementPassed(passed)).toBe(true)
    expect(agreementPassed(llmAgreement({ checked: 30, agreed: 24, rate: 0.8 }))).toBe(true)
    expect(agreementPassed(llmAgreement({ checked: 30, agreed: 23, rate: 23 / 30 }))).toBe(false)
    expect(agreementPassed(llmAgreement())).toBe(false)
    expect(agreementPassed(null)).toBe(false)
  })
})

describe('the steps', () => {
  it('are six, with their rough times and none for the last', () => {
    expect(GUIDE_STEPS.map((s) => s.short)).toEqual(['Your labels', 'Connect AI', 'Show it how', 'Try it', 'Do the rest', 'Ready to train'])
    expect(GUIDE_STEPS.map((s) => s.time)).toEqual(['About 2 minutes', 'About 2 minutes', 'About 5 minutes', 'About 10 minutes', 'A few minutes', null])
  })

  it('cover single-label task types only', () => {
    expect(['classification', 'document_classification', 'judgment_prediction'].every(isSingleLabelTask)).toBe(true)
    expect(['multi-label', 'ner', 'summarization', 'topic_modeling', 'clustering'].some(isSingleLabelTask)).toBe(false)
  })
})

describe('validateLabels', () => {
  const row = (name: string, description = 'When it applies.') => ({ name, description, locked: false })

  it('accepts two named, described labels', () => {
    expect(validateLabels([row('Civil'), row('Criminal')])).toEqual({ list: null, names: {}, descriptions: {} })
  })

  it('needs at least two', () => {
    expect(validateLabels([row('Civil')]).list).toBe('Use at least two labels')
  })

  it('marks empty and repeated names on their field', () => {
    const errors = validateLabels([row('Civil'), row('  '), row('civil ')])
    expect(errors.names).toEqual({ 1: "Label names can't be empty", 2: 'Two labels have the same name' })
  })

  it('marks a missing sentence on its field', () => {
    expect(validateLabels([row('Civil'), row('Criminal', ' ')]).descriptions).toEqual({ 1: 'Write one sentence saying when to use this label' })
  })
})

describe('guide storage', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
  })

  it('remembers hiding per Dataset', () => {
    expect(readGuidePreference('ds-1')).toBeNull()
    writeGuidePreference('ds-1', true)
    expect(readGuidePreference('ds-1')).toBe('hidden')
    expect(readGuidePreference('ds-2')).toBeNull()
    writeGuidePreference('ds-1', false)
    expect(readGuidePreference('ds-1')).toBe('shown')
  })

  it('says when storage cannot be read, and never throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(readGuidePreference('ds-1')).toBe('unavailable')
    expect(() => writeGuidePreference('ds-1', true)).not.toThrow()
    expect(readPendingDescriptions('ds-1')).toBeNull()
    expect(() => writePendingDescriptions('ds-1', { Civil: 'x' })).not.toThrow()
  })

  it('keeps descriptions waiting for the prompt until cleared', () => {
    writePendingDescriptions('ds-1', { Civil: 'About private rights.' })
    expect(readPendingDescriptions('ds-1')).toEqual({ Civil: 'About private rights.' })
    writePendingDescriptions('ds-1', null)
    expect(readPendingDescriptions('ds-1')).toBeNull()
  })
})

describe('showTargets (BAIGLE #194)', () => {
  it('asks for 3 per label and 10 in total while the queue is open', () => {
    const targets = showTargets(progress({ confirmedPerLabel: { Civil: 3, Criminal: 1 }, confirmedTotal: 4, pending: null }))
    expect(targets.labels).toEqual([
      { label: 'Civil', count: 3, target: 3, capped: false },
      { label: 'Criminal', count: 1, target: 3, capped: false },
    ])
    expect(targets.totalTarget).toBe(10)
  })

  it('lets a label, or the total, that cannot reach its target any more continue', () => {
    // Two items left: Other can reach 2 at most, so it doesn't hold the step; Civil still can and does.
    const p = progress({
      labels: ['Civil', 'Criminal', 'Other'],
      confirmedPerLabel: { Civil: 1, Criminal: 8, Other: 0 },
      confirmedTotal: 9,
      pending: 2,
      agreement: null,
    })
    expect(showTargets(p).labels[2]).toEqual({ label: 'Other', count: 0, target: 2, capped: true })
    expect(guideStep(p)).toBe('show')
    const civilDone = { ...p, confirmedPerLabel: { Civil: 3, Criminal: 8, Other: 0 }, confirmedTotal: 11 }
    expect(guideStep(civilDone)).toBe('try')
    // Moved on, but Other never had its 3: skipped, not done.
    expect(stepsMet(civilDone).show).toBe(false)
    // The total too: 6 labelled and 1 left can't make 10.
    expect(guideStep(progress({ confirmedPerLabel: { Civil: 3, Criminal: 3 }, confirmedTotal: 6, pending: 1, agreement: null }))).toBe('try')
  })

  it('has no per-label counts when the server cannot count them', () => {
    expect(showTargets(progress({ confirmedPerLabel: null })).labels).toEqual([])
  })
})

describe('definitionsToFill', () => {
  it('fills only empty definitions from sentences waiting since an earlier visit', () => {
    expect(definitionsToFill({ Civil: 'Kept.', Criminal: '' }, { Civil: 'New.', Criminal: 'Offences.' }, false)).toEqual({ Criminal: 'Offences.' })
  })

  it('replaces definitions with sentences typed this visit, leaving out unchanged and empty ones', () => {
    expect(definitionsToFill({ Civil: 'Old.', Criminal: 'Same.' }, { Civil: 'New.', Criminal: 'Same.', Other: ' ' }, true)).toEqual({ Civil: 'New.' })
  })
})

describe('Try it: the agreement check', () => {
  const checked = llmAgreement({ model: 'm', prompt_version: 1, checked: 30, agreed: 21, rate: 0.7 })

  it('is the server’s check while the prompt version and model are the ones in use', () => {
    expect(currentAgreement(checked, { promptVersion: 1, model: 'm' })).toEqual(checked)
    expect(currentAgreement(checked, { promptVersion: null, model: null })).toEqual(checked)
    expect(currentAgreement(null, { promptVersion: 1, model: 'm' })).toBeNull()
  })

  it('starts from zero for a newer prompt version or another model, keeping the server’s settings', () => {
    const fresh = currentAgreement(checked, { promptVersion: 2, model: 'm' })!
    expect(fresh).toMatchObject({ prompt_version: 2, checked: 0, agreed: 0, rate: null, unlocked: false, min_sample: 30, threshold: 0.8 })
    expect(currentAgreement(checked, { promptVersion: 1, model: 'other' })!.checked).toBe(0)
  })

  it('is low only at the server’s full sample under its threshold', () => {
    expect(agreementLow(checked)).toBe(true)
    expect(agreementLow(llmAgreement({ checked: 29, agreed: 10, rate: 10 / 29 }))).toBe(false)
    expect(agreementLow(llmAgreement({ checked: 30, agreed: 24, rate: 0.8 }))).toBe(false)
    expect(agreementLow(llmAgreement({ checked: 10, agreed: 8, rate: 0.8, min_sample: 10, threshold: 0.9 }))).toBe(true)
    expect(agreementLow(null)).toBe(false)
  })

  it('reads the running count in the server’s numbers', () => {
    expect(agreementLine(llmAgreement())).toBe('30 more to check before it can label the rest.')
    expect(agreementLine(llmAgreement({ checked: 20, agreed: 17, rate: 0.85 }))).toBe(
      'The AI agreed with you on 17 of 20. 10 more to check before it can label the rest.',
    )
    expect(agreementLine(checked)).toBe(
      'The AI agreed with you on 21 of 30. It needs to agree at least 80% of the time before it can label the rest.',
    )
  })

  it('gives no numbers without the server’s check', () => {
    expect(agreementLine(null)).toBe('Each answer counts toward the check.')
  })
})

describe('Try it: the item’s waiting suggestion', () => {
  it('is the newest pending one for the item, from the prompt version and model in use', () => {
    const old = llmSuggestion({ id: 'old', prompt_version: 0 })
    const now = llmSuggestion({ id: 'now', prompt_version: 1 })
    expect(waitingSuggestion([old, now], 't1', { promptVersion: 1, model: 'mistral-small' })!.id).toBe('now')
    expect(waitingSuggestion([old], 't1', { promptVersion: 1, model: 'mistral-small' })).toBeNull()
    expect(waitingSuggestion([now], 't1', { promptVersion: 1, model: 'other' })).toBeNull()
    expect(waitingSuggestion([now], 't2', { promptVersion: null, model: null })).toBeNull()
    expect(waitingSuggestion([{ ...now, status: 'accepted' }], 't1', { promptVersion: null, model: null })).toBeNull()
  })
})

describe('Do the rest and Ready to train (BAIGLE #196)', () => {
  const check = { model: 'm', prompt_version: 2, checked: 30, agreed: 27, rate: 0.9, min_sample: 30, threshold: 0.8, unlocked: true }
  const s = (id: string, over: Record<string, unknown> = {}) =>
    ({ id, task_id: id, model: 'm', prompt_version: 2, label: 'A', rationale: '', status: 'pending', created_at: '', ...over }) as never

  it('counts only waiting AI labels from the checked model and prompt, on a named label', () => {
    const list = [s('1'), s('2', { model: 'x' }), s('3', { prompt_version: 1 }), s('4', { label: 'Gone' }), s('5', { status: 'accepted' })]
    expect(aiLabelsToAccept(list, check, ['A', 'B']).map((x: { id: string }) => x.id)).toEqual(['1'])
    expect(aiLabelsToAccept(list, null, ['A', 'B'])).toEqual([])
  })

  it('leaves out AI labels for items no longer waiting for a label, when those are known', () => {
    const check = llmAgreement({ model: 'm', prompt_version: 1, checked: 30, agreed: 27, rate: 0.9, unlocked: true })
    const list = [llmSuggestion({ id: '1', task_id: 'a', model: 'm', prompt_version: 1, label: 'A' }), llmSuggestion({ id: '2', task_id: 'b', model: 'm', prompt_version: 1, label: 'A' })]
    expect(aiLabelsToAccept(list, check, ['A'], new Set(['a'])).map((x) => x.id)).toEqual(['1'])
    expect(aiLabelsToAccept(list, check, ['A'], null).map((x) => x.id)).toEqual(['1', '2'])
  })

  it('finds the items the AI can still label: none of its answers for them from this model and prompt, whatever their status', () => {
    const tasks = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const suggestions = [
      llmSuggestion({ id: '1', task_id: 'a', model: 'm', prompt_version: 1, status: 'rejected' }),
      llmSuggestion({ id: '2', task_id: 'b', model: 'm', prompt_version: 1, status: 'pending' }),
      llmSuggestion({ id: '3', task_id: 'c', model: 'm', prompt_version: 0, status: 'rejected' }),
      llmSuggestion({ id: '4', task_id: 'd', model: 'other', prompt_version: 1 }),
    ]
    expect(aiLabellable(tasks, suggestions, { model: 'm', promptVersion: 1 }).map((t) => t.id)).toEqual(['c', 'd'])
  })

  it("announces a job's progress at the start, then once per quarter passed", () => {
    expect(jobProgressLine({ done: 1, total: 28 }, null)).toEqual({ line: 'Labelling: 1 of 28 done.', quarter: 0 })
    expect(jobProgressLine({ done: 6, total: 28 }, 0)).toBeNull()
    expect(jobProgressLine({ done: 7, total: 28 }, 0)).toEqual({ line: 'Labelling: 7 of 28 done.', quarter: 1 })
    expect(jobProgressLine({ done: 28, total: 28 }, 1)).toEqual({ line: 'Labelling: 28 of 28 done.', quarter: 4 })
  })

  it('picks at most n, each once', () => {
    const picked = pickAtRandom([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 10)
    expect(picked).toHaveLength(10)
    expect(new Set(picked).size).toBe(10)
    expect(pickAtRandom([1, 2], 10)).toHaveLength(2)
  })

  it('warns about labels under 50 and blocks on labels with none', () => {
    const summary = readySummary({ labels: ['A', 'B', 'C'], confirmedPerLabel: { A: 60, B: 12 } })
    expect(summary.labels).toEqual([{ label: 'A', count: 60 }, { label: 'B', count: 12 }, { label: 'C', count: 0 }])
    expect(summary.few).toEqual([{ label: 'B', count: 12 }])
    expect(summary.none).toEqual(['C'])
    expect(readySummary({ labels: ['A', 'B'], confirmedPerLabel: null })).toEqual({ labels: [], few: [], none: [] })
  })

  it('tells a failed key from other failures', () => {
    expect(keyFailureReason('llm_failed', 'The LLM service rejected the API key.')).toBe('The LLM service rejected the API key.')
    expect(keyFailureReason('credential_unusable', 'The saved key could not be read.')).toBe('The saved key could not be read.')
    expect(keyFailureReason('llm_failed', 'The LLM service is rate limiting this key. Try again later.')).toBeNull()
    expect(keyFailureReason('llm_failed', 'The LLM service returned an error.')).toBeNull()
    expect(keyFailureReason('budget_exhausted', 'Add your own API key to continue.')).toBeNull()
    expect(jobKeyFailureReason('The LLM key for this job is no longer available.')).toBe('The LLM key for this job is no longer available.')
    expect(jobKeyFailureReason('The annotation job failed.')).toBeNull()
  })

  it('keeps only the job id per Dataset, and survives without storage', () => {
    writeGuideJob('ds-1', 'job-1')
    expect(readGuideJob('ds-1')).toBe('job-1')
    writeGuideJob('ds-1', null)
    expect(readGuideJob('ds-1')).toBeNull()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied') })
    expect(() => writeGuideJob('ds-1', 'job-2')).not.toThrow()
    expect(readGuideJob('ds-1')).toBeNull()
  })
})

describe('isOpenRouterUrl (BAIGLE #225 council)', () => {
  it("is OpenRouter's https address only, with no user or password, as the server checks", () => {
    expect(isOpenRouterUrl('https://openrouter.ai/api/v1')).toBe(true)
    expect(isOpenRouterUrl('https://OpenRouter.ai./api/v1')).toBe(true)
    expect(isOpenRouterUrl('http://openrouter.ai/api/v1')).toBe(false)
    expect(isOpenRouterUrl('https://user:pass@openrouter.ai/api/v1')).toBe(false)
    expect(isOpenRouterUrl('https://user@openrouter.ai/api/v1')).toBe(false)
    expect(isOpenRouterUrl('https://api.mistral.ai/v1')).toBe(false)
    expect(isOpenRouterUrl(null)).toBe(false)
  })
})
