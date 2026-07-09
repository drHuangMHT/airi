import { afterEach, describe, expect, it } from 'vitest'

import { useLlmmarkerParser } from './llm-marker-parser'

// parser and collected results are resetted on every test
let { parser, collectedLiterals, collectedSpecials } = createParser()

describe('useLlmmarkerParser', () => {
  it('parses pure literals', async () => {
    const fullText = 'Hello, world!'
    await parserPass(fullText)

    expect(collectedLiterals.join('')).toBe(fullText)
    expect(collectedSpecials).toEqual([])
  })

  it('parses pure marker', async () => {
    const marker = '<|Hello, world!|>'
    await parserPass(marker)

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([marker])
  })

  it('should parse escaped literal as special marker', async () => {
    const markerWithEscape = `<{'|'}Hello, world!{'|'}>`
    await parserPass(markerWithEscape)

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([markerWithEscape])
  })

  // `<|...|>` markers are emitted as special output.
  it('parses special markers separately from literals', async () => {
    const fullText = 'Hello <|ACT|> world'
    await parserPass(fullText)

    expect(collectedLiterals.join('')).toBe('Hello  world')
    expect(collectedSpecials).toEqual(['<|ACT|>'])
  })

  // markers are withheld instead of leaking into literal text when not closed.
  it('should not include unfinished special markers', async () => {
    const unfinishedMarker = '<|unfinished'
    await parserPass(unfinishedMarker)

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([])
  })

  it('should not include unfinished escaped special', async () => {
    const unfinishedMarkerWithEscape = `<{'|'}Hello, world`
    await parserPass(unfinishedMarkerWithEscape)

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([])
  })

  it('should parse with mixed input, ends with special', async () => {
    const fullText = 'This is sentence 1, <|HELLO|> and this is sentence 2.<|WORLD|>'
    await parserPass(fullText)

    expect(collectedLiterals.join('')).toBe('This is sentence 1,  and this is sentence 2.')
    expect(collectedSpecials).toEqual(['<|HELLO|>', '<|WORLD|>'])
  })

  it('should parse with mixed input, ends with escaped special', async () => {
    const fullText = 'This is sentence 1, <{\'|\'}HELLO{\'|\'}> and this is sentence 2.<{\'|\'}WORLD{\'|\'}>'
    await parserPass(fullText)

    expect(collectedLiterals.join('')).toBe('This is sentence 1,  and this is sentence 2.')
    expect(collectedSpecials).toEqual(['<|HELLO|>', '<|WORLD|>'])
  })

  it('should parse the test vectors correctly', async () => {
    const testCases: { input: string, expectedLiterals: string, expectedSpecials: string[] }[] = [
      {
        input: `<|A|> Wow, hello there!`,
        expectedLiterals: ' Wow, hello there!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: `<|A|> Hello!`,
        expectedLiterals: ' Hello!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: `<|A|> Hello! <|B|>`,
        expectedLiterals: ' Hello! ',
        expectedSpecials: ['<|A|>', '<|B|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Wow, hello there!',
        expectedLiterals: ' Wow, hello there!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Hello!',
        expectedLiterals: ' Hello!',
        expectedSpecials: ['<|A|>'],
      },
      {
        input: '<{\'|\'}A{\'|\'}> Hello! <{\'|\'}B{\'|\'}>',
        expectedLiterals: ' Hello! ',
        expectedSpecials: ['<|A|>', '<|B|>'],
      },
    ]

    for (const tc of testCases) {
      const { input, expectedLiterals, expectedSpecials } = tc
      const collectedLiterals: string[] = []
      const collectedSpecials: string[] = []

      const parser = useLlmmarkerParser({
        onLiteral(literal) {
          collectedLiterals.push(literal)
        },
        onSpecial(special) {
          collectedSpecials.push(special)
        },
      })

      for (const char of input) {
        await parser.consume(char)
      }

      await parser.end()

      expect(collectedLiterals.join('')).toBe(expectedLiterals)
      expect(collectedSpecials).toEqual(expectedSpecials)
    }
  })

  it('should call onEnd with full text', async () => {
    const fullText = 'Hello, world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })

  it('should call onEnd with full text including specials', async () => {
    const fullText = 'Hello <|special|> world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })

  it('should call onEnd with full text including escaped specials', async () => {
    const fullText = 'Hello <{\'|\'}special{\'|\'}> world!'
    let endText = ''

    const parser = useLlmmarkerParser({
      onEnd(text) {
        endText = text
      },
    })

    for (const char of fullText) {
      await parser.consume(char)
    }

    await parser.end()

    expect(endText).toBe(fullText)
  })
})

function createParser() {
  const collectedLiterals: string[] = []
  const collectedSpecials: string[] = []
  const parser = useLlmmarkerParser({
    onLiteral: literal => void collectedLiterals.push(literal),
    onSpecial: special => void collectedSpecials.push(special),
  })
  return { parser, collectedLiterals, collectedSpecials }
}

afterEach(() => {
  const { parser: newP, collectedLiterals: newL, collectedSpecials: newS } = createParser()
  parser = newP
  collectedLiterals = newL
  collectedSpecials = newS
})

async function parserPass(text: string) {
  for (const char of text) { // simulate streaming input
    await parser.consume(char)
  }
  await parser.end()
}
