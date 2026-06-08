import type {
  ValidationReport,
  ValidationSignal,
  ValidationStage,
  ValidationStepStatus,
} from '../../schema/validationTypes'
import type {
  CandidateAttempt,
  CandidateHistorySnapshot,
} from './candidateHistory'
import type { AgentLoopEvent } from '../agentLoop'

export type AgentTimelineItemKind =
  | 'agent_step'
  | 'attempt_header'
  | 'attempt_footer'
  | 'candidate_attempt'
  | 'validation_warning'
  | 'validation_failure'
  | 'validation_success'

export type AgentTimelineItem = {
  detail: string | null
  id: string
  kind: AgentTimelineItemKind
  label: string
  status: ValidationStepStatus | 'running'
}

export type AgentProgressSnapshot = {
  agentEvents: readonly AgentLoopEvent[]
  history: CandidateHistorySnapshot
  timelineItems: readonly AgentTimelineItem[]
}

export function createValidationTimeline(
  report: ValidationReport,
): AgentTimelineItem[] {
  return report.steps.map((step) => {
    const primarySignal = findPrimarySignal(report.bundle.signals, step.signalIds)

    return {
      detail: formatTimelineDetail(step.status, step.stage, primarySignal),
      id: `${report.id}:${step.id}`,
      kind: getTimelineKind(step.status),
      label: step.label,
      status: step.status,
    }
  })
}

export function createCandidateHistoryTimeline(
  history: CandidateHistorySnapshot,
): AgentTimelineItem[] {
  return createAgentProgressTimeline([], history)
}

export function createAgentProgressSnapshot(
  events: readonly AgentLoopEvent[],
  history: CandidateHistorySnapshot,
): AgentProgressSnapshot {
  const agentEvents = events.map((event) => ({ ...event }))

  return {
    agentEvents,
    history,
    timelineItems: createAgentProgressTimeline(agentEvents, history),
  }
}

export function createAgentProgressTimeline(
  events: readonly AgentLoopEvent[],
  history: CandidateHistorySnapshot,
): AgentTimelineItem[] {
  const builder = createTimelineBuilder()
  let validationAttemptIndex = 0
  const hasRunningEvent = events.some((event) => event.status === 'running')

  for (const event of events) {
    if (isCompletedValidationEvent(event)) {
      const attempt = history.attempts[validationAttemptIndex]
      validationAttemptIndex += 1

      if (attempt) {
        builder.addAttempt(attempt, { closeSuccessfulAttempt: false })
        continue
      }
    }

    builder.addEvent(event)
  }

  if (!hasRunningEvent) {
    for (const attempt of history.attempts.slice(validationAttemptIndex)) {
      builder.addAttempt(attempt, { closeSuccessfulAttempt: true })
    }
  }

  return builder.items
}

export function createAgentEventTimelineItem(
  event: AgentLoopEvent,
): AgentTimelineItem {
  return {
    detail: formatAgentEventDetail(event),
    id: event.id,
    kind: 'agent_step',
    label: event.label,
    status: event.status,
  }
}

type AddAttemptOptions = {
  closeSuccessfulAttempt: boolean
}

type TimelineBuilder = {
  addAttempt: (attempt: CandidateAttempt, options: AddAttemptOptions) => void
  addEvent: (event: AgentLoopEvent) => void
  items: AgentTimelineItem[]
}

function createTimelineBuilder(): TimelineBuilder {
  const items: AgentTimelineItem[] = []
  let currentSection: AttemptSectionState | null = null
  let nextSectionOrdinal = 0

  function openSection() {
    if (currentSection) {
      return currentSection
    }

    nextSectionOrdinal += 1
    const section = createAttemptSection(nextSectionOrdinal)

    currentSection = section
    items.push(createAttemptHeaderTimelineItem(section))

    return section
  }

  function closeSection(status: Exclude<AgentTimelineItem['status'], 'running'>) {
    if (!currentSection) {
      return
    }

    items.push(createAttemptFooterTimelineItem(currentSection, status))
    currentSection = null
  }

  return {
    addAttempt(attempt, options) {
      openSection()

      items.push(...createCandidateAttemptTimeline(attempt))

      if (attempt.status === 'failure') {
        closeSection('failed')
        return
      }

      if (options.closeSuccessfulAttempt) {
        closeSection('passed')
      }
    },
    addEvent(event) {
      openSection()
      items.push(createAgentEventTimelineItem(event))

      if (shouldCloseSectionAfterEvent(event)) {
        closeSection(getClosingStatusForEvent(event))
      }
    },
    items,
  }
}

