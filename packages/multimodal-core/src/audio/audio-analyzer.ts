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
  private mode: 'linear' | 'minmax' | 'rms' = 'rms'
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
      switch (this.mode) {
        case 'linear': {
          this._volumeLevel = linearNormalize(this.dataArray)
          break
        }
        case 'minmax': {
          this._volumeLevel = minMaxNormalize(this.dataArray)
          break
        }
        case 'rms': {
          this._volumeLevel = Math.min(100, (rms(this.dataArray) / 255) * 100 * this.amplification)
          break
        }
      }

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

function linearNormalize(buf: Uint8Array): number {
  const volumeVector: Array<number> = []
  for (let i = 0; i < 700; i += 80)
    volumeVector.push(buf[i])

  const volumeSum = buf
    // The volume changes flatten-ly, while the volume is often low, therefore we need to amplify it.
    // Applying a power function to amplify the volume is helpful, for example:
    // v ** 1.2 will amplify the volume by 1.2 times
    .map(v => v ** 1.2)
    // Scale up the volume values to make them more distinguishable
    .map(v => v * 1.2)
    .reduce((acc, cur) => acc + cur, 0)

  return (volumeSum / buf.length / 100)
}

function minMaxNormalize(buf: Uint8Array) {
  const volumeVector: Array<number> = []
  for (let i = 0; i < 700; i += 80)
    volumeVector.push(buf[i])

  // The volume changes flatten-ly, while the volume is often low, therefore we need to amplify it.
  // We can apply a power function to amplify the volume, for example
  // v ** 1.2 will amplify the volume by 1.2 times
  const amplifiedVolumeVector = buf.map(v => v ** 1.5)

  // Normalize the amplified values using Min-Max scaling
  const min = Math.min(...amplifiedVolumeVector)
  const max = Math.max(...amplifiedVolumeVector)
  const range = max - min

  let normalizedVolumeVector
  if (range === 0) {
    // If range is zero, all values are the same, so normalization is not needed
    normalizedVolumeVector = amplifiedVolumeVector.map(() => 0) // or any default value
  }
  else {
    normalizedVolumeVector = amplifiedVolumeVector.map(v => (v - min) / range)
  }

  // Aggregate the volume values
  const volumeSum = normalizedVolumeVector.reduce((acc, cur) => acc + cur, 0)

  // Average the volume values
  return volumeSum / buf.length
}
function rms(buf: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < buf.length; i++) {
    sum += buf[i] * buf[i]
  }
  return Math.sqrt(sum / buf.length)
}
