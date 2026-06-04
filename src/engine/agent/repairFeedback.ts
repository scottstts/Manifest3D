import type {
  ValidationSignal,
  ValidationSignalBundle,
  ValidationStage,
} from '../schema/validationTypes'
import type { ManifestProbeReport } from '../validation/probeReport'
import type { ValidationFailureCluster } from './failureClusters'

export type RenderValidationFeedbackOptions = {
  candidateFingerprint?: string
  failureClusters?: readonly ValidationFailureCluster[]
  failureStreak?: number
  probeReport?: ManifestProbeReport | null
  relationLoopHints?: readonly string[]
  repeated?: boolean
  revision?: number
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
  mechanical_fit: 6,
  mechanical_relation_coverage: 7,
  real_overlap: 8,
  sampled_pose_overlap: 9,
  missing_exact_geometry: 10,
  exact_contact_gap: 11,
  path_contact_fit: 12,
  authored_check: 13,
}

const maxRenderedFailures = 32
const maxRenderedWarnings = 16
const maxRenderedNotes = 16
const maxRenderedSignalsPerGroup = 2
const maxRenderedVisualHotspots = 6
const maxRenderedVisualPairHotspots = 10
const maxRenderedDetailsLength = 560
const maxRenderedRefValueLength = 160
const guidedInnerTerms = [
  'carriage',
  'piston',
  'plunger',
  'slider',
  'sleeve',
  'valve',
]
const guidedOuterTerms = [
  'bore',
  'channel',
  'cylinder',
  'guide',
  'guideway',
  'liner',
  'rail',
  'sleeve',
  'slot',
]
const shaftInnerTerms = [
  'axle',
  'crank pin',
  'crank-pin',
  'journal',
  'pin',
  'shaft',
  'spindle',
  'wrist pin',
  'wrist-pin',
]
const bearingOuterTerms = [
  'bearing',
  'boss',
  'bushing',
  'collar',
  'hub',
  'mount',
  'socket',
  'support',
]
const insertedInnerTerms = [
  'bearing',
  'bushing',
  'collar',
  'guide rail',
  'hub',
  'insert',
  'journal',
  'liner',
  'pin',
  'shaft',
  'sleeve',
]
const insertedOuterTerms = [
  'block',
  'boss',
  'bracket',
  'case',
  'crankcase',
  'frame',
  'head',
  'housing',
  'mount',
  'socket',
  'support',
]
const rodTerms = ['connecting rod', 'link arm', 'linkage', 'push rod', 'rod']
const rodEndpointTerms = ['big-eye', 'clevis', 'eye', 'socket', 'small-eye']
const couplerPinTerms = [
  'crank pin',
  'crank-pin',
  'journal',
  'pin',
  'wrist pin',
  'wrist-pin',
]
const routedPathTerms = [
  'belt',
  'cable',
  'chain',
  'hose',
  'loop',
  'rope',
  'strap',
  'track',
  'wire',
]
const routedPathSupportTerms = [
  'fitting',
  'gear',
  'guide',
  'pulley',
  'rim',
  'roller',
  'sprocket',
  'tensioner',
  'wheel',
]
const staticHousingTerms = [
  'bedplate',
  'block',
  'case',
  'crankcase',
  'frame',
  'guard',
  'head',
  'housing',
  'rail',
  'shell',
  'wall',
]
const movingMechanismTerms = [
  'blade',
  'chain',
  'crank',
  'gear',
  'piston',
  'rod',
  'rotor',
  'shaft',
  'sprocket',
  'turbine',
  'valve',
  'wheel',
]

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
  const repairContext = renderRepairContext(options)
  const failureClusters = options.failureClusters ?? []

  if (repairContext) {
    parts.push('', '<repair_context>', repairContext, '</repair_context>')
  }

  if (failureClusters.length > 0) {
    parts.push(
      '',
      '<failure_clusters>',
      renderFailureClusters(failureClusters),
      '</failure_clusters>',
    )
  }

  const highFailureRepairStrategy = renderHighFailureRepairStrategy(failures)

  if (highFailureRepairStrategy) {
    parts.push(
      '',
      '<repair_strategy>',
      highFailureRepairStrategy,
      '</repair_strategy>',
    )
  }

  const mechanicalContractSummary = renderMechanicalContractSummary(failures)

  if (mechanicalContractSummary) {
    parts.push(
      '',
      '<mechanical_contract_summary>',
      mechanicalContractSummary,
      '</mechanical_contract_summary>',
    )
  }

  const visualRelationHotspots = renderVisualRelationHotspots(failures)

  if (visualRelationHotspots) {
    parts.push(
      '',
      '<visual_relation_hotspots>',
      visualRelationHotspots,
      '</visual_relation_hotspots>',
    )
  }

  const mechanicalFitOverlapGuidance =
    renderMechanicalFitOverlapGuidance(failures)

  if (mechanicalFitOverlapGuidance) {
    parts.push(
      '',
      '<mechanical_fit_overlap_guidance>',
      mechanicalFitOverlapGuidance,
      '</mechanical_fit_overlap_guidance>',
    )
  }

  if (options.relationLoopHints && options.relationLoopHints.length > 0) {
    parts.push(
      '',
      '<relation_loop_hints>',
      options.relationLoopHints.map((hint) => `- ${hint}`).join('\n'),
      '</relation_loop_hints>',
    )
  }

  if (options.probeReport) {
    parts.push(
      '',
      '<probe_report>',
      renderProbeReport(options.probeReport),
      '</probe_report>',
    )
  }

  if (failures.length > 0) {
    parts.push(
      '',
      '<failures>',
      renderSignalSection('Failures (blocking):', failures, {
        maxSignals: getRenderedFailureLimit(failures.length),
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
        maxSignals: getRenderedNoteLimit({
          failureCount: failures.length,
          noteCount: notes.length,
        }),
      }),
      '</notes>',
    )
  }

  const responseRules = responseRulesForFailures(failures, {
    failureClusters,
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

function getRenderedFailureLimit(failureCount: number) {
  if (failureCount >= 100) {
    return 18
  }

  if (failureCount >= 50) {
    return 24
  }

  return maxRenderedFailures
}

function getRenderedNoteLimit({
  failureCount,
  noteCount,
}: {
  failureCount: number
  noteCount: number
}) {
  if (failureCount >= 50) {
    return Math.min(noteCount, 4)
  }

  if (failureCount > 0) {
    return Math.min(noteCount, 8)
  }

  return maxRenderedNotes
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

function renderRepairContext(options: RenderValidationFeedbackOptions) {
  const lines = [
    options.revision !== undefined
      ? `candidateRevision=${options.revision}`
      : null,
    options.candidateFingerprint
      ? `candidateFingerprint=${options.candidateFingerprint}`
      : null,
    '- The validation signals correspond to this exact candidate revision; any candidate change requires fresh validation before it can be accepted.',
    '- Return a focused JSON Patch against the current candidate; preserve unrelated stable ids and geometry.',
    '- Use the compact candidate JSON as the current source of truth; do not infer stale geometry from earlier attempts.',
  ].filter((line): line is string => Boolean(line))

  return lines.length > 0 ? lines.join('\n') : null
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

function renderFailureClusters(clusters: readonly ValidationFailureCluster[]) {
  const lines = clusters.slice(0, 8).map((cluster) => {
    const pose = cluster.poseKey ? ` pose=${cluster.poseKey}` : ''

    return `- count=${cluster.count} ${cluster.label}${pose}`
  })

  if (clusters.length > 8) {
    lines.push(`- Omitted ${clusters.length - 8} lower-priority failure clusters.`)
  }

  lines.push(
    'Repair repeated clusters as one mechanism-level problem; do not chase each visual overlap independently.',
  )

  return lines.join('\n')
}

function renderHighFailureRepairStrategy(signals: readonly ValidationSignal[]) {
  if (signals.length < 50) {
    return null
  }

  const physicalCount = signals.filter(
    (signal) =>
      isPhysicalRelationFailure(signal) || signal.kind === 'isolated_part',
  ).length

  if (physicalCount < Math.ceil(signals.length * 0.5)) {
    return null
  }

  return [
    'High physical failure count indicates a representation-level problem, not dozens of independent one-off defects.',
    '- First repair broad static enclosure/support geometry: open, split, shrink, or relocate repeated housings, blocks, heads, covers, guards, frames, rails, walls, cases, and shells around moving or inserted mechanism parts.',
    '- Then prove repeated intentional captured fits with exact bounded checks for the whole repeated class, such as liners in housings, shafts in bearings, collars on hubs, guided sliders in rails, or routed paths on supports.',
    '- Finally adjust joint origins, axes, limits, and linked-control phase for sampled-pose clusters so rods, sliders, paths, shafts, wheels, and gears stay coupled through motion.',
    '- Do not spend a repair turn adding only `part_exists`, `joint_exists`, broad allowances, or tiny tolerance tweaks.',
  ].join('\n')
}

type MechanicalContractGroup = {
  code: string
  count: number
  partIds: Set<string>
}

function renderMechanicalContractSummary(signals: readonly ValidationSignal[]) {
  const groupsByCode = new Map<string, MechanicalContractGroup>()

  for (const signal of signals) {
    if (signal.kind !== 'mechanical_relation_coverage') {
      continue
    }

    const existing = groupsByCode.get(signal.code)

    if (existing) {
      existing.count += 1
      addMechanicalContractPartId(existing.partIds, signal)
      continue
    }

    const group: MechanicalContractGroup = {
      code: signal.code,
      count: 1,
      partIds: new Set(),
    }

    addMechanicalContractPartId(group.partIds, signal)
    groupsByCode.set(signal.code, group)
  }

  const groups = [...groupsByCode.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.code.localeCompare(right.code),
  )

  const hasRepeatedContract = groups.some((group) => group.count > 1)

  if (groups.length === 0 || (groups.length === 1 && !hasRepeatedContract)) {
    return null
  }

  const lines = [
    'Mechanical relation failures are a mechanism contract: repair repeated component classes together instead of adding isolated filler checks.',
  ]

  for (const group of groups.slice(0, 8)) {
    lines.push(
      [
        `- [${group.code}]`,
        `count=${group.count}`,
        group.partIds.size > 0
          ? `parts=${formatLimitedSet(group.partIds, 8)}`
          : null,
        `action=${getMechanicalContractAction(group.code)}`,
      ]
        .filter((entry): entry is string => Boolean(entry))
        .join(' '),
    )
  }

  if (groups.length > 8) {
    lines.push(`- Omitted ${groups.length - 8} lower-priority contract group(s).`)
  }

  lines.push(
    '- `part_exists` and `joint_exists` do not satisfy this contract; use geometry, joints, controls, and exact relation checks that prove fit through motion.',
  )

  return lines.join('\n')
}

function addMechanicalContractPartId(
  partIds: Set<string>,
  signal: ValidationSignal,
) {
  const partId = signal.refs?.partId

  if (partId) {
    partIds.add(partId)
  }
}

function getMechanicalContractAction(code: string) {
  switch (code) {
    case 'mechanical_coupler_contacts_missing':
    case 'mechanical_coupler_endpoint_targets_missing':
      return 'prove both rod/linkage ends with exact contact, bounded gap, containment, or seated-fit checks to the guided side and rotary side.'
    case 'mechanical_coupler_motion_joint_missing':
      return 'add a movable pivot joint at the rod/linkage pin, bearing eye, clevis, socket, wrist pin, crank pin, or journal endpoint and bind it into the linked control.'
    case 'mechanical_coupler_pose_targets_missing':
      return 'add sampled-pose exact checks for each repeated rod/linkage endpoint pair at one driven pose so the coupler stays connected through motion.'
    case 'mechanical_coupler_rigid_visual_missing':
      return 'replace connectorTube-only rods/linkages with rigid bar/tube/capsule geometry plus bearing-eye, clevis, pin, or socket end features.'
    case 'mechanical_guided_interface_target_missing':
      return 'prove each guided mover against its guide, liner, cylinder, rail, sleeve, housing, or support instead of only against a rod or loose neighbor.'
    case 'mechanical_guided_motion_joint_missing':
      return 'add a prismatic joint from the guide/cylinder/rail/housing/support to the guided mover and keep linkage/contact checks for the rod side.'
    case 'mechanical_guided_pose_target_missing':
      return 'add sampled-pose exact guide containment/contact checks for repeated pistons, sliders, plungers, sleeves, or valves at a driven pose.'
    case 'mechanical_guided_linked_control_missing':
      return 'use one control that binds at least one guided prismatic joint with the rotary driver joint so preview motion is coupled.'
    case 'mechanical_interface_check_missing':
      return 'add exact fitted-interface evidence to a guide, bearing, collar, housing, hub, mate, or support for each repeated shaft, bearing, wheel, hub, piston, or slider class.'
    case 'mechanical_linked_control_missing':
      return 'add one multi-joint control for the coupled crank, rod, piston, belt, chain, drivetrain, linkage, or gear-train mechanism.'
    case 'mechanical_path_contacts_missing':
    case 'mechanical_path_rotary_contacts_missing':
      return 'use expect_path_contacts with exact path and support visual ids for the routed belt, chain, track, cable, hose, rope, strap, or wire.'
    case 'mechanical_path_pose_contacts_missing':
      return 'add pose-specific expect_path_contacts at a driven pose so the routed path stays seated on its supports through motion.'
    case 'mechanical_rotary_motion_joint_missing':
      return 'add a revolute or continuous joint from a base, housing, support, bearing, collar, or hub to the rotary mover.'
    default:
      return 'add the missing prompt-critical relation evidence with exact visual refs and preserve the fitted mechanism geometry.'
  }
}

type VisualHotspot = {
  count: number
  opposingParts: Set<string>
  opposingVisuals: Set<string>
  partId: string
  visualId: string
}

type VisualPairHotspot = {
  code: string
  count: number
  detail: string | null
  kind: string
  partPair: string
  pose: string | null
  stage: ValidationStage
  visualPair: string
}

type RelationSide = {
  descriptor: string
  partId: string
  visualId: string
}

type MechanicalFitOverlapHint = {
  category: string
  key: string
  line: string
  priority: number
}

function renderVisualRelationHotspots(signals: readonly ValidationSignal[]) {
  const { visualHotspots, visualPairHotspots } =
    createVisualRelationHotspots(signals)

  if (visualHotspots.length === 0 && visualPairHotspots.length === 0) {
    return null
  }

  const lines = [
    'Repeated exact visuals from blocking physical relation failures:',
  ]

  for (const hotspot of visualHotspots.slice(0, maxRenderedVisualHotspots)) {
    lines.push(
      [
        `- count=${hotspot.count}`,
        `visual=${hotspot.visualId}`,
        `part=${hotspot.partId}`,
        `opposingParts=${formatLimitedSet(hotspot.opposingParts, 5)}`,
        `opposingVisuals=${formatLimitedSet(hotspot.opposingVisuals, 5)}`,
      ].join(' '),
    )
  }

  const dominantVisualPairHotspots = visualPairHotspots.filter(
    (hotspot) => hotspot.count > 1,
  )

  if (dominantVisualPairHotspots.length > 0) {
    lines.push('Dominant exact visual pairs:')

    for (const hotspot of dominantVisualPairHotspots.slice(
      0,
      maxRenderedVisualPairHotspots,
    )) {
      lines.push(
        [
          `- count=${hotspot.count}`,
          `[${hotspot.stage}/${hotspot.code}]`,
          `parts=${hotspot.partPair}`,
          `visuals=${hotspot.visualPair}`,
          hotspot.pose ? `pose=${hotspot.pose}` : null,
          hotspot.detail ? `detail=${hotspot.detail}` : null,
        ]
          .filter((entry): entry is string => Boolean(entry))
          .join(' '),
      )
    }
  }

  lines.push(
    'Use these exact visual ids as repair targets: repeated housing, block, cover, guard, frame, rail, wall, case, or shell visuals usually need cutouts, splits, shrinkage, or relocation around the swept mechanism; repeated pin, rod, rim, guide, path, or bearing visuals usually need fitted geometry, a corrected joint origin, or bounded authored proof.',
  )

  return lines.join('\n')
}

function renderMechanicalFitOverlapGuidance(signals: readonly ValidationSignal[]) {
  const hintsByKey = new Map<string, MechanicalFitOverlapHint>()

  for (const signal of signals) {
    const hint = createMechanicalFitOverlapHint(signal)

    if (!hint || hintsByKey.has(hint.key)) {
      continue
    }

    hintsByKey.set(hint.key, hint)
  }

  const hints = [...hintsByKey.values()].sort(
    (left, right) =>
      left.priority - right.priority ||
      left.line.localeCompare(right.line),
  )

  if (hints.length === 0) {
    return null
  }

  const selectedHints = selectMechanicalFitOverlapHints(hints, 8)
  const lines = [
    'Classify exact mechanical overlap pairs before moving geometry:',
    ...selectedHints.map((hint) => hint.line),
  ]

  if (hints.length > selectedHints.length) {
    lines.push(
      `- Omitted ${hints.length - selectedHints.length} lower-priority fit hint(s).`,
    )
  }

  lines.push(
    '- For intended captured fits, add exact visual-pair bounded proof and keep the parts visually coupled; for swept-volume collisions, open or split static housings instead of adding broad allowances.',
  )

  return lines.join('\n')
}

function selectMechanicalFitOverlapHints(
  hints: readonly MechanicalFitOverlapHint[],
  limit: number,
) {
  const selected: MechanicalFitOverlapHint[] = []
  const selectedByCategory = new Map<string, number>()

  for (const hint of hints) {
    const selectedCount = selectedByCategory.get(hint.category) ?? 0

    if (selected.length >= limit) {
      break
    }

    if (selectedCount >= 3) {
      continue
    }

    selected.push(hint)
    selectedByCategory.set(hint.category, selectedCount + 1)
  }

  if (selected.length >= limit) {
    return selected
  }

  for (const hint of hints) {
    if (selected.includes(hint)) {
      continue
    }

    selected.push(hint)

    if (selected.length >= limit) {
      break
    }
  }

  return selected
}

function createMechanicalFitOverlapHint(
  signal: ValidationSignal,
): MechanicalFitOverlapHint | null {
  if (!isPhysicalRelationFailure(signal)) {
    return null
  }

  const refs = signal.refs ?? {}
  const partAId = refs.partAId ?? refs.parentPartId
  const partBId = refs.partBId ?? refs.childPartId
  const visualAId = getPrimaryVisualAId(signal)
  const visualBId = getPrimaryVisualBId(signal)

  if (!partAId || !partBId || !visualAId || !visualBId) {
    return null
  }

  const sideA = createRelationSide(partAId, visualAId)
  const sideB = createRelationSide(partBId, visualBId)
  const posePrefix =
    signal.stage === 'sampled_poses' ? 'pose-specific ' : ''

  const guidedFit = orientMechanicalFitPair(
    sideA,
    sideB,
    guidedInnerTerms,
    guidedOuterTerms,
  )

  if (guidedFit) {
    return {
      category: 'guided',
      key: `guided|${guidedFit.inner.partId}|${guidedFit.inner.visualId}|${guidedFit.outer.partId}|${guidedFit.outer.visualId}`,
      line: [
        '- guided containment fit:',
        formatSide(guidedFit.inner),
        'inside',
        `${formatSide(guidedFit.outer)};`,
        `if intentional, add ${posePrefix}expect_within`,
        `inner=${formatSide(guidedFit.inner)}`,
        `outer=${formatSide(guidedFit.outer)}`,
        'with bounded maxPenetration instead of separating the guided mover.',
      ].join(' '),
      priority: 0,
    }
  }

  const shaftFit = orientMechanicalFitPair(
    sideA,
    sideB,
    shaftInnerTerms,
    bearingOuterTerms,
  )

  if (shaftFit) {
    return {
      category: 'shaft',
      key: `shaft|${shaftFit.inner.partId}|${shaftFit.inner.visualId}|${shaftFit.outer.partId}|${shaftFit.outer.visualId}`,
      line: [
        '- shaft or pin bearing fit:',
        formatSide(shaftFit.inner),
        'captured by',
        `${formatSide(shaftFit.outer)};`,
        `if intentional, add ${posePrefix}expect_within or exact expect_contact`,
        'with bounded maxPenetration for the bearing/collar/hub visual pair.',
      ].join(' '),
      priority: 1,
    }
  }

  const insertedFit = orientMechanicalFitPair(
    sideA,
    sideB,
    insertedInnerTerms,
    insertedOuterTerms,
  )

  if (insertedFit) {
    return {
      category: 'inserted',
      key: `inserted|${insertedFit.inner.partId}|${insertedFit.inner.visualId}|${insertedFit.outer.partId}|${insertedFit.outer.visualId}`,
      line: [
        '- inserted support fit:',
        formatSide(insertedFit.inner),
        'seated in',
        `${formatSide(insertedFit.outer)};`,
        `if intentional, add ${posePrefix}expect_within or exact expect_contact`,
        'with bounded maxPenetration for the liner/bushing/bearing/collar/sleeve/shaft/hub/support visual pair.',
      ].join(' '),
      priority: 2,
    }
  }

  const rodFit = orientRodCouplerPair(sideA, sideB)

  if (rodFit) {
    return {
      category: 'rod',
      key: `rod|${rodFit.rod.partId}|${rodFit.rod.visualId}|${rodFit.pin.partId}|${rodFit.pin.visualId}`,
      line: [
        '- rod/linkage endpoint fit:',
        formatSide(rodFit.rod),
        'seated on',
        `${formatSide(rodFit.pin)};`,
        `if intentional, add ${posePrefix}exact contact or bounded-gap proof`,
        'and keep the endpoint tied into the linked control through the sampled pose.',
      ].join(' '),
      priority: 3,
    }
  }

  const pathFit = orientMechanicalFitPair(
    sideA,
    sideB,
    routedPathTerms,
    routedPathSupportTerms,
  )

  if (pathFit) {
    return {
      category: 'path',
      key: `path|${pathFit.inner.partId}|${pathFit.inner.visualId}|${pathFit.outer.partId}|${pathFit.outer.visualId}`,
      line: [
        '- routed path seating:',
        formatSide(pathFit.inner),
        'on',
        `${formatSide(pathFit.outer)};`,
        `repair path geometry and use ${posePrefix}expect_path_contacts`,
        'with exact path and target visual ids rather than separate one-off contact checks.',
      ].join(' '),
      priority: 4,
    }
  }

  const housingClearance = orientHousingClearancePair(sideA, sideB)

  if (housingClearance) {
    return {
      category: 'clearance',
      key: `clearance|${housingClearance.housing.partId}|${housingClearance.housing.visualId}|${housingClearance.mover.partId}|${housingClearance.mover.visualId}`,
      line: [
        '- swept-volume clearance:',
        formatSide(housingClearance.housing),
        'intersects',
        `${formatSide(housingClearance.mover)};`,
        'open, split, shrink, or move the static housing/rail/bedplate visual around the mechanism instead of loosening the moving part.',
      ].join(' '),
      priority: 5,
    }
  }

  return null
}

function createRelationSide(partId: string, visualId: string): RelationSide {
  return {
    descriptor: `${partId} ${visualId}`.toLowerCase(),
    partId,
    visualId,
  }
}

function orientMechanicalFitPair(
  sideA: RelationSide,
  sideB: RelationSide,
  innerTerms: readonly string[],
  outerTerms: readonly string[],
) {
  if (
    matchesAnyTerm(sideA.descriptor, innerTerms) &&
    matchesAnyTerm(sideB.descriptor, outerTerms)
  ) {
    return { inner: sideA, outer: sideB }
  }

  if (
    matchesAnyTerm(sideB.descriptor, innerTerms) &&
    matchesAnyTerm(sideA.descriptor, outerTerms)
  ) {
    return { inner: sideB, outer: sideA }
  }

  return null
}

function orientRodCouplerPair(sideA: RelationSide, sideB: RelationSide) {
  if (
    isRodEndpointSide(sideA) &&
    matchesAnyTerm(sideB.descriptor, couplerPinTerms)
  ) {
    return { pin: sideB, rod: sideA }
  }

  if (
    isRodEndpointSide(sideB) &&
    matchesAnyTerm(sideA.descriptor, couplerPinTerms)
  ) {
    return { pin: sideA, rod: sideB }
  }

  return null
}

function orientHousingClearancePair(sideA: RelationSide, sideB: RelationSide) {
  if (
    matchesAnyTerm(sideA.descriptor, staticHousingTerms) &&
    matchesAnyTerm(sideB.descriptor, movingMechanismTerms)
  ) {
    return { housing: sideA, mover: sideB }
  }

  if (
    matchesAnyTerm(sideB.descriptor, staticHousingTerms) &&
    matchesAnyTerm(sideA.descriptor, movingMechanismTerms)
  ) {
    return { housing: sideB, mover: sideA }
  }

  return null
}

function isRodEndpointSide(side: RelationSide) {
  return (
    matchesAnyTerm(side.descriptor, rodTerms) &&
    matchesAnyTerm(side.descriptor, rodEndpointTerms)
  )
}

function formatSide(side: RelationSide) {
  return `${side.partId}/${side.visualId}`
}

function matchesAnyTerm(value: string, terms: readonly string[]) {
  return terms.some((term) => value.includes(term))
}

function createVisualRelationHotspots(signals: readonly ValidationSignal[]) {
  const visualsByKey = new Map<string, VisualHotspot>()
  const visualPairsByKey = new Map<string, VisualPairHotspot>()

  for (const signal of signals) {
    if (!isPhysicalRelationFailure(signal)) {
      continue
    }

    const refs = signal.refs ?? {}
    const visualAId = getPrimaryVisualAId(signal)
    const visualBId = getPrimaryVisualBId(signal)
    const partAId = refs.partAId ?? refs.parentPartId
    const partBId = refs.partBId ?? refs.childPartId

    if (!partAId || !partBId || !visualAId || !visualBId) {
      continue
    }

    addVisualHotspot(visualsByKey, {
      opposingPartId: partBId,
      opposingVisualId: visualBId,
      partId: partAId,
      visualId: visualAId,
    })
    addVisualHotspot(visualsByKey, {
      opposingPartId: partAId,
      opposingVisualId: visualAId,
      partId: partBId,
      visualId: visualBId,
    })

    const partPair = formatPair(partAId, partBId)
    const visualPair = formatPair(visualAId, visualBId)
    const visualPairKey = [
      signal.stage,
      signal.kind,
      signal.code,
      partPair,
      visualPair,
      refs.poseValues ?? '',
    ].join('|')
    const existingPair = visualPairsByKey.get(visualPairKey)

    if (existingPair) {
      existingPair.count += 1
      continue
    }

    visualPairsByKey.set(visualPairKey, {
      code: signal.code,
      count: 1,
      detail: formatHotspotDetail(signal.details),
      kind: signal.kind,
      partPair,
      pose: formatHotspotPose(refs.poseValues),
      stage: signal.stage,
      visualPair,
    })
  }

  return {
    visualHotspots: [...visualsByKey.values()].sort(compareVisualHotspots),
    visualPairHotspots: [...visualPairsByKey.values()].sort(
      compareVisualPairHotspots,
    ),
  }
}

function isPhysicalRelationFailure(signal: ValidationSignal) {
  return [
    'exact_contact_gap',
    'mechanical_fit',
    'path_contact_fit',
    'real_overlap',
    'sampled_pose_overlap',
  ].includes(signal.kind)
}

function getPrimaryVisualAId(signal: ValidationSignal) {
  const refs = signal.refs ?? {}

  return (
    refs.visualAId ??
    refs.pathVisualId ??
    parseVisualPairFromDetails(signal.details)?.[0]
  )
}

function getPrimaryVisualBId(signal: ValidationSignal) {
  const refs = signal.refs ?? {}

  return (
    refs.visualBId ??
    refs.targetVisualId ??
    parseVisualPairFromDetails(signal.details)?.[1]
  )
}

function parseVisualPairFromDetails(details: string | undefined) {
  if (!details) {
    return null
  }

  const match = details.match(
    /(?:closestVisualPair|closestFailedVisualPair)=([^\s|]+)<->([^\s|]+)/,
  )

  return match ? ([match[1], match[2]] as const) : null
}

function addVisualHotspot(
  hotspots: Map<string, VisualHotspot>,
  input: {
    opposingPartId: string
    opposingVisualId: string
    partId: string
    visualId: string
  },
) {
  const key = `${input.partId}|${input.visualId}`
  const existing = hotspots.get(key)

  if (existing) {
    existing.count += 1
    existing.opposingParts.add(input.opposingPartId)
    existing.opposingVisuals.add(input.opposingVisualId)
    return
  }

  hotspots.set(key, {
    count: 1,
    opposingParts: new Set([input.opposingPartId]),
    opposingVisuals: new Set([input.opposingVisualId]),
    partId: input.partId,
    visualId: input.visualId,
  })
}

function compareVisualHotspots(left: VisualHotspot, right: VisualHotspot) {
  return (
    right.count - left.count ||
    left.partId.localeCompare(right.partId) ||
    left.visualId.localeCompare(right.visualId)
  )
}

function compareVisualPairHotspots(
  left: VisualPairHotspot,
  right: VisualPairHotspot,
) {
  return (
    right.count - left.count ||
    stagePriority[left.stage] - stagePriority[right.stage] ||
    getKindPriority(left.kind) - getKindPriority(right.kind) ||
    left.partPair.localeCompare(right.partPair) ||
    left.visualPair.localeCompare(right.visualPair)
  )
}

function formatHotspotDetail(details: string | undefined) {
  if (!details) {
    return null
  }

  const firstClause = details
    .split(/\s+(?:pose|joints|proofCheck)=/)
    .at(0)
    ?.trim()

  return firstClause ? compactText(firstClause, 120) : null
}

function formatHotspotPose(poseValues: string | undefined) {
  return poseValues ? compactText(poseValues, 140) : null
}

function formatPair(left: string, right: string) {
  return [left, right].sort().join('<->')
}

function formatLimitedSet(values: ReadonlySet<string>, limit: number) {
  const sorted = [...values].sort()
  const rendered = sorted.slice(0, limit).join(',')
  const omitted = sorted.length - limit

  return omitted > 0 ? `${rendered},+${omitted}` : rendered
}

function compactText(value: string, maxLength: number) {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(0, maxLength - 3))}...`
    : value
}

function renderProbeReport(report: ManifestProbeReport) {
  const lines = [
    report.assetBounds
      ? `assetBounds size=${formatVector(report.assetBounds.size)} center=${formatVector(report.assetBounds.center)}`
      : 'assetBounds unavailable',
  ]
  const jointDistances = report.joints
    .map((joint) => ({
      joint,
      maxDistance: Math.max(
        joint.parentDistanceToOrigin ?? 0,
        joint.childDistanceToOrigin ?? 0,
      ),
    }))
    .filter(({ maxDistance }) => maxDistance > 0.01)
    .sort((left, right) => right.maxDistance - left.maxDistance)
    .slice(0, 6)

  if (jointDistances.length > 0) {
    lines.push('jointOriginDistances:')

    for (const { joint, maxDistance } of jointDistances) {
      lines.push(
        `- joint=${joint.id} type=${joint.type} parent=${joint.parentPartId} child=${joint.childPartId} maxDistance=${maxDistance.toFixed(4)} origin=${joint.originWorld ? formatVector(joint.originWorld) : 'unavailable'}`,
      )
    }
  }

  if (report.connectors.length > 0) {
    lines.push('connectors:')

    for (const connector of report.connectors.slice(0, 8)) {
      lines.push(
        `- visual=${connector.id} owner=${connector.ownerPartId} endpoints=${connector.startPartId}->${connector.endPartId} length=${connector.length?.toFixed(4) ?? 'unavailable'} radius=${connector.radius}`,
      )
    }
  }

  if (report.relations.length > 0) {
    lines.push('failedPairRelations:')

    for (const relation of report.relations.slice(0, 8)) {
      lines.push(
        `- parts=${relation.partAId}<->${relation.partBId} signal=${relation.signalStage}/${relation.signalCode} closestVisualPair=${relation.closestVisualPair ?? 'unavailable'} distance=${relation.distance?.toFixed(4) ?? 'unavailable'} penetration=${relation.penetrationDepth?.toFixed(4) ?? 'unavailable'} overlapVolume=${relation.overlapVolume?.toExponential(3) ?? 'unavailable'}`,
      )
    }
  }

  return lines.join('\n')
}

function formatVector(vector: readonly number[]) {
  return `(${vector.map((value) => value.toFixed(4)).join(',')})`
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

  const details = formatSignalDetails(signal)

  if (details) {
    lines.push(`  details=${indentMultiline(details)}`)
  }

  return lines.join('\n')
}

export function orderFailureSignals(signals: readonly ValidationSignal[]) {
  return [...signals].sort((left, right) => {
    const stageDelta =
      getFailureStagePriority(left) - getFailureStagePriority(right)

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

function getFailureStagePriority(signal: ValidationSignal) {
  if (signal.kind === 'mechanical_relation_coverage') {
    return stagePriority.sampled_poses + 0.25
  }

  if (signal.code === 'surface_side_missing_check') {
    return stagePriority.sampled_poses + 0.5
  }

  return stagePriority[signal.stage]
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
  if (signal.kind === 'mechanical_relation_coverage') {
    return [
      signal.severity,
      signal.stage,
      signal.kind,
      signal.code,
      getMechanicalCoverageGroupLabel(signal.code),
    ].join('|')
  }

  return [
    signal.severity,
    signal.stage,
    signal.kind,
    signal.code,
    signal.summary,
  ].join('|')
}

function compactSignalLabel(signal: ValidationSignal) {
  if (signal.kind === 'mechanical_relation_coverage') {
    return `[${signal.stage}/${signal.code}] ${getMechanicalCoverageGroupLabel(signal.code)}`
  }

  return `[${signal.stage}/${signal.code}] ${signal.summary}`
}

function getMechanicalCoverageGroupLabel(code: string) {
  switch (code) {
    case 'mechanical_coupler_contacts_missing':
      return 'Mechanical couplers need relation evidence at both ends.'
    case 'mechanical_coupler_endpoint_targets_missing':
      return 'Mechanical couplers need guided-side and rotary-side endpoint evidence.'
    case 'mechanical_coupler_motion_joint_missing':
      return 'Mechanical couplers need a movable pivot joint for linked motion.'
    case 'mechanical_coupler_pose_targets_missing':
      return 'Mechanical couplers need sampled-pose endpoint evidence.'
    case 'mechanical_coupler_rigid_visual_missing':
      return 'Mechanical couplers need rigid linkage geometry.'
    case 'mechanical_guided_interface_target_missing':
      return 'Guided movers need guide, liner, cylinder, rail, housing, or support evidence.'
    case 'mechanical_guided_linked_control_missing':
      return 'Linked guided mechanisms need one control binding guided and rotary joints.'
    case 'mechanical_guided_motion_joint_missing':
      return 'Guided movers need prismatic motion joints to their guides.'
    case 'mechanical_guided_pose_target_missing':
      return 'Guided movers need sampled-pose guide evidence.'
    case 'mechanical_interface_check_missing':
      return 'Mechanical interface parts need fitted-interface evidence.'
    case 'mechanical_linked_control_missing':
      return 'Linked mechanical prompts need coupled multi-joint controls.'
    case 'mechanical_path_contacts_missing':
      return 'Routed mechanical paths need contact evidence for supports.'
    case 'mechanical_path_pose_contacts_missing':
      return 'Routed mechanical paths need sampled-pose support evidence.'
    case 'mechanical_path_rotary_contacts_missing':
      return 'Routed mechanical paths need rotary support contact evidence.'
    case 'mechanical_rotary_motion_joint_missing':
      return 'Rotary movers need revolute or continuous support joints.'
    default:
      return 'Mechanical relation coverage is missing prompt-critical evidence.'
  }
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
    failureClusters: readonly ValidationFailureCluster[]
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

  const primary = selectPrimaryResponseFailure(
    failures,
    options.failureClusters,
  )
  const allowanceRule =
    '- If an overlap is an intentional fitted contact or containment, prove the exact visual pair with bounded contact, path-contact, gap, or containment penetration first; use explicit scoped allowances with concrete reasons for intentional exceptions that are not covered by bounded fit proof.'
  let rules: string[]

  if (primary.source === 'schema' || primary.stage === 'schema') {
    rules = [
      '- Fix the JSON shape first. Schema failures block structural, geometry, QC, and authored-check feedback.',
      '- Preserve strict Manifest3D JSON only; do not include prose, comments, markdown fences, or generated code.',
    ]
  } else if (primary.code === 'rounded_box_radius_too_large') {
    rules = [
      '- Fix the roundedBox geometry contract before tuning placement: radius must be less than or equal to half of the shortest size component.',
      '- Keep the softened manufactured form where appropriate; reduce the radius or increase the thin dimension instead of replacing the visual with a sharp placeholder box.',
    ]
  } else if (
    primary.code === 'allowance_missing_visual' ||
    primary.code === 'allowance_visual_wrong_part'
  ) {
    rules = [
      '- Fix or remove the invalid visual-scoped allowance before tuning geometry.',
      '- An `allow_overlap.visualAId` must be an existing visual on `partAId`, and `visualBId` must be an existing visual on `partBId`; do not invent bearing, collar, hub, guide, shell, or path ids inside allowances.',
      '- If the intended visual does not exist yet, add the complete visual to the correct part first, then reference that stable id from the allowance and matching proof check.',
      '- If an allowance object was accidentally placed in a visual `geometry` field, replace that visual geometry with a real primitive descriptor and append a valid allowance at `/allowances/-` only when an exception is still needed.',
      '- Prefer exact bounded fit checks for captured pins, shafts, paths, and guided containment; use `allow_overlap` only for intentional exceptions that are not already covered by bounded proof.',
    ]
  } else if (primary.code === 'allowance_overlap_missing_proof_check') {
    rules = [
      '- Every intentional overlap allowance needs a matching authored proof check for the same part pair.',
      '- If the allowance names visual ids, the proof check must reference the same visual pair with expect_contact, expect_path_contacts, expect_gap, expect_overlap, or expect_within.',
      '- For guided or captured containment, prefer exact expect_within.maxPenetration over a broad allowance-only repair.',
      '- Do not delete the allowance to hide a real intentional fit; either prove the fit or repair the geometry so no allowance is needed.',
    ]
  } else if (primary.code === 'surface_side_missing_check') {
    rules = [
      '- Decide whether the surface should be visible from one side or both sides, then set the material side to front, back, or double.',
      '- Add an expect_material_side check for the exact visual so the renderer-facing side choice is deliberate and testable.',
      '- Use double for intentional paper-thin or open surfaces that should remain visible from either side; keep single-sided materials only when one-way visibility is intended.',
    ]
  } else if (primary.kind === 'mechanical_relation_coverage') {
    rules = [
      '- Add authored relation evidence for the prompt-critical mechanical interface instead of treating it as decorative placement.',
      '- If the prompt asks for a belt, chain, track, cable, hose, rope, strap, wire, connecting rod, or linkage, keep a clearly named part for it; do not omit it to avoid relation checks.',
      '- If the prompt asks for a piston, slider, valve, shaft, crank, gear, pulley, sprocket, wheel, hub, bearing, or collar, keep a clearly named part for that component before proving its fitted interface.',
      '- Use expect_path_contacts with exact path and target visual ids for belts, chains, tracks, wrapped cables, hoses, ropes, straps, or wires that must ride on supports, wheels, pulleys, sprockets, guides, fittings, or mounts. Separate expect_contact checks are not enough for wrapped path coverage.',
      '- For connecting rods, pushrods, tie rods, link arms, and linkages, use rigid capsule/tube/cylinder/bar visuals with bearing-eye, clevis, pin, or socket ends; connectorTube is for flexible cables, hoses, ropes, straps, tethers, and wires, not rigid motion-transfer rods.',
      '- For rods and linkages in crank, piston, slider, pump, engine, or linkage mechanisms, add at least one movable revolute pivot joint at a pin, bearing-eye, clevis, socket, wrist-pin, crank-pin, or journal endpoint; fixed-only couplers can look connected at rest but detach or collide during linked motion.',
      '- For rods and linkages, prove both ends with exact contact, bounded gap, containment, or seated-fit checks; one end should reach the guided mover/pin side and the other should reach the crank, shaft, pulley, gear, sprocket, or wheel side when the prompt asks for that mechanism.',
      '- For pistons, sliders, plungers, sleeves, and valves, prove the constraining guide, liner, cylinder, rail, sleeve, housing, or support; do not only prove contact to a rod or loose neighboring part.',
      '- For pistons, sliders, plungers, sleeves, or valves that should slide, stroke, reciprocate, or couple to a crank, add a prismatic joint from the guide/cylinder/rail/housing/support to the guided part; do not make the guided mover only a fixed child of the rod.',
      '- For cranks, crankshafts, shafts, gears, pulleys, sprockets, wheels, rotors, turbines, fans, or impellers that should spin, rotate, drive, time, or transfer coupled motion, add a revolute or continuous joint from the base/housing/support/bearing/collar/hub to that rotary mover.',
      '- For linked mechanical prompts, use a multi-joint control for coupled motion such as crank/rod/piston, belt, chain, timing, linkage, drivetrain, or gear-train motion instead of independent one-joint dials.',
      '- For linked guided mechanisms, that control should bind both the guided prismatic joint and at least one rotary joint so preview/export show the linear and rotary motion coupled together.',
      '- Include rod/linkage pivot joints in the same linked control when those couplers swing as part of the motion-transfer chain.',
      '- For linked mechanisms with moving joints, add pose-specific authored checks at a sampled driven pose for rod endpoints, guided movers, and routed path contacts so validation proves the mechanism remains coupled during motion, not only at rest.',
      '- For shafts, gears, pulleys, and wheels, prove at least one fitted bearing, collar, housing, or support with exact relation refs where needed.',
    ]
  } else if (
    primary.stage === 'structure' ||
    primary.kind === 'single_root_policy' ||
    primary.kind === 'model_validity'
  ) {
    rules = [
      '- Fix ids, references, roots, cycles, and joint semantics before tuning local geometry.',
      '- Keep the joint graph as the assembly source of truth: exactly one root part and one parent joint for every non-root part.',
      '- Preserve stable part, visual, joint, control, and material ids unless you also update every dependent check and allowance.',
    ]
  } else if (primary.stage === 'build' || primary.kind === 'compile_runtime') {
    rules = [
      '- Fix geometry descriptors and transform data before interpreting baseline QC or authored-check failures.',
      '- Keep dimensions finite and positive, and keep visual transforms local to their owning part.',
    ]
  } else if (primary.kind === 'isolated_part') {
    rules = [
      '- Fix the floating or disconnected part before tuning secondary authored checks.',
      '- Do not respond to physical disconnection with `part_exists` or `joint_exists`; the object already exists, but its visible support/contact path is missing.',
      '- Add or correct a physical support path through touching bounds, mounts, or fixed joints when the part should be attached.',
      allowanceRule,
    ]
  } else if (primary.kind === 'mechanical_fit') {
    rules = [
      '- Fix the loose mechanical joint fit before tuning secondary checks.',
      '- Add or correct visible bearings, collars, hinge barrels, sliders, guides, sockets, pins, brackets, or flanges so the moving child part has a close physical interface to its parent.',
      '- Add exact contact, bounded gap, containment, or bounded-penetration checks for the intended fitted interface instead of leaving the joint visually detached.',
      allowanceRule,
    ]
  } else if (primary.kind === 'path_contact_fit') {
    rules = [
      '- Repair the routed component as a fitted path, not as a loose visual loop.',
      '- Move or reshape the path so it contacts the listed targets within tolerance, or update stale target refs if the intended supports changed.',
      '- For belts, chains, tracks, and wrapped cables, keep the path visually taut around the wheel, pulley, sprocket, rim, fitting, or guide instead of relaxing the check.',
    ]
  } else if (primary.kind === 'real_overlap') {
    rules = [
      '- Decide whether the current-pose overlap is intentional embedding or an unintended collision.',
      '- For unintended collisions, change geometry, placement, or rest joint origins while preserving prompt-critical visible form.',
      '- If a static housing, block, head, cover, guard, frame, rail, wall, case, or shell intersects shafts, rods, pistons, valves, sprockets, chains, gears, rotors, or other moving internals, open, split, shrink, or move the static enclosure to clear the mechanism swept volume instead of pushing the mechanism loose.',
      '- For intentional fitted mechanical contact or containment, add or correct exact visual-pair proof with `expect_contact.maxPenetration`, `expect_path_contacts.maxPenetration`, `expect_gap.maxPenetration`, or `expect_within.maxPenetration` so the overlap is bounded instead of forcing visible separation.',
      '- For intentional simplified overlaps that are not bounded fitted contacts, use exact visual-pair allowances and pair them with prompt checks that prove the intended relationship.',
      allowanceRule,
    ]
  } else if (
    primary.kind === 'sampled_pose_overlap' ||
    primary.stage === 'sampled_poses'
  ) {
    rules = [
      '- Repair the articulated pose that failed, not only the rest pose.',
      '- Adjust joint origins, axes, limits, child-part placement, or geometry clearance so the mechanism works through its sampled motion.',
      '- If sampled-pose collisions are between static cutaway housings, covers, guards, frames, rails, walls, cases, or shells and moving internals, cut windows or split the enclosure around the swept path instead of hiding the collision with broad allowances.',
      '- If the sampled overlap is an intentional fitted contact, add or correct a pose-specific exact check with bounded penetration for that visual pair instead of separating parts that should remain mechanically coupled.',
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

  if (isPhysicalRelationFailure(primary) || primary.kind === 'isolated_part') {
    rules.push(
      '- Do not respond to physical/mechanical overlap, fit, routed-path, sampled-pose, or disconnection failures with `part_exists` or `joint_exists`; those checks only prove ids exist and do not change geometry, contact, support, clearance, or motion.',
    )
  }

  if (options.failureStreak >= 3) {
    rules.push(
      '- You are in a repair loop. Re-read the primary failure, paths, refs, and allowances before producing the next candidate.',
    )
  }

  if (
    options.failureStreak >= 3 &&
    hasConnectorMechanismCluster(options.failureClusters)
  ) {
    rules.push(
      '- Repeated failures involve cable/chain/strap-style connector geometry. Do not keep nudging a rigid connector part; represent the connector with pose-resolved endpoint geometry so it follows the moving mechanism through sampled poses.',
    )
  }

  return rules
}

function hasConnectorMechanismCluster(
  clusters: readonly ValidationFailureCluster[],
) {
  const connectorPattern = /(?:chain|cable|cord|hose|rope|strap|tether|wire)/i

  return clusters.some((cluster) => {
    if (cluster.stage !== 'sampled_poses') {
      return false
    }

    return Object.values(cluster.refs).some((value) => connectorPattern.test(value))
  })
}

function selectPrimaryResponseFailure(
  failures: readonly ValidationSignal[],
  clusters: readonly ValidationFailureCluster[],
) {
  const first = failures[0]

  if (!first) {
    return first
  }

  const dominantPhysicalCluster = clusters.find(isDominantPhysicalCluster)

  if (
    !dominantPhysicalCluster ||
    dominantPhysicalCluster.count <= 1 ||
    signalMatchesCluster(first, dominantPhysicalCluster) ||
    isHardPrimaryResponseFailure(first)
  ) {
    return first
  }

  const firstClusterCount =
    clusters.find((cluster) => signalMatchesCluster(first, cluster))?.count ?? 1

  if (dominantPhysicalCluster.count <= firstClusterCount) {
    return first
  }

  return (
    failures.find((signal) =>
      signalMatchesCluster(signal, dominantPhysicalCluster),
    ) ?? first
  )
}

function isDominantPhysicalCluster(cluster: ValidationFailureCluster) {
  return [
    'exact_contact_gap',
    'mechanical_fit',
    'path_contact_fit',
    'real_overlap',
    'sampled_pose_overlap',
  ].includes(cluster.kind)
}

function isHardPrimaryResponseFailure(signal: ValidationSignal) {
  if (signal.source === 'schema' || signal.stage === 'schema') {
    return true
  }

  if (
    signal.stage === 'build' ||
    signal.kind === 'compile_runtime' ||
    signal.kind === 'single_root_policy' ||
    signal.kind === 'model_validity'
  ) {
    return true
  }

  return signal.code === 'allowance_overlap_missing_proof_check'
}

function signalMatchesCluster(
  signal: ValidationSignal,
  cluster: ValidationFailureCluster,
) {
  if (
    signal.stage !== cluster.stage ||
    signal.kind !== cluster.kind ||
    signal.code !== cluster.code ||
    signal.source !== cluster.source
  ) {
    return false
  }

  const refs = signal.refs ?? {}
  const clusterRefs = cluster.refs

  for (const [name, value] of Object.entries(clusterRefs)) {
    if (name === 'partPair') {
      if (normalizePair(refs.partAId, refs.partBId) !== value) {
        return false
      }
      continue
    }

    if (name === 'visualPair') {
      if (normalizePair(refs.visualAId, refs.visualBId) !== value) {
        return false
      }
      continue
    }

    if (refs[name] !== value) {
      return false
    }
  }

  return true
}

function normalizePair(left: string | undefined, right: string | undefined) {
  if (!left || !right) {
    return null
  }

  return [left, right].sort().join('<->')
}

function getKindPriority(kind: string) {
  return kindPriority[kind] ?? 100
}

function formatRefs(refs: Record<string, string>) {
  return Object.keys(refs)
    .sort()
    .map((key) => `${key}=${formatRefValue(key, refs[key])}`)
    .join(' ')
}

function indentMultiline(value: string) {
  return value.split('\n').join('\n  ')
}

function formatRefValue(key: string, value: string) {
  if (key === 'poseValues') {
    return summarizePoseVector(value)
  }

  return compactText(value, maxRenderedRefValueLength)
}

function formatSignalDetails(signal: ValidationSignal) {
  if (!signal.details) {
    return null
  }

  const compacted =
    signal.stage === 'sampled_poses' || signal.refs?.poseValues
      ? compactSampledPoseDetails(signal.details)
      : signal.details

  return compactText(compacted, maxRenderedDetailsLength)
}

function compactSampledPoseDetails(details: string) {
  return details
    .replace(/\bpose=([^();|\n]+?)\s*\([^)]*\)/g, (_match, poseName: string) =>
      `pose=${poseName.trim()}`,
    )
    .replace(/\bjoints=([^\s;|\n]+)/g, (_match, joints: string) =>
      `joints=${summarizePoseVector(joints)}`,
    )
}

function summarizePoseVector(value: string) {
  const entries = value.split(',').filter(Boolean)

  if (entries.length <= 5) {
    return value
  }

  return `${entries.slice(0, 5).join(',')},+${entries.length - 5}`
}
