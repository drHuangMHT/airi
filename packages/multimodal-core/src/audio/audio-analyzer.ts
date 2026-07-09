interface AudioAnalyzerOptions {
  amplification?: number // default 3
  fftSize?: number // default 256
  smoothingTimeConstant?: number // default 0.3
}

export class AudioAnalyzer {
  private analyzer: AnalyserNode | null = null
  private dataArray: Uint8Array | null = null
  private frameRequest: number | null = null
  private amplification: number
  private fftSize: number
  private smoothingTimeConstant: number
  private _volumeLevel: number = 0
  private _error: string | null = null
  private onUpdateHooks: Array<(volumeLevel: number) => void | Promise<void>> = []

  constructor(options: AudioAnalyzerOptions = {}) {
    const { amplification = 3, fftSize = 256, smoothingTimeConstant = 0.3 } = options
    this.amplification = amplification
    this.fftSize = fftSize
    this.smoothingTimeConstant = smoothingTimeConstant
  }

  /** Current volume level (0–100). */
  get volumeLevel(): number {
    return this._volumeLevel
  }

  /** Last error message, if any. */
  get error(): string | null {
    return this._error
  }

  /**
   * Register a callback to be invoked on each volume update.
   * Returns an unsubscribe function.
   */
  onAnalyzerUpdate(callback: (volumeLevel: number) => void | Promise<void>): () => void {
    this.onUpdateHooks.push(callback)
    return () => {
      this.onUpdateHooks = this.onUpdateHooks.filter(cb => cb !== callback)
    }
  }

  /**
   * Starts the analysis loop. Called internally by startAnalyzer.
   */
  private start(): void {
    if (this.frameRequest)
      return

    const analyze = () => {
      if (!this.analyzer || !this.dataArray)
        return cancelAnimationFrame(this.frameRequest as any)

      this.analyzer.getByteFrequencyData(this.dataArray as any)

      let sum = 0
      for (let i = 0; i < this.dataArray.length; i++) {
        sum += this.dataArray[i] * this.dataArray[i]
      }
      const rms = Math.sqrt(sum / this.dataArray.length)
      this._volumeLevel = Math.min(100, (rms / 255) * 100 * this.amplification)

      for (const hook of this.onUpdateHooks) {
        try {
          const result = hook(this._volumeLevel)
          if (result instanceof Promise) {
            result.catch(err => console.error('Analyzer hook error:', err))
          }
        }
        catch (err) {
          console.error('Analyzer hook error:', err)
        }
      }

      this.frameRequest = requestAnimationFrame(analyze)
    }

    analyze()
  }

  /**
   * Initializes the analyser node and starts monitoring.
   * @param audioContext - A valid AudioContext instance.
   * @returns The created AnalyserNode, or undefined if an error occurred.
   */
  startAnalyzer(audioContext: AudioContext): AnalyserNode | undefined {
    if (!audioContext) {
      throw new Error('AudioContext is not initialized')
    }
    this._error = null
    try {
      this.analyzer = audioContext.createAnalyser()
      this.analyzer.fftSize = this.fftSize
      this.analyzer.smoothingTimeConstant = this.smoothingTimeConstant

      const bufferLength = this.analyzer.frequencyBinCount
      this.dataArray = new Uint8Array(bufferLength)

      this.start()

      return this.analyzer
    }
    catch (err) {
      console.error('Error setting up audio monitoring:', err)
      this._error = err instanceof Error ? err.message : String(err)
      return undefined
    }
  }

  /**
   * Stops the analysis loop and clears resources.
   */
  stopAnalyzer(): void {
    if (this.frameRequest !== null) {
      cancelAnimationFrame(this.frameRequest)
      this.frameRequest = null
    }
    this.analyzer = null
    this.dataArray = null
  }
}
