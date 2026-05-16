export type ValidationStage =
  | 'schema'
  | 'structure'
  | 'build'
  | 'baseline_qc'
  | 'checks'
  | 'export'
  | 'commit'

export type ValidationSignalSeverity = 'failure' | 'warning' | 'note'

export type ValidationSignalSource =
  | 'schema'
  | 'validator'
  | 'baseline_qc'
  | 'checks'
  | 'harness'
  | 'export'

export type ValidationSignalGroup = 'build' | 'qc' | 'design' | 'hygiene'

export type ValidationStepStatus =
  | 'passed'
  | 'warning'
  | 'failed'
  | 'skipped'

export type ValidationSignal = {
  id: string
  severity: ValidationSignalSeverity
  kind: string
  code: string
  summary: string
  details?: string
  blocking: boolean
  source: ValidationSignalSource
  group: ValidationSignalGroup
  checkName?: string
  path?: string
  refs?: Record<string, string>
  dedupeKey?: string
  stage: ValidationStage
}

export type ValidationSignalBundle = {
  status: 'success' | 'failure'
  summary: string
  signals: ValidationSignal[]
}

export type ValidationStep = {
  id: string
  signalIds: string[]
  label: string
  stage: ValidationStage
  status: ValidationStepStatus
}

export type ValidationReportSummary = {
  failureCount: number
  warningCount: number
  noteCount: number
}

export type ValidationReport = {
  assetId: string | null
  assetName: string | null
  bundle: ValidationSignalBundle
  committed: boolean
  id: string
  steps: ValidationStep[]
  summary: ValidationReportSummary
  valid: boolean
}
