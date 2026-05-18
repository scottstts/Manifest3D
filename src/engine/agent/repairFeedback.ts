import type {
  ValidationSignal,
  ValidationSignalBundle,
  ValidationStage,
} from '../schema/validationTypes'

export type RenderValidationFeedbackOptions = {
  failureStreak?: number
  repeated?: boolean
}

const stagePriority: Record<ValidationStage, number> = {
  schema: 0,
  structure: 1,
  build: 2,
  baseline_qc: 3,
  checks: 4,
  sampled_poses: 5,
  export: 6,
  commit: 7,
}

const kindPriority: Record<string, number> = {
  schema_parse: 0,
  single_root_policy: 1,
  model_validity: 2,
  compile_runtime: 3,
  mesh_assets: 4,
  isolated_part: 5,
  real_overlap: 6,
  sampled_pose_overlap: 7,
  missing_exact_geometry: 8,
  exact_contact_gap: 9,
  authored_check: 10,
}

const maxRenderedFailures = 32
const maxRenderedWarnings = 16
const maxRenderedNotes = 16
const maxRenderedSignalsPerGroup = 2

export function renderValidationSignals(
  bundle: ValidationSignalBundle,
  options: RenderValidationFeedbackOptions = {},
): string {
  const repeated = options.repeated ?? false
  const failureStreak = options.failureStreak ?? 1
  const signals = dedupeSignals(bundle.signals)
  const failures = orderFailureSignals(
    signals.filter((signal) => signal.severity === 'failure'),
  )
  const warnings = signals.filter((signal) => signal.severity === 'warning')
  const notes = signals.filter((signal) => signal.severity === 'note')
  const summary = renderSummary(bundle.summary, {
    failureStreak,
    hasFailures: failures.length > 0,
    repeated,
  })
  const parts = ['<validation_signals>', '<summary>', summary, '</summary>']

  if (failures.length > 0) {
    parts.push(
      '',
      '<failures>',
      renderSignalSection('Failures (blocking):', failures, {
        maxSignals: maxRenderedFailures,
      }),
      '</failures>',
    )
  }

  if (warnings.length > 0) {
    parts.push(
      '',
      '<warnings>',
      renderSignalSection('Warnings (non-blocking):', warnings, {
        maxSignals: maxRenderedWarnings,
      }),
      '</warnings>',
    )
  }

  if (notes.length > 0) {
    parts.push(
      '',
      '<notes>',
      renderSignalSection('Notes (informational):', notes, {
        maxSignals: maxRenderedNotes,
      }),
      '</notes>',
    )
  }

  const responseRules = responseRulesForFailures(failures, {
    failureStreak,
    includeWarningNote: warnings.length > 0,
    repeated,
  })

  if (responseRules.length > 0) {
    parts.push(
      '',
      '<response_rules>',
      `Suggested next steps:\n${responseRules.join('\n')}`,
      '</response_rules>',
    )
  }

  parts.push('</validation_signals>')

  return parts.join('\n')
}

function renderSummary(
  summary: string,
  options: {
    failureStreak: number
    hasFailures: boolean
    repeated: boolean
  },
) {
  const lines = [summary]

  if (options.repeated && options.hasFailures) {
    lines.push('This failure matches the previous validation attempt.')
  }

  if (options.failureStreak >= 3 && options.hasFailures) {
    lines.push(`This is validation failure ${options.failureStreak} in a row.`)
  }

  return lines.join('\n')
}

function renderSignalSection(
  heading: string,
  signals: readonly ValidationSignal[],
  options: {
    maxSignals: number
  },
) {
  const compacted = compactSignalSection(signals, options.maxSignals)
  const renderedLines = compacted.signals.map(renderSignalLine)

  if (compacted.omittedCount > 0) {
    renderedLines.push(renderOmittedSignalSummary(compacted))
  }

  return `${heading}\n${renderedLines.join('\n')}`
}

function renderSignalLine(signal: ValidationSignal) {
  const lines = [
    `- ${signal.severity.toUpperCase()} [${signal.kind}/${signal.code}] ${signal.summary}`,
  ]

  if (signal.path) {
    lines.push(`  path=${signal.path}`)
  }

  if (signal.checkName) {
    lines.push(`  check=${signal.checkName}`)
  }

  if (signal.refs && Object.keys(signal.refs).length > 0) {
    lines.push(`  refs=${formatRefs(signal.refs)}`)
  }

  if (signal.details) {
    lines.push(`  details=${indentMultiline(signal.details)}`)
  }

  return lines.join('\n')
}

