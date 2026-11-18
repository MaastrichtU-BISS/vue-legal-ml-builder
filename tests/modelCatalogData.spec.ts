import { describe, expect, it } from 'vitest'
import { allModelInfo, modelsByTaskType, modelTypeLabel, parameterSchemas, quickGuideFor } from '../src/components/modelCatalogData'

const field = (modelType: string, key: string) => parameterSchemas[modelType].find((p) => p.key === key)!

describe('the NER and summarization catalogue', () => {
  it('offers the entity models for both names of the NER task', () => {
    expect(modelsByTaskType.ner).toEqual(['legalbert_ner', 'distilbert_ner'])
    expect(modelsByTaskType.named_entity_recognition).toEqual(['legalbert_ner', 'distilbert_ner'])
  })

  it('offers t5_small for summarization', () => {
    expect(modelsByTaskType.summarization).toEqual(['t5_small'])
  })

  it('names every new model in words, never its raw id', () => {
    expect(allModelInfo.legalbert_ner.label).toBe('LegalBERT (entities)')
    expect(allModelInfo.distilbert_ner.label).toBe('DistilBERT (entities)')
    expect(allModelInfo.t5_small.label).toBe('T5 small (summaries)')
    expect(allModelInfo.legalbert_ner.shortDesc).toBe('LegalBERT fine-tuned to find named entities')
    expect(allModelInfo.distilbert_ner.shortDesc).toBe('A small, fast BERT fine-tuned to find named entities')
    expect(allModelInfo.t5_small.shortDesc).toBe('A small text-to-text model fine-tuned to write summaries')
  })

  it('names a model type in words, falling back to its id', () => {
    expect(modelTypeLabel('legalbert_ner')).toBe('LegalBERT (entities)')
    expect(modelTypeLabel('mystery_model')).toBe('mystery model')
  })

  it('gives each new task a plain-language quick guide', () => {
    expect(quickGuideFor('ner')).not.toBeNull()
    expect(quickGuideFor('named_entity_recognition')).not.toBeNull()
    expect(quickGuideFor('summarization')).not.toBeNull()
  })
})

describe('the NER parameter schemas', () => {
  const variants: Record<string, string> = {
    legalbert_ner: 'nlpaueb/legal-bert-base-uncased',
    distilbert_ner: 'distilbert-base-cased',
  }

  for (const [modelType, modelName] of Object.entries(variants)) {
    it(`matches the server's ${modelType} keys, ranges and defaults`, () => {
      expect(parameterSchemas[modelType].map((p) => p.key)).toEqual([
        'model_name',
        'max_length',
        'learning_rate',
        'batch_size',
        'epochs',
      ])

      expect(field(modelType, 'model_name')).toMatchObject({ type: 'select', default: modelName, options: [modelName] })
      expect(field(modelType, 'max_length')).toMatchObject({ type: 'number', min: 128, max: 512, default: 256 })
      expect(field(modelType, 'learning_rate')).toMatchObject({ type: 'number', min: 1e-6, max: 0.01, default: 5e-5 })
      expect(field(modelType, 'batch_size')).toMatchObject({ type: 'number', min: 4, max: 32, default: 8 })
      expect(field(modelType, 'epochs')).toMatchObject({ type: 'number', min: 1, max: 10, default: 3 })
    })
  }
})

describe('the summarization parameter schema', () => {
  it("matches the server's t5_small keys, ranges and defaults", () => {
    expect(parameterSchemas.t5_small.map((p) => p.key)).toEqual([
      'model_name',
      'max_source_length',
      'max_target_length',
      'learning_rate',
      'batch_size',
      'epochs',
    ])

    expect(field('t5_small', 'model_name')).toMatchObject({ type: 'select', default: 't5-small', options: ['t5-small'] })
    expect(field('t5_small', 'max_source_length')).toMatchObject({ type: 'number', min: 128, max: 1024, default: 512 })
    expect(field('t5_small', 'max_target_length')).toMatchObject({ type: 'number', min: 32, max: 256, default: 128 })
    expect(field('t5_small', 'learning_rate')).toMatchObject({ type: 'number', min: 1e-6, max: 0.01, default: 3e-4 })
    expect(field('t5_small', 'batch_size')).toMatchObject({ type: 'number', min: 2, max: 16, default: 8 })
    expect(field('t5_small', 'epochs')).toMatchObject({ type: 'number', min: 1, max: 10, default: 3 })
  })
})
