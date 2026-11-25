import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import GuideTryStep from '../src/components/GuideTryStep.vue'
import { llmAgreement, llmSuggestion } from './fixtures/llm'

// Try it's card on its own: where focus goes after an answer.

afterEach(() => {
  document.body.innerHTML = ''
})

function card() {
  const outside = document.createElement('input')
  document.body.appendChild(outside)
  const wrapper = mount(GuideTryStep, {
    props: { labels: ['Civil', 'Criminal'], view: 'ready', suggestion: llmSuggestion(), agreement: llmAgreement(), busy: false },
    attachTo: document.body,
  })
  return { wrapper, outside }
}

const suggestionCard = '[aria-label="The AI\'s suggestion"]'

describe('Try it: focus after an answer', () => {
  it('moves to the next suggestion when focus stayed with the card', async () => {
    const { wrapper } = card()
    await wrapper.findAll('button').find((b) => b.text() === 'Accept Criminal')!.trigger('click')

    await wrapper.setProps({ suggestion: llmSuggestion({ id: 's2', task_id: 't2' }) })
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.find(suggestionCard).element)
    wrapper.unmount()
  })

  it('leaves focus alone when the student moved it to a field meanwhile', async () => {
    const { wrapper, outside } = card()
    await wrapper.findAll('button').find((b) => b.text() === 'Accept Criminal')!.trigger('click')
    outside.focus()

    await wrapper.setProps({ suggestion: llmSuggestion({ id: 's2', task_id: 't2' }) })
    await flushPromises()

    expect(document.activeElement).toBe(outside)
    wrapper.unmount()
  })
})