function orderFailureSignals(signals: readonly ValidationSignal[]) {
  return [...signals].sort((left, right) => {
    const stageDelta = stagePriority[left.stage] - stagePriority[right.stage]

    if (stageDelta !== 0) {
      return stageDelta
    }

    const kindDelta =
      getKindPriority(left.kind) - getKindPriority(right.kind)

    if (kindDelta !== 0) {
      return kindDelta
    }

    return left.code.localeCompare(right.code)
  })
}

function compactSignalSection(
  signals: readonly ValidationSignal[],
  maxSignals: number,
) {
  const groupCounts = new Map<string, number>()
  const groupLabels = new Map<string, string>()
  const renderedGroupCounts = new Map<string, number>()
  const compactedSignals: ValidationSignal[] = []
  let omittedCount = 0

  for (const signal of signals) {
    const key = compactSignalKey(signal)

    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1)
    groupLabels.set(key, compactSignalLabel(signal))
  }

  for (const signal of signals) {
    const key = compactSignalKey(signal)
    const renderedGroupCount = renderedGroupCounts.get(key) ?? 0
    const canRender =
      compactedSignals.length < maxSignals &&
      renderedGroupCount < maxRenderedSignalsPerGroup

    if (!canRender) {
      omittedCount += 1
      continue
    }

    compactedSignals.push(signal)
    renderedGroupCounts.set(key, renderedGroupCount + 1)
  }

  const omittedGroups = [...groupCounts.entries()]
    .map(([key, count]) => ({
      count,
      key,
      label: groupLabels.get(key) ?? key,
      omitted: count - (renderedGroupCounts.get(key) ?? 0),
    }))
    .filter((group) => group.omitted > 0)
    .sort((left, right) => right.omitted - left.omitted)

  return {
    omittedCount,
    omittedGroups,
    signals: compactedSignals,
    totalCount: signals.length,
  }
}

