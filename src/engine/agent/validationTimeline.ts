import type {
  ValidationReport,
  ValidationSignal,
  ValidationStage,
  ValidationStepStatus,
} from '../schema/validationTypes'
import type {
  CandidateAttempt,
  CandidateHistorySnapshot,
} from './candidateHistory'
import type { AgentLoopEvent } from './agentLoop'

export type AgentTimelineItemKind =
  | 'agent_step'
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
  return history.attempts.flatMap((attempt) => [
    createAttemptTimelineItem(attempt),
    ...createValidationTimeline(attempt.report).map((item) => ({
      ...item,
      id: `${attempt.id}:${item.id}`,
    })),
  ])
}

export function createAgentEventTimelineItem(
  event: AgentLoopEvent,
): AgentTimelineItem {
  return {
    detail: null,
    id: event.id,
    kind: 'agent_step',
    label: event.label,
    status: event.status,
  }
}

function createAttemptTimelineItem(
  attempt: CandidateAttempt,
): AgentTimelineItem {
  return {
    detail: null,
    id: attempt.id,
    kind: 'candidate_attempt',
    label:
      attempt.status === 'success'
        ? 'Candidate validated'
        : 'Candidate validation failed',
    status: attempt.status === 'success' ? 'passed' : 'failed',
  }
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
    case 'part_overlap_sampled_pose':
      return `Parts ${quoteRef(signal, 'partAId', 'one part')} and ${quoteRef(signal, 'partBId', 'another part')} overlap in a sampled joint pose.`
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
