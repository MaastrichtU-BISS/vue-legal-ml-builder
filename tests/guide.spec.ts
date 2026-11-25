import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GUIDE_STEPS,
  agreementPassed,
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
import { llmAgreement } from './fixtures/llm'

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
