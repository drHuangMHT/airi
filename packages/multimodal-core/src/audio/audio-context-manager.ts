/**
 * Singleton wrapper for the Web Audio API AudioContext.
 * Use `AudioContextManager.getInstance()` to get the shared instance.
 */
export class AudioContextManager {
  private static _instance: AudioContext | null = null

  /**
   * Returns the shared AudioContext instance.
   * Creates it lazily if it doesn't exist or has been closed.
   */
  public static get instance(): AudioContext {
    // If the instance is null or closed, create a new one
    if (!AudioContextManager._instance || AudioContextManager._instance.state === 'closed') {
      AudioContextManager._instance = new AudioContext()
    }
    return AudioContextManager._instance
  }

  public static get state(): AudioContextState {
    const ctx = AudioContextManager.instance
    return ctx ? ctx.state : 'closed'
  }

  /** Resumes the shared AudioContext if it is suspended. */
  public static async resume(): Promise<void> {
    const ctx = AudioContextManager.instance
    if (ctx.state === 'suspended') {
      await ctx.resume()
    }
  }

  /**
   * Closes the shared AudioContext and releases its resources.
   * After calling this, the next `getInstance()` will create a new context.
   */
  public static async close(): Promise<void> {
    const ctx = AudioContextManager.instance
    if (ctx && ctx.state !== 'closed') {
      await ctx.close()
      AudioContextManager._instance = null
    }
  }
}
