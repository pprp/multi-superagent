/** Validation bounds shared between host schemas and management panel forms. */
export const LIMITS = {
  ruleName: 100,
  ruleInstruction: 2000,
  evalTimeoutSeconds: { min: 30, max: 600 },
  maxWorkers: { min: 1, max: 16 },
  prepareCommand: 4000,
  promptMaxChars: { min: 1000, max: 1_000_000 },
  admissionContextMaxPages: { min: 1, max: 100 },
  admissionContextTimeoutMs: { min: 1, max: 90_000 },
} as const
/** GitHub `owner/name`, or empty; a `.` or `..` segment is refused so the value can never act as a relative path. */
export const REPOSITORY = /^((?!\.\.?\/)[A-Za-z0-9_.-]+\/(?!\.\.?$)[A-Za-z0-9_.-]+)?$/
