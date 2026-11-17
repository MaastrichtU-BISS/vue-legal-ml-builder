import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { themeTokens } from '../src/theme'

// Type sizes are a token scale a host can map onto its own (BAIGLE #153), the
// same way it maps colour, radius and spacing.
const SIZES = ['2xs', 'xs', 'sm', 'md', 'base', 'lg', 'xl', '2xl', '3xl'] as const

const tokensCss = readFileSync(join(__dirname, '../src/styles/tokens.css'), 'utf8')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'demo' ? [] : sourceFiles(path)
    return /\.(vue|css)$/.test(name) ? [path] : []
  })
}

describe('type scale', () => {
  it.each(SIZES)('declares --vmlb-font-size-%s and lists it in the theme contract', (size) => {
    expect(tokensCss).toMatch(new RegExp(`--vmlb-font-size-${size}:\\s*[\\d.]+rem;`))
    expect(themeTokens[`font-size-${size}` as keyof typeof themeTokens]).toBe(`--vmlb-font-size-${size}`)
  })

  it('declares the label case and tracking, uppercase by default', () => {
    expect(tokensCss).toMatch(/--vmlb-label-case:\s*uppercase;/)
    expect(tokensCss).toMatch(/--vmlb-label-tracking:\s*0\.06em;/)
    expect(themeTokens['label-case']).toBe('--vmlb-label-case')
    expect(themeTokens['label-tracking']).toBe('--vmlb-label-tracking')
  })

  it('has no hardcoded rem or em font size in a component or stylesheet', () => {
    const offenders = sourceFiles(join(__dirname, '../src')).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, i) => ({ line: line.trim(), at: `${file.split('/src/')[1]}:${i + 1}` }))
        .filter(({ line }) => /font-size:\s*[\d.]+r?em\b/.test(line) && !line.startsWith('--vmlb-'))
        .map(({ at, line }) => `${at}  ${line}`),
    )
    expect(offenders).toEqual([])
  })

  // legal-annotation-kit renders inside .vmlb-kit; its text sizes and label case
  // must follow the builder's scale too (BAIGLE #154).
  it.each(['2xs', 'xs', 'sm', 'md', 'base'])('maps the kit\'s --lak-font-size-%s onto the builder scale', (size) => {
    const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8')
    expect(css).toContain(`--lak-font-size-${size}: var(--vmlb-font-size-${size});`)
  })

  it('maps the kit\'s label case and tracking onto the builder tokens', () => {
    const css = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8')
    expect(css).toContain('--lak-label-case: var(--vmlb-label-case);')
    expect(css).toContain('--lak-label-tracking: var(--vmlb-label-tracking);')
  })

  it('takes every uppercase label from the label-case token', () => {
    const offenders = sourceFiles(join(__dirname, '../src')).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => /text-transform:\s*uppercase/.test(line))
        .map((line) => `${file.split('/src/')[1]}  ${line.trim()}`),
    )
    expect(offenders).toEqual([])
  })
})