type AttemptSectionState = {
  id: string
  label: string
}

function createAttemptSection(ordinal: number): AttemptSectionState {
  return {
    id: `attempt-section:${ordinal}`,
    label: ordinal === 1 ? 'Initial attempt' : `Repair ${ordinal - 1}`,
  }
}

function createAttemptHeaderTimelineItem(
  section: AttemptSectionState,
): AgentTimelineItem {
  return {
    detail: null,
    id: `${section.id}:header`,
    kind: 'attempt_header',
    label: section.label,
    status: 'skipped',
  }
}

function createAttemptFooterTimelineItem(
  section: AttemptSectionState,
  status: Exclude<AgentTimelineItem['status'], 'running'>,
): AgentTimelineItem {
  return {
    detail: null,
    id: `${section.id}:footer`,
    kind: 'attempt_footer',
    label: '',
    status,
  }
}

function isCompletedValidationEvent(event: AgentLoopEvent) {
  return event.state === 'validating_candidate' && event.status !== 'running'
}

function shouldCloseSectionAfterEvent(event: AgentLoopEvent) {
  if (event.status === 'failed' || event.state === 'cancelled') {
    return true
  }

  return event.state === 'ready' && event.status === 'passed'
}

function getClosingStatusForEvent(
  event: AgentLoopEvent,
): Exclude<AgentTimelineItem['status'], 'running'> {
  if (event.status === 'passed') {
    return 'passed'
  }

  if (event.status === 'skipped') {
    return 'skipped'
  }

  return 'failed'
}

function createCandidateAttemptTimeline(
  attempt: CandidateAttempt,
): AgentTimelineItem[] {
  const attemptItem = createAttemptTimelineItem(attempt)

  if (attempt.status === 'failure') {
    return [attemptItem]
  }

  return [
    attemptItem,
    ...createValidationTimeline(attempt.report).map((item) => ({
      ...item,
      id: `${attempt.id}:${item.id}`,
    })),
  ]
}

function createAttemptTimelineItem(
  attempt: CandidateAttempt,
): AgentTimelineItem {
  return {
    detail:
      attempt.status === 'failure'
        ? formatValidationFailureSummary(attempt.report)
        : null,
    id: attempt.id,
    kind: 'candidate_attempt',
    label:
      attempt.status === 'success'
        ? 'Candidate validated'
        : 'Candidate validation failed',
    status: attempt.status === 'success' ? 'passed' : 'failed',
  }
}

function formatAgentEventDetail(event: AgentLoopEvent) {
  if (event.status !== 'failed' || !event.detail) {
    return null
  }

  return formatConciseDetail(event.detail)
}

function formatValidationFailureSummary(report: ValidationReport) {
  const details = collectValidationFailureDetails(report)

  if (details.length === 0) {
    return 'Candidate validation failed.'
  }

  const maxDetails = 3
  const visibleDetails = details.slice(0, maxDetails)
  const remainingCount = details.length - visibleDetails.length

  if (remainingCount > 0) {
    visibleDetails.push(`+${remainingCount} more validation failure(s).`)
  }

  return visibleDetails.join('\n')
}

function collectValidationFailureDetails(report: ValidationReport) {
  const details: string[] = []
  const seenDetails = new Set<string>()

  for (const step of report.steps) {
    if (step.status !== 'failed') {
      continue
    }

    const signal = findPrimarySignal(report.bundle.signals, step.signalIds)
    const detail = signal
      ? formatSignalDetail(signal)
      : getFallbackDetail('failed', step.stage)

    if (seenDetails.has(detail)) {
      continue
    }

    seenDetails.add(detail)
    details.push(detail)
  }

  return details
}