function renderOmittedSignalSummary({
  omittedCount,
  omittedGroups,
  totalCount,
}: ReturnType<typeof compactSignalSection>) {
  const groups = omittedGroups
    .slice(0, 8)
    .map((group) => `${group.label} x${group.omitted}`)
    .join('; ')
  const suffix = omittedGroups.length > 8
    ? `; ${omittedGroups.length - 8} more groups`
    : ''

  return [
    `- Omitted ${omittedCount} of ${totalCount} similar signals to keep repair feedback compact.`,
    groups ? `  omittedGroups=${groups}${suffix}` : null,
    '  Repair the repeated pattern globally; the listed signals are representative examples with concrete refs.',
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function compactSignalKey(signal: ValidationSignal) {
  return [
    signal.severity,
    signal.stage,
    signal.kind,
    signal.code,
    signal.summary,
  ].join('|')
}

function compactSignalLabel(signal: ValidationSignal) {
  return `[${signal.stage}/${signal.code}] ${signal.summary}`
}

function dedupeSignals(signals: readonly ValidationSignal[]) {
  const deduped = new Map<string, ValidationSignal>()

  for (const signal of signals) {
    const key =
      signal.dedupeKey ??
      [
        signal.severity,
        signal.source,
        signal.stage,
        signal.kind,
        signal.code,
        signal.path ?? '',
        signal.summary,
        signal.details ?? '',
        formatRefs(signal.refs ?? {}),
      ].join('|')

    if (!deduped.has(key)) {
      deduped.set(key, signal)
    }
  }

  return [...deduped.values()]
}

function responseRulesForFailures(
  failures: readonly ValidationSignal[],
  options: {
    failureStreak: number
    includeWarningNote: boolean
    repeated: boolean
  },
) {
  if (failures.length === 0) {
    return options.includeWarningNote
      ? [
          '- Warnings are not blocking, but they are design evidence and should not be ignored.',
        ]
      : []
  }

  const primary = failures[0]
  const allowanceRule =
    '- If an overlap or isolated part is intentional, add or correct explicit scoped allowances with concrete reasons; otherwise fix the support path, mount, geometry, or pose.'
  let rules: string[]

  if (primary.source === 'schema' || primary.stage === 'schema') {
    rules = [
      '- Fix the JSON shape first. Schema failures block structural, geometry, QC, and authored-check feedback.',
      '- Preserve strict Manifest3D JSON only; do not include prose, comments, markdown fences, or generated code.',
    ]
  } else if (
    primary.stage === 'structure' ||
    primary.kind === 'single_root_policy' ||
    primary.kind === 'model_validity'
  ) {
    rules = [
      '- Fix ids, references, roots, cycles, and joint semantics before tuning local geometry.',
      '- Keep the joint graph as the assembly source of truth: exactly one root part and one parent joint for every non-root part.',
      '- Preserve stable part, visual, joint, and material ids unless you also update every dependent check and allowance.',
    ]
  } else if (primary.stage === 'build' || primary.kind === 'compile_runtime') {
    rules = [
      '- Fix geometry descriptors and transform data before interpreting baseline QC or authored-check failures.',
      '- Keep dimensions finite and positive, and keep visual transforms local to their owning part.',
    ]
  } else if (primary.kind === 'isolated_part') {
    rules = [
      '- Fix the floating or disconnected part before tuning secondary authored checks.',
      '- Add or correct a physical support path through touching bounds, mounts, or fixed joints when the part should be attached.',
      allowanceRule,
    ]
  } else if (primary.kind === 'real_overlap') {
    rules = [
      '- Decide whether the current-pose overlap is intentional embedding or an unintended collision.',
      '- For unintended collisions, change geometry, placement, or rest joint origins while preserving prompt-critical visible form.',
      '- For intentional simplified fits, prefer exact visual-pair allowances and pair them with prompt checks that prove the intended relationship.',
      allowanceRule,
    ]
  } else if (
    primary.kind === 'sampled_pose_overlap' ||
    primary.stage === 'sampled_poses'
  ) {
    rules = [
      '- Repair the articulated pose that failed, not only the rest pose.',
      '- Adjust joint origins, axes, limits, child-part placement, or geometry clearance so the mechanism works through its sampled motion.',
      '- Keep pose-specific checks when they prove prompt-critical open, extended, rotated, or retained states.',
      allowanceRule,
    ]
  } else if (primary.kind === 'missing_exact_geometry') {
    rules = [
      '- Treat missing exact geometry as a stable-id contract failure, not a placement failure.',
      '- Restore the referenced part, visual, or joint id, or update the dependent check in the same candidate.',
    ]
  } else if (primary.kind === 'exact_contact_gap') {
    rules = [
      '- Verify that the authored check targets the correct part or visual pair before changing dimensions.',
      '- If the pair is correct, adjust placement or geometry; do not blindly relax tolerances.',
    ]
  } else if (primary.source === 'checks') {
    rules = [
      '- Repair prompt-critical authored checks after schema, structure, build, and baseline QC are clean.',
      '- Change the model geometry or update stale exact-check refs; do not delete checks that prove requested relationships.',
    ]
  } else {
    rules = [
      '- Failures are blocking. Classify the primary failure before adding new geometry or tests.',
      '- Prefer the smallest candidate change that fixes the reported contract while preserving existing stable ids.',
    ]
  }

  if (options.includeWarningNote) {
    rules.push(
      '- Warnings are not blocking, but they are design evidence and should not be ignored.',
    )
  }

  if (
    options.repeated &&
    (primary.kind === 'real_overlap' || primary.kind === 'isolated_part')
  ) {
    rules.push(
      '- This failure class repeated. Reconsider the support or overlap representation instead of making another small tolerance tweak.',
    )
  }

  if (options.failureStreak >= 3) {
    rules.push(
      '- You are in a repair loop. Re-read the primary failure, paths, refs, and allowances before producing the next candidate.',
    )
  }

  return rules
}

function getKindPriority(kind: string) {
  return kindPriority[kind] ?? 100
}

function formatRefs(refs: Record<string, string>) {
  return Object.keys(refs)
    .sort()
    .map((key) => `${key}=${refs[key]}`)
    .join(' ')
}

function indentMultiline(value: string) {
  return value.split('\n').join('\n  ')
}
