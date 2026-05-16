import type { ManifestAsset } from '../schema/manifestTypes'
import type {
  ValidationReport,
  ValidationSignal,
  ValidationSignalGroup,
  ValidationSignalSeverity,
  ValidationSignalSource,
  ValidationStage,
  ValidationStep,
} from '../schema/validationTypes'

type CreateSignalOptions = {
  blocking?: boolean
  checkName?: string
  details?: string
  group?: ValidationSignalGroup
  path?: string
  refs?: Record<string, string>
  severity?: ValidationSignalSeverity
  source?: ValidationSignalSource
  stage?: ValidationStage
  dedupeKey?: string
}

type CreateReportOptions = {
  asset: ManifestAsset | null
  committed?: boolean
  signals: readonly ValidationSignal[]
  skippedStages?: ReadonlySet<ValidationStage>
  stages?: readonly ValidationStage[]
}

const validationStageLabels: Record<ValidationStage, string> = {
  baseline_qc: 'Run baseline QC',
  build: 'Build candidate geometry',
  checks: 'Run authored checks',
  commit: 'Commit validated asset',
  export: 'Check export readiness',
  schema: 'Parse Manifest3D schema',
  structure: 'Check asset structure',
}

export const coreValidationStages: readonly ValidationStage[] = [
  'schema',
  'structure',
  'build',
  'baseline_qc',
  'checks',
  'export',
]

export function createValidationSignal(
  kind: string,
  code: string,
  summary: string,
  options: CreateSignalOptions = {},
): ValidationSignal {
  const severity = options.severity ?? 'failure'

  return {
    blocking: options.blocking ?? severity === 'failure',
    code,
    group: options.group ?? defaultGroup(options.stage, options.source),
    id: '',
    kind,
    severity,
    source: options.source ?? defaultSource(options.stage),
    stage: options.stage ?? 'structure',
    summary,
    ...(options.checkName ? { checkName: options.checkName } : {}),
    ...(options.dedupeKey ? { dedupeKey: options.dedupeKey } : {}),
    ...(options.details ? { details: options.details } : {}),
    ...(options.path ? { path: options.path } : {}),
    ...(options.refs ? { refs: options.refs } : {}),
  }
}

export function createValidationReport({
  asset,
  committed = false,
  signals,
  skippedStages = new Set<ValidationStage>(),
  stages = coreValidationStages,
}: CreateReportOptions): ValidationReport {
  const numberedSignals = signals.map((signal, index) => ({
    ...signal,
    id: `${signal.stage}:${signal.code}:${index + 1}`,
  }))
  const summary = {
    failureCount: numberedSignals.filter((signal) => signal.severity === 'failure')
      .length,
    noteCount: numberedSignals.filter((signal) => signal.severity === 'note')
      .length,
    warningCount: numberedSignals.filter((signal) => signal.severity === 'warning')
      .length,
  }
  const status = summary.failureCount > 0 ? 'failure' : 'success'
  const bundleSummary =
    status === 'failure'
      ? `status=failure failures=${summary.failureCount} warnings=${summary.warningCount} notes=${summary.noteCount}`
      : summary.warningCount > 0
        ? `status=success failures=0 warnings=${summary.warningCount} notes=${summary.noteCount}`
        : `status=success failures=0 warnings=0 notes=${summary.noteCount}`

  return {
    assetId: asset?.id ?? null,
    assetName: asset?.name ?? null,
    bundle: {
      signals: numberedSignals,
      status,
      summary: bundleSummary,
    },
    committed,
    id: `validation:${asset?.id ?? 'candidate'}`,
    steps: stages.map((stage) =>
      createValidationStep(stage, numberedSignals, skippedStages),
    ),
    summary,
    valid: status === 'success',
  }
}

export function hasBlockingSignals(
  signals: readonly ValidationSignal[],
  stages?: readonly ValidationStage[],
) {
  const stageSet = stages ? new Set(stages) : null

  return signals.some(
    (signal) =>
      signal.blocking &&
      signal.severity === 'failure' &&
      (!stageSet || stageSet.has(signal.stage)),
  )
}

export function withCommitStep(
  report: ValidationReport,
  committed: boolean,
): ValidationReport {
  const commitStep: ValidationStep = {
    id: 'commit',
    label: validationStageLabels.commit,
    signalIds: [],
    stage: 'commit',
    status: committed ? 'passed' : 'skipped',
  }

  return {
    ...report,
    committed,
    steps: [...report.steps, commitStep],
  }
}

function createValidationStep(
  stage: ValidationStage,
  signals: readonly ValidationSignal[],
  skippedStages: ReadonlySet<ValidationStage>,
): ValidationStep {
  const stageSignals = signals.filter((signal) => signal.stage === stage)
  const signalIds = stageSignals.map((signal) => signal.id)
  let status: ValidationStep['status'] = 'passed'

  if (skippedStages.has(stage)) {
    status = 'skipped'
  } else if (stageSignals.some((signal) => signal.severity === 'failure')) {
    status = 'failed'
  } else if (stageSignals.some((signal) => signal.severity === 'warning')) {
    status = 'warning'
  }

  return {
    id: stage,
    label: validationStageLabels[stage],
    signalIds,
    stage,
    status,
  }
}

function defaultSource(stage: ValidationStage | undefined): ValidationSignalSource {
  switch (stage) {
    case 'schema':
      return 'schema'
    case 'baseline_qc':
      return 'baseline_qc'
    case 'checks':
      return 'checks'
    case 'export':
      return 'export'
    case 'build':
    case 'commit':
      return 'harness'
    case 'structure':
    case undefined:
      return 'validator'
    default:
      return assertNever(stage)
  }
}

function defaultGroup(
  stage: ValidationStage | undefined,
  source: ValidationSignalSource | undefined,
): ValidationSignalGroup {
  if (source === 'checks') {
    return 'design'
  }

  switch (stage) {
    case 'schema':
    case 'build':
    case 'export':
    case 'commit':
      return 'build'
    case 'structure':
      return 'hygiene'
    case 'baseline_qc':
      return 'qc'
    case 'checks':
      return 'design'
    case undefined:
      return 'qc'
    default:
      return assertNever(stage)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported validation stage: ${value}`)
}
