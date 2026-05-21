/**
 * Centralized constants for the inference pipeline.
 *
 * Model IDs, timeout values, and retry parameters shared across
 * all adapters and workers.
 */

// ---------------------------------------------------------------------------
// Model IDs
// ---------------------------------------------------------------------------

/** HuggingFace model repository identifiers */
export const MODEL_IDS = {
  KOKORO: 'onnx-community/Kokoro-82M-v1.0-ONNX',
  WHISPER: 'onnx-community/whisper-large-v3-turbo',
  BG_REMOVAL: 'Xenova/modnet',
} as const

/** Short model identifiers used in adapter state tracking and logging */
export const MODEL_NAMES = {
  KOKORO: 'kokoro-82m',
  WHISPER: 'whisper-large-v3-turbo',
  BG_REMOVAL: 'modnet',
} as const

// ---------------------------------------------------------------------------
// Timeouts (ms)
// ---------------------------------------------------------------------------

export const TIMEOUTS = {
  /** Kokoro model load timeout */
  KOKORO_LOAD: 120_000,
  /** Kokoro audio generation timeout */
  KOKORO_GENERATE: 120_000,

  /** Whisper model load timeout (larger model, allow more time) */
  WHISPER_LOAD: 180_000,
  /** Whisper transcription timeout */
  WHISPER_TRANSCRIBE: 120_000,

  /** Background removal model load timeout */
  BG_REMOVAL_LOAD: 120_000,
  /** Background removal per-image processing timeout */
  BG_REMOVAL_PROCESS: 60_000,
} as const

// ---------------------------------------------------------------------------
// Restart / Retry
// ---------------------------------------------------------------------------

/** Maximum number of automatic worker restarts before giving up */
export const MAX_RESTARTS = 3

/** Base delay in ms between restart attempts (multiplied by attempt number) */
export const RESTART_DELAY_MS = 1_000

// ---------------------------------------------------------------------------
// Device loss resilience
// ---------------------------------------------------------------------------

/**
 * Number of WebGPU device-loss events an adapter tolerates before proactively
 * promoting subsequent loads to WASM. A single device loss may be transient
 * (driver reset, GPU process crash), but repeated losses indicate the WebGPU
 * path is unreliable on this device and WASM is safer.
 */
export const DEVICE_LOSS_WASM_THRESHOLD = 2

// ---------------------------------------------------------------------------
// Default priorities
// ---------------------------------------------------------------------------

export const LOAD_PRIORITY = {
  TTS: 10,
  ASR: 5,
  BACKGROUND_REMOVAL: 1,
} as const

// Rough VRAM estimates per model (in bytes) for allocation tracking
export const MODEL_VRAM_ESTIMATES: Record<string, number> = {
  // Kokoro 82M — varies by quantization
  'kokoro-fp32-webgpu': 330 * 1024 * 1024, // ~330 MB
  'kokoro-fp16-webgpu': 165 * 1024 * 1024, // ~165 MB
  'kokoro-fp32': 330 * 1024 * 1024,
  'kokoro-fp16': 165 * 1024 * 1024,
  'kokoro-q8': 82 * 1024 * 1024,
  'kokoro-q4': 41 * 1024 * 1024,
  'kokoro-q4f16': 41 * 1024 * 1024,

  // Whisper large v3 turbo — encoder fp16 + decoder q4
  [MODEL_NAMES.WHISPER]: 800 * 1024 * 1024, // ~800 MB

  // Xenova/modnet — small model
  [MODEL_NAMES.BG_REMOVAL]: 25 * 1024 * 1024, // ~25 MB
}