function formatConciseDetail(detail: string) {
  const firstLine = detail
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) {
    return null
  }

  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}...` : firstLine
}

function findPrimarySignal(
  signals: readonly ValidationSignal[],
  signalIds: readonly string[],
) {
  const signalIdSet = new Set(signalIds)

  return signals.find(
    (signal) =>
      signalIdSet.has(signal.id) && signal.severity === 'failure',
  ) ?? signals.find((signal) => signalIdSet.has(signal.id))
}

function formatTimelineDetail(
  status: ValidationStepStatus,
  stage: ValidationStage,
  signal: ValidationSignal | undefined,
) {
  if (status === 'passed' || status === 'skipped') {
    return null
  }

  if (signal) {
    return formatSignalDetail(signal)
  }

  return getFallbackDetail(status, stage)
}

function formatSignalDetail(signal: ValidationSignal) {
  switch (signal.code) {
    case 'schema_invalid':
      return 'The model response was not valid Manifest3D JSON. The agent will try again with stricter structure.'
    case 'part_bounds_missing':
      return `Part ${quoteRef(signal, 'partId', 'this part')} could not be measured after build.`
    case 'part_has_no_visuals':
      return `Part ${quoteRef(signal, 'partId', 'this part')} has no renderable geometry.`
    case 'geometry_positive_number_required':
      return 'A geometry value must be a finite positive number.'
    case 'finite_number_required':
      return 'A transform or geometry value is not a finite number.'
    case 'transform_zero_scale':
      return 'A visual transform has a scale value too close to zero.'
    case 'asset_bounds_empty':
    case 'part_bounds_empty':
      return 'Some generated geometry has empty or invalid bounds.'
    case 'asset_bounds_flat':
    case 'part_bounds_flat':
      return 'Some generated geometry is too thin to validate reliably.'
    case 'asset_too_tiny':
      return 'The generated asset is too small to validate reliably.'
    case 'asset_too_large':
      return 'The generated asset is unusually large. It may still work, but sizing should be checked.'
    case 'export_mesh_missing_positions':
      return 'A generated mesh is missing vertex positions and cannot be exported.'
    case 'mesh_assets_missing':
    case 'export_traversal_no_meshes':
      return 'The candidate built successfully, but it did not produce renderable mesh geometry.'
    case 'asset_build_failed':
      return 'The geometry builder could not turn the candidate into a valid 3D object.'
    case 'part_disconnected_geometry_islands':
      return `Part ${quoteRef(signal, 'partId', 'this part')} contains separate geometry islands that are not physically connected.`
    case 'part_physically_disconnected':
      return `Part ${quoteRef(signal, 'partId', 'this part')} is not physically connected to the main body.`
    case 'part_overlap_current_pose':
      return `Parts ${quoteRef(signal, 'partAId', 'one part')} and ${quoteRef(signal, 'partBId', 'another part')} overlap in the current pose.`
    case 'part_overlap_proven_fit':
      return `Parts ${quoteRef(signal, 'partAId', 'one part')} and ${quoteRef(signal, 'partBId', 'another part')} have a bounded fitted-contact proof.`
    case 'part_overlap_sampled_pose':
      return `Parts ${quoteRef(signal, 'partAId', 'one part')} and ${quoteRef(signal, 'partBId', 'another part')} overlap in a sampled joint pose.`
    case 'part_overlap_sampled_pose_proven_fit':
      return `Parts ${quoteRef(signal, 'partAId', 'one part')} and ${quoteRef(signal, 'partBId', 'another part')} have bounded fitted-contact proof in a sampled joint pose.`
    case 'sampled_pose_invalid':
      return 'A pose-specific authored check references a joint pose that cannot be applied.'
    case 'joint_origin_far_from_geometry':
      return `Joint ${quoteRef(signal, 'jointId', 'this joint')} is far from the geometry it connects. This may make motion or placement look wrong.`
    case 'authored_checks_missing':
      return 'The candidate did not include authored checks, so the harness has less evidence that it matches the prompt.'
    case 'surface_side_missing_check':
      return `Visual ${quoteRef(signal, 'visualId', 'this surface')} needs an authored material-side check so single- or double-sided rendering is intentional.`
    case 'check_part_missing':
      return `The candidate is missing expected part ${quoteRef(signal, 'partId', 'from the prompt')}.`
    case 'check_joint_missing':
      return `The candidate is missing expected joint ${quoteRef(signal, 'jointId', 'from the prompt')}.`
    case 'check_joint_type_mismatch':
      return `Joint ${quoteRef(signal, 'jointId', 'from the prompt')} has the wrong joint type.`
    case 'check_ref_missing':
      return 'An authored check references geometry that was not created.'
    case 'expect_contact_failed':
      return `Expected parts ${quoteRef(signal, 'partAId', 'one part')} and ${quoteRef(signal, 'partBId', 'another part')} to touch, but they are separated.`
    case 'expect_path_contacts_invalid_thresholds':
      return 'An authored path-contact check asks for more contacts than it lists targets.'
    case 'expect_path_contacts_failed':
      return `Expected routed part ${quoteRef(signal, 'pathPartId', 'this path-like part')} to contact more of its supports or targets.`
    case 'expect_gap_invalid_thresholds':
      return 'An authored gap check has inconsistent distance limits.'
    case 'expect_gap_failed':
      return 'An authored spacing check failed; the generated gap is outside the expected range.'
    case 'expect_overlap_failed':
      return `Expected parts ${quoteRef(signal, 'partAId', 'one part')} and ${quoteRef(signal, 'partBId', 'another part')} to overlap, but they do not overlap enough.`
    case 'expect_within_failed':
      return `Expected part ${quoteRef(signal, 'innerPartId', 'one part')} to sit within ${quoteRef(signal, 'outerPartId', 'another part')}, but it is outside the expected bounds.`
    case 'expect_material_side_failed':
      return `Visual ${quoteRef(signal, 'visualId', 'this visual')} does not use the material side declared by its authored check.`
    case 'mechanical_path_contacts_missing':
      return `Path-like mechanical part ${quoteRef(signal, 'partId', 'this part')} needs authored contact evidence for its supports or targets.`
    case 'mechanical_path_rotary_contacts_missing':
      return `Path-like mechanical part ${quoteRef(signal, 'partId', 'this part')} needs path-contact evidence against the requested rotary supports.`
    case 'mechanical_path_pose_contacts_missing':
      return `Path-like mechanical part ${quoteRef(signal, 'partId', 'this part')} needs pose-specific path-contact evidence for linked motion.`
    case 'mechanical_path_part_missing':
      return 'The prompt asks for a routed mechanical path such as a belt, chain, cable, or track, but no matching part was created.'
    case 'mechanical_coupler_contacts_missing':
      return `Mechanical coupler ${quoteRef(signal, 'partId', 'this part')} needs authored relation evidence at both ends.`
    case 'mechanical_coupler_endpoint_targets_missing':
      return `Mechanical coupler ${quoteRef(signal, 'partId', 'this part')} needs endpoint evidence to the guided and rotary mechanism parts it links.`
    case 'mechanical_coupler_pose_targets_missing':
      return `Mechanical coupler ${quoteRef(signal, 'partId', 'this part')} needs pose-specific endpoint evidence for linked motion.`
    case 'mechanical_coupler_part_missing':
      return 'The prompt asks for a mechanical coupler such as a rod or linkage, but no matching part was created.'
    case 'mechanical_guided_part_missing':
      return 'The prompt asks for a guided mechanical component such as a piston or slider, but no matching part was created.'
    case 'mechanical_guided_interface_target_missing':
      return `Guided mechanical part ${quoteRef(signal, 'partId', 'this part')} needs evidence for the guide, liner, cylinder, rail, housing, or support constraining it.`
    case 'mechanical_guided_pose_target_missing':
      return `Guided mechanical part ${quoteRef(signal, 'partId', 'this part')} needs pose-specific guide evidence for linked motion.`
    case 'mechanical_guided_motion_joint_missing':
      return `Guided mechanical part ${quoteRef(signal, 'partId', 'this part')} needs a prismatic joint to its guide for requested linear motion.`
    case 'mechanical_guided_linked_control_missing':
      return 'A linked guided mechanism needs one control that drives the guided linear joint and rotary joint together.'
    case 'mechanical_rotary_part_missing':
      return 'The prompt asks for a rotary mechanical component such as a shaft, crank, gear, pulley, sprocket, or wheel, but no matching part was created.'
    case 'mechanical_interface_check_missing':
      return `Mechanical interface part ${quoteRef(signal, 'partId', 'this part')} needs an authored fitted-interface check.`
    case 'mechanical_linked_control_missing':
      return 'A linked mechanical prompt needs at least one control that drives multiple movable joints together.'
    case 'duplicate_part_id':
    case 'duplicate_material_id':
    case 'duplicate_joint_id':
    case 'duplicate_visual_id':
      return 'The candidate reused an id that must be unique.'
    case 'missing_material_reference':
      return `Visual ${quoteRef(signal, 'visualId', 'geometry')} references a material that does not exist.`
    case 'joint_missing_parent':
      return `Joint ${quoteRef(signal, 'jointId', 'this joint')} references a parent part that does not exist.`
    case 'joint_missing_child':
      return `Joint ${quoteRef(signal, 'jointId', 'this joint')} references a child part that does not exist.`
    case 'joint_self_reference':
      return `Joint ${quoteRef(signal, 'jointId', 'this joint')} tries to connect a part to itself.`
    case 'part_multiple_parent_joints':
      return `Part ${quoteRef(signal, 'childPartId', 'this part')} is attached to more than one parent joint.`
    case 'root_part_missing':
      return 'The asset does not have a clear root part for its joint tree.'
    case 'root_part_count':
      return 'The asset has more than one root part. It needs one connected assembly tree.'
    case 'joint_tree_cycle':
      return 'The joint tree contains a cycle. The parts need to form a one-way hierarchy.'
    case 'part_unreachable':
      return 'Some parts are not reachable from the root of the joint tree.'
    case 'joint_axis_required':
      return `Joint ${quoteRef(signal, 'jointId', 'this joint')} needs a nonzero movement axis.`
    case 'fixed_joint_limits_unsupported':
      return `Fixed joint ${quoteRef(signal, 'jointId', 'this joint')} should not include motion limits.`
    case 'continuous_limits_required':
    case 'continuous_effort_velocity_required':
      return `Continuous joint ${quoteRef(signal, 'jointId', 'this joint')} needs valid effort and velocity limits.`
    case 'continuous_joint_lower_upper_unsupported':
      return `Continuous joint ${quoteRef(signal, 'jointId', 'this joint')} should not include lower or upper limits.`
    case 'revolute_limits_required':
    case 'prismatic_limits_required':
      return `Joint ${quoteRef(signal, 'jointId', 'this joint')} needs lower and upper limits.`
    case 'joint_limits_order':
      return `Joint ${quoteRef(signal, 'jointId', 'this joint')} has lower and upper limits in the wrong order.`
    case 'prismatic_limits_too_large':
      return `Prismatic joint ${quoteRef(signal, 'jointId', 'this joint')} has too much travel.`
    default:
      return getFallbackDetailForSignal(signal)
  }
}

function quoteRef(
  signal: ValidationSignal,
  refKey: string,
  fallback: string,
) {
  const value = signal.refs?.[refKey]

  return value ? `"${value}"` : fallback
}

function getFallbackDetailForSignal(signal: ValidationSignal) {
  return getFallbackDetail(
    signal.severity === 'warning' ? 'warning' : 'failed',
    signal.stage,
  )
}

function getFallbackDetail(
  status: Exclude<ValidationStepStatus, 'passed' | 'skipped'>,
  stage: ValidationStage,
) {
  const prefix =
    status === 'warning'
      ? 'The candidate passed, but this step found something to review.'
      : 'This step found an issue the agent needs to fix.'

  switch (stage) {
    case 'schema':
      return `${prefix} The Manifest3D JSON structure needs correction.`
    case 'structure':
      return `${prefix} The asset hierarchy, references, or joint setup is invalid.`
    case 'build':
      return `${prefix} The geometry builder could not turn the candidate into a valid 3D object.`
    case 'baseline_qc':
      return `${prefix} The generated geometry failed a physical quality check.`
    case 'checks':
      return `${prefix} The generated asset does not satisfy one of its authored prompt checks.`
    case 'sampled_poses':
      return `${prefix} The generated mechanism failed a sampled pose or pose-specific authored check.`
    case 'export':
      return `${prefix} The generated asset is not ready for export.`
    case 'commit':
      return `${prefix} The validated asset could not be committed to the scene.`
    default:
      return assertNever(stage)
  }
}

function getTimelineKind(
  status: ValidationStepStatus,
): AgentTimelineItemKind {
  switch (status) {
    case 'failed':
      return 'validation_failure'
    case 'warning':
      return 'validation_warning'
    case 'passed':
      return 'validation_success'
    case 'skipped':
      return 'agent_step'
    default:
      return assertNever(status)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported validation timeline status: ${value}`)
}
