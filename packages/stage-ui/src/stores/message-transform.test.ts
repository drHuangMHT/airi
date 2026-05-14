import type { MessageTransformer } from './message-transform'

import { describe, expect, it } from 'vitest'

import { Chained, concatText } from './message-transform'

describe('concatText', () => {
  it('should append to end of text when position is not provided', () => {
    const msg = { content: 'Hello' }
    const result = concatText(msg, ' World')
    expect(result.content).toBe('Hello World')
    expect(result).not.toBe(msg) // immutable
  })

  it('should append to start of text when position is 0', () => {
    const msg = { content: 'World' }
    const result = concatText(msg, 'Hello ', 0)
    expect(result.content).toBe('Hello World')
  })

  it('should insert when position is between 0 and max length', () => {
    const msg = { content: 'HelloWorld' }
    const result = concatText(msg, ',', 5)
    expect(result.content).toBe('Hello,World')
  })

  it('should clamp negative values to 0', () => {
    const msg = { content: 'World' }
    const result = concatText(msg, 'Hello ', -10)
    expect(result.content).toBe('Hello World')
  })

  it('should clamp out of bound values to content length', () => {
    const msg = { content: 'Hello' }
    const result = concatText(msg, ' World', 100)
    expect(result.content).toBe('Hello World')
  })

  it('should handle empty content', () => {
    const msg = { content: '' }
    const result = concatText(msg, 'test', 0)
    expect(result.content).toBe('test')
  })

  it('should not modify when text to insert is empty', () => {
    const msg = { content: 'Hello' }
    const result = concatText(msg, '', 2)
    expect(result.content).toBe('Hello')
  })

  it('should retain other properties of input message', () => {
    const msg = { content: 'Hi', role: 'user', createdAt: 123, id: 'abc' }
    const result = concatText(msg, '!', 2)
    expect(result.content).toBe('Hi!')
    expect(result.role).toBe('user')
    expect(result.createdAt).toBe(123)
    expect(result.id).toBe('abc')
  })

  it('should treat nullish value as append', () => {
    const msg = { content: 'Hello' }
    const resultUndefined = concatText(msg, ' World', undefined)
    expect(resultUndefined.content).toBe('Hello World')
    const resultNull = concatText(msg, ' World', null as any)
    expect(resultNull.content).toBe('Hello World')
  })
})

// ---------- ChainedTransformer ----------
describe('chainedTransformer', () => {
  const appendExclamation: MessageTransformer = {
    transform: async (message, context) => ({
      message: concatText(message, '!'),
      context,
    }),
  }

  it('should transform with one transformer', async () => {
    const t = new Chained(appendExclamation)
    const result = await t.transform({ content: 'Hello' }, {})
    expect(result.message.content).toBe('Hello!')
    expect(result.context).toEqual({})
  })

  it('should compose two transformers', async () => {
    const prependHello: MessageTransformer = {
      transform: async (message, context) => ({
        message: concatText(message, 'Hello ', 0),
        context: { ...context, step1: 'prepend' },
      }),
    }
    const appendWorld: MessageTransformer = {
      transform: async (message, context) => ({
        message: concatText(message, ' World'),
        context: { ...context, step2: 'append' },
      }),
    }
    const chain = new Chained(prependHello).then(appendWorld)
    const result = await chain.transform({ content: 'and' }, {})
    expect(result.message.content).toBe('Hello and World')
    expect(result.context).toEqual({ step1: 'prepend', step2: 'append' })
  })

  it('should compose three transformers', async () => {
    const addA: MessageTransformer = {
      transform: async (message, context) => ({
        message: concatText(message, 'A'),
        context: { ...context, order: [] },
      }),
    }
    const addB: MessageTransformer = {
      transform: async (message, context) => ({
        message: concatText(message, 'B'),
        context: { ...context, order: [...context.order as Array<string>, 'B'] },
      }),
    }
    const addC: MessageTransformer = {
      transform: async (message, context) => ({
        message: concatText(message, 'C'),
        context: { ...context, order: [...context.order as Array<string>, 'C'] },
      }),
    }
    const initOrder: MessageTransformer = {
      transform: async (message, context) => ({
        message,
        context: { ...context, order: [] },
      }),
    }
    const chain = new Chained(initOrder)
      .then(addA)
      .then(addB)
      .then(addC)
    const result = await chain.transform({ content: '' }, {})
    expect(result.message.content).toBe('ABC')
    expect(result.context.order).toEqual(['B', 'C'])
  })

  it('should run async transformers', async () => {
    const delayAppend: MessageTransformer = {
      transform: async (message, context) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { message: concatText(message, ' async'), context }
      },
    }
    const t = new Chained(delayAppend)
    const result = await t.transform({ content: 'test' }, {})
    expect(result.message.content).toBe('test async')
  })

  it('should not mutate original message and context', async () => {
    const originalMsg = { content: 'original' }
    const originalCtx = { key: 'value' }
    const modify: MessageTransformer = {
      transform: async (message, context) => ({
        message: concatText(message, ' modified'),
        context: { ...context, modified: true },
      }),
    }
    const t = new Chained(modify)
    await t.transform(originalMsg, originalCtx)
    expect(originalMsg.content).toBe('original')
    expect(originalCtx).toEqual({ key: 'value' })
  })

  it('should return new Chained instance when calling .then()', () => {
    const id: MessageTransformer = {
      transform: async (m, c) => ({ message: m, context: c }),
    }
    const t1 = new Chained(id)
    const t2 = t1.then(id)
    expect(t2).toBeInstanceOf(Chained)
    expect(t2).not.toBe(t1)
  })

  it('should handle "no transform" transformer', async () => {
    const add: MessageTransformer = {
      transform: async (message, context) => ({
        message: concatText(message, '!'),
        context: { ...context, done: true },
      }),
    }
    const identity: MessageTransformer = {
      transform: async (m, c) => ({ message: m, context: c }),
    }
    const chain = new Chained(add).then(identity)
    const result = await chain.transform({ content: 'Hi' }, {})
    expect(result.message.content).toBe('Hi!')
    expect(result.context).toEqual({ done: true })
  })

  it('should reject entire chain when transformer throws.', async () => {
    const errorFn: MessageTransformer = {
      transform: async () => {
        throw new Error('fail')
      },
    }
    const t = new Chained(errorFn)
    await expect(t.transform({ content: '' }, {})).rejects.toThrow('fail')
  })

  it('should reject entire chain when any transformer throws. ', async () => {
    const good: MessageTransformer = { transform: async (m, c) => ({ message: m, context: c }) }
    const bad: MessageTransformer = {
      transform: async () => {
        throw new Error('middle fail')
      },
    }
    const chain = new Chained(good).then(bad).then(good)
    await expect(chain.transform({ content: 'test' }, {})).rejects.toThrow('middle fail')
  })
})
