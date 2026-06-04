import type {
  ManifestAsset,
  ManifestAllowance,
  ManifestCheck,
  ManifestGeometry,
  ManifestJoint,
  ManifestJointControl,
  ManifestJointType,
  ManifestVector3,
} from '../schema/manifestTypes'
import { normalizeManifestMaterialSide } from '../geometry/materialSide'
import type { ValidationSignal } from '../schema/validationTypes'
import { createValidationSignal } from './reportBuilder'
import { getRelationCheckPartVisualPairs } from './relationCheckPairs'
import { validateMechanicalRelationCoverage } from './validateMechanicalRelations'

const axisLengthEpsilon = 0.000001
const maxPrismaticTravelMeters = 10
const fullLatheSweep = Math.PI * 2
const latheSweepEpsilon = 0.0001
const latheAxisEpsilon = 0.000001

export function validateStructure(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []
  const controls = asset.controls ?? []

  signals.push(...validateUniqueIds(asset, controls))
  signals.push(...validateRefs(asset, controls))
  signals.push(...validateAllowanceRefs(asset))
  signals.push(...validateAuthoredRelationCheckScope(asset))
  signals.push(...validateMechanicalRelationCoverage(asset))
  signals.push(...validateOverlapAllowanceContracts(asset))
  signals.push(...validateSurfaceSideContracts(asset))
  signals.push(...validateControlMotionRanges(asset, controls))
  signals.push(...validateMovableControlCoverage(asset, controls))
  signals.push(...validateMaterialEmissionAnimations(asset))
  signals.push(...validateJointTree(asset))
  signals.push(...validateJointSemantics(asset))

  return signals
}

function validateAuthoredRelationCheckScope(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []
  const visualCountByPartId = new Map(
    asset.parts.map((part) => [part.id, part.visuals.length]),
  )

  for (const [checkIndex, check] of asset.checks.entries()) {
    for (const pair of getRelationCheckPartVisualPairs(check)) {
      const leftVisualCount = visualCountByPartId.get(pair.partAId) ?? 0
      const rightVisualCount = visualCountByPartId.get(pair.partBId) ?? 0

      if (
        pair.visualAId &&
        pair.visualBId ||
        leftVisualCount <= 1 &&
        rightVisualCount <= 1
      ) {
        continue
      }

      signals.push(
        createValidationSignal(
          'authored_checks',
          'authored_relation_check_broad_scope',
          `Authored ${check.type} check between "${pair.partAId}" and "${pair.partBId}" should target exact visual ids when either part has multiple visuals.`,
          {
            details:
              'Broad part-level relation checks use aggregate part geometry and can hide which mount, cable, rail, or bracket is supposed to touch. Prefer exact visual ids for prompt-critical relationships and allowance proof checks.',
            path: `/checks/${checkIndex}`,
            refs: {
              partAId: pair.partAId,
              partBId: pair.partBId,
              ...(pair.visualAId ? { visualAId: pair.visualAId } : {}),
              ...(pair.visualBId ? { visualBId: pair.visualBId } : {}),
            },
            severity: 'warning',
            source: 'checks',
            stage: 'structure',
          },
        ),
      )
    }
  }

  return signals
}

function validateUniqueIds(
  asset: ManifestAsset,
  controls: ManifestAsset['controls'],
): ValidationSignal[] {
  return [
    ...findDuplicateSignals(
      asset.parts.map((part) => part.id),
      'duplicate_part_id',
      '/parts',
      'Part ids must be unique.',
    ),
    ...findDuplicateSignals(
      asset.materials.map((material) => material.id),
      'duplicate_material_id',
      '/materials',
      'Material ids must be unique.',
    ),
    ...findDuplicateSignals(
      asset.materials
        .map((material) => material.emissionAnimation?.id)
        .filter((id): id is string => typeof id === 'string'),
      'duplicate_material_animation_id',
      '/materials/*/emissionAnimation/id',
      'Material emission animation ids must be unique.',
    ),
    ...findDuplicateSignals(
      asset.joints.map((joint) => joint.id),
      'duplicate_joint_id',
      '/joints',
      'Joint ids must be unique.',
    ),
    ...findDuplicateSignals(
      controls.map((control) => control.id),
      'duplicate_control_id',
      '/controls',
      'Control ids must be unique.',
    ),
    ...findDuplicateSignals(
      asset.parts.flatMap((part) => part.visuals.map((visual) => visual.id)),
      'duplicate_visual_id',
      '/parts/*/visuals',
      'Visual ids must be unique within an asset because checks and allowances reference them.',
    ),
  ]
}

function findDuplicateSignals(
  ids: readonly string[],
  code: string,
  path: string,
  summary: string,
) {
  const signals: ValidationSignal[] = []
  const seen = new Set<string>()
  const reported = new Set<string>()

  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id)
      continue
    }

    if (reported.has(id)) {
      continue
    }

    reported.add(id)
    signals.push(
      createValidationSignal('model_validity', code, `${summary} Duplicate id: "${id}".`, {
        path,
        stage: 'structure',
      }),
    )
  }

  return signals
}

function validateRefs(
  asset: ManifestAsset,
  controls: ManifestAsset['controls'],
): ValidationSignal[] {
  const signals: ValidationSignal[] = []
  const partIds = new Set(asset.parts.map((part) => part.id))
  const materialIds = new Set(asset.materials.map((material) => material.id))
  const jointsById = new Map(asset.joints.map((joint) => [joint.id, joint]))

  for (const [partIndex, part] of asset.parts.entries()) {
    for (const [visualIndex, visual] of part.visuals.entries()) {
      if (!materialIds.has(visual.materialId)) {
        signals.push(
          createValidationSignal(
            'model_validity',
            'missing_material_reference',
            `Visual "${visual.id}" references missing material "${visual.materialId}".`,
            {
              path: `/parts/${partIndex}/visuals/${visualIndex}/materialId`,
              refs: { partId: part.id, visualId: visual.id },
              stage: 'structure',
            },
          ),
        )
      }
    }
  }

  for (const [jointIndex, joint] of asset.joints.entries()) {
    if (!partIds.has(joint.parentPartId)) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'joint_missing_parent',
          `Joint "${joint.id}" references missing parent part "${joint.parentPartId}".`,
          {
            path: `/joints/${jointIndex}/parentPartId`,
            refs: { jointId: joint.id },
            stage: 'structure',
          },
        ),
      )
    }

    if (!partIds.has(joint.childPartId)) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'joint_missing_child',
          `Joint "${joint.id}" references missing child part "${joint.childPartId}".`,
          {
            path: `/joints/${jointIndex}/childPartId`,
            refs: { jointId: joint.id },
            stage: 'structure',
          },
        ),
      )
    }

    if (joint.parentPartId === joint.childPartId) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'joint_self_reference',
          `Joint "${joint.id}" cannot connect a part to itself.`,
          {
            path: `/joints/${jointIndex}`,
            refs: { jointId: joint.id },
            stage: 'structure',
          },
        ),
      )
    }
  }

  for (const [controlIndex, control] of controls.entries()) {
    if (control.limits.lower >= control.limits.upper) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'control_limits_order',
          `Control "${control.id}" lower limit must be less than upper limit.`,
          {
            path: `/controls/${controlIndex}/limits`,
            refs: { controlId: control.id },
            stage: 'structure',
          },
        ),
      )
    }

    const seenJointIds = new Set<string>()

    for (const [bindingIndex, binding] of control.joints.entries()) {
      const bindingPath = `/controls/${controlIndex}/joints/${bindingIndex}`
      const joint = jointsById.get(binding.jointId)

      if (seenJointIds.has(binding.jointId)) {
        signals.push(
          createValidationSignal(
            'model_validity',
            'control_duplicate_joint',
            `Control "${control.id}" binds joint "${binding.jointId}" more than once.`,
            {
              path: bindingPath,
              refs: { controlId: control.id, jointId: binding.jointId },
              stage: 'structure',
            },
          ),
        )
      }

      seenJointIds.add(binding.jointId)

      if (!joint) {
        signals.push(
          createValidationSignal(
            'model_validity',
            'control_missing_joint',
            `Control "${control.id}" references missing joint "${binding.jointId}".`,
            {
              path: `${bindingPath}/jointId`,
              refs: { controlId: control.id, jointId: binding.jointId },
              stage: 'structure',
            },
          ),
        )
        continue
      }

      if (joint.type === 'fixed') {
        signals.push(
          createValidationSignal(
            'model_validity',
            'control_fixed_joint',
            `Control "${control.id}" references fixed joint "${binding.jointId}".`,
            {
              path: `${bindingPath}/jointId`,
              refs: { controlId: control.id, jointId: binding.jointId },
              stage: 'structure',
            },
          ),
        )
      }
    }
  }

  return signals
}

function validateControlMotionRanges(
  asset: ManifestAsset,
  controls: ManifestAsset['controls'],
) {
  const signals: ValidationSignal[] = []
  const jointsById = new Map(asset.joints.map((joint) => [joint.id, joint]))

  for (const [controlIndex, control] of controls.entries()) {
    if (control.limits.lower >= control.limits.upper) {
      continue
    }

    const movableBindings = control.joints
      .map((binding) => ({
        binding,
        joint: jointsById.get(binding.jointId),
      }))
      .filter(
        (entry): entry is {
          binding: ManifestJointControl['joints'][number]
          joint: ManifestJoint
        } => entry.joint !== undefined && entry.joint.type !== 'fixed',
      )

    if (movableBindings.length === 0) {
      continue
    }

    const hasEffectiveMotion = movableBindings.some(({ binding, joint }) => {
      if (Math.abs(binding.scale) <= 1e-8) {
        return false
      }

      const lower = resolveControlBindingJointValue(
        joint,
        binding,
        control.limits.lower,
      )
      const upper = resolveControlBindingJointValue(
        joint,
        binding,
        control.limits.upper,
      )

      return (
        lower !== null &&
        upper !== null &&
        Math.abs(upper - lower) > 1e-8
      )
    })

    if (!hasEffectiveMotion) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'control_no_effective_motion',
          `Control "${control.id}" does not move any bound joint through its authored limits.`,
          {
            details:
              'Adjust control lower/upper, binding scale, or binding offset so the control range maps into at least one bound joint range.',
            path: `/controls/${controlIndex}/limits`,
            refs: { controlId: control.id },
            stage: 'structure',
          },
        ),
      )
    }
  }

  return signals
}

function validateMovableControlCoverage(
  asset: ManifestAsset,
  controls: ManifestAsset['controls'],
): ValidationSignal[] {
  const movableJoints = asset.joints.filter((joint) => joint.type !== 'fixed')

  if (movableJoints.length <= 1) {
    return []
  }

  if (controls.length === 0) {
    return [
      createValidationSignal(
        'model_validity',
        'movable_joints_missing_controls',
        `Asset has ${movableJoints.length} movable joints but no manifest controls.`,
        {
          details:
            'Group linked mechanisms into controls, and give independent moving mechanisms their own control instead of relying on fallback joint dials.',
          path: '/controls',
          refs: { jointIds: movableJoints.map((joint) => joint.id).join(', ') },
          stage: 'structure',
        },
      ),
    ]
  }

  const controlledJointIds = new Set(
    controls.flatMap((control) =>
      control.joints.map((binding) => binding.jointId),
    ),
  )
  const missingControlJoints = movableJoints.filter(
    (joint) => !controlledJointIds.has(joint.id),
  )

  if (missingControlJoints.length === 0) {
    return []
  }

  return [
    createValidationSignal(
      'model_validity',
      'movable_joint_missing_control',
      `Movable joints need manifest controls: ${missingControlJoints.map((joint) => joint.id).join(', ')}.`,
      {
        details:
          'Controls are the authored mechanism contract used by preview and dynamic GLB export; avoid leaving multi-joint assets to fallback one-joint dials.',
        path: '/controls',
        refs: {
          jointIds: missingControlJoints.map((joint) => joint.id).join(', '),
        },
        stage: 'structure',
      },
    ),
  ]
}

function validateMaterialEmissionAnimations(asset: ManifestAsset) {
  const signals: ValidationSignal[] = []

  for (const [materialIndex, material] of asset.materials.entries()) {
    const animation = material.emissionAnimation

    if (!animation) {
      continue
    }

    const path = `/materials/${materialIndex}/emissionAnimation`
    const keyframes = animation.keyframes

    if (keyframes.length < 2) {
      continue
    }

    if (Math.abs(keyframes[0].time) > 1e-8) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'material_emission_animation_start_time',
          `Material "${material.id}" emission animation must start at time 0.`,
          {
            details:
              'Start material emission keyframes at zero seconds so preview and GLB animation rest state are unambiguous.',
            path: `${path}/keyframes/0/time`,
            refs: {
              materialAnimationId: animation.id,
              materialId: material.id,
            },
            stage: 'structure',
          },
        ),
      )
    }

    for (let index = 1; index < keyframes.length; index += 1) {
      if (keyframes[index].time <= keyframes[index - 1].time) {
        signals.push(
          createValidationSignal(
            'model_validity',
            'material_emission_keyframe_time_order',
            `Material "${material.id}" emission keyframe times must be strictly increasing.`,
            {
              path: `${path}/keyframes/${index}/time`,
              refs: {
                materialAnimationId: animation.id,
                materialId: material.id,
              },
              stage: 'structure',
            },
          ),
        )
      }
    }

    if (!hasVisibleMaterialEmissionMotion(keyframes)) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'material_emission_animation_static',
          `Material "${material.id}" emission animation has no visible emission change.`,
          {
            details:
              'Change emissive color, on/off state, or intensity across keyframes; omit emissionAnimation for a static emissive material.',
            path,
            refs: {
              materialAnimationId: animation.id,
              materialId: material.id,
            },
            stage: 'structure',
          },
        ),
      )
    }
  }

  return signals
}

function validateAllowanceRefs(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []
  const partIds = new Set(asset.parts.map((part) => part.id))
  const visualPartIds = new Map<string, string>()

  for (const part of asset.parts) {
    for (const visual of part.visuals) {
      visualPartIds.set(visual.id, part.id)
    }
  }

  for (const [allowanceIndex, allowance] of asset.allowances.entries()) {
    const allowancePath = `/allowances/${allowanceIndex}`

    switch (allowance.type) {
      case 'allow_overlap': {
        if (allowance.partAId === allowance.partBId) {
          signals.push(
            createValidationSignal(
              'model_validity',
              'allowance_overlap_same_part',
              `Overlap allowance cannot target the same part "${allowance.partAId}" on both sides.`,
              {
                path: allowancePath,
                refs: { partId: allowance.partAId },
                stage: 'structure',
              },
            ),
          )
        }

        if (!partIds.has(allowance.partAId)) {
          signals.push(
            createValidationSignal(
              'model_validity',
              'allowance_missing_part',
              `Overlap allowance references missing part "${allowance.partAId}".`,
              {
                path: `${allowancePath}/partAId`,
                refs: { partId: allowance.partAId },
                stage: 'structure',
              },
            ),
          )
        }

        if (!partIds.has(allowance.partBId)) {
          signals.push(
            createValidationSignal(
              'model_validity',
              'allowance_missing_part',
              `Overlap allowance references missing part "${allowance.partBId}".`,
              {
                path: `${allowancePath}/partBId`,
                refs: { partId: allowance.partBId },
                stage: 'structure',
              },
            ),
          )
        }

        if (allowance.visualAId) {
          signals.push(
            ...validateAllowanceVisualRef({
              expectedPartId: allowance.partAId,
              path: `${allowancePath}/visualAId`,
              side: 'A',
              visualId: allowance.visualAId,
              visualPartIds,
            }),
          )
        }

        if (allowance.visualBId) {
          signals.push(
            ...validateAllowanceVisualRef({
              expectedPartId: allowance.partBId,
              path: `${allowancePath}/visualBId`,
              side: 'B',
              visualId: allowance.visualBId,
              visualPartIds,
            }),
          )
        }

        break
      }
      case 'allow_isolated_part':
        if (!partIds.has(allowance.partId)) {
          signals.push(
            createValidationSignal(
              'model_validity',
              'allowance_missing_part',
              `Isolation allowance references missing part "${allowance.partId}".`,
              {
                path: `${allowancePath}/partId`,
                refs: { partId: allowance.partId },
                stage: 'structure',
              },
            ),
          )
        }
        break
    }
  }

  return signals
}

function validateAllowanceVisualRef({
  expectedPartId,
  path,
  side,
  visualId,
  visualPartIds,
}: {
  expectedPartId: string
  path: string
  side: 'A' | 'B'
  visualId: string
  visualPartIds: ReadonlyMap<string, string>
}) {
  const actualPartId = visualPartIds.get(visualId)

  if (!actualPartId) {
    return [
      createValidationSignal(
        'model_validity',
        'allowance_missing_visual',
        `Overlap allowance side ${side} references missing visual "${visualId}".`,
        {
          path,
          refs: { visualId },
          stage: 'structure',
        },
      ),
    ]
  }

  if (actualPartId !== expectedPartId) {
    return [
      createValidationSignal(
        'model_validity',
        'allowance_visual_wrong_part',
        `Overlap allowance side ${side} references visual "${visualId}" on part "${actualPartId}", not "${expectedPartId}".`,
        {
          path,
          refs: { expectedPartId, visualId },
          stage: 'structure',
        },
      ),
    ]
  }

  return []
}

function validateOverlapAllowanceContracts(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []

  for (const [allowanceIndex, allowance] of asset.allowances.entries()) {
    if (allowance.type !== 'allow_overlap') {
      continue
    }

    const allowancePath = `/allowances/${allowanceIndex}`

    if (!allowance.visualAId || !allowance.visualBId) {
      signals.push(
        createValidationSignal(
          'allowance',
          'allowance_overlap_broad_scope',
          `Overlap allowance between "${allowance.partAId}" and "${allowance.partBId}" is not scoped to an exact visual pair.`,
          {
            details:
              'Prefer visualAId and visualBId so validation feedback can distinguish intentional fitted contact from accidental part-wide collision.',
            path: allowancePath,
            refs: {
              partAId: allowance.partAId,
              partBId: allowance.partBId,
            },
            severity: 'warning',
            stage: 'structure',
          },
        ),
      )
    }

    if (!hasOverlapAllowanceProofCheck(asset.checks, allowance)) {
      signals.push(
        createValidationSignal(
          'allowance',
          'allowance_overlap_missing_proof_check',
          `Overlap allowance between "${allowance.partAId}" and "${allowance.partBId}" needs a matching authored proof check.`,
          {
            details:
              'Add or correct an expect_contact, expect_path_contacts, expect_gap, expect_overlap, or expect_within check for the same part pair and, when the allowance names visuals, the same visual pair.',
            path: allowancePath,
            refs: {
              partAId: allowance.partAId,
              partBId: allowance.partBId,
              ...(allowance.visualAId ? { visualAId: allowance.visualAId } : {}),
              ...(allowance.visualBId ? { visualBId: allowance.visualBId } : {}),
            },
            stage: 'structure',
          },
        ),
      )
    }
  }

  return signals
}

function hasOverlapAllowanceProofCheck(
  checks: readonly ManifestCheck[],
  allowance: Extract<ManifestAllowance, { type: 'allow_overlap' }>,
) {
  return checks.some((check) => proofCheckMatchesAllowance(check, allowance))
}

function proofCheckMatchesAllowance(
  check: ManifestCheck,
  allowance: Extract<ManifestAllowance, { type: 'allow_overlap' }>,
) {
  switch (check.type) {
    case 'expect_contact':
    case 'expect_overlap':
      return partVisualPairMatchesAllowance(
        {
          partAId: check.partAId,
          partBId: check.partBId,
          visualAId: check.visualAId,
          visualBId: check.visualBId,
        },
        allowance,
      )
    case 'expect_gap':
      return partVisualPairMatchesAllowance(
        {
          partAId: check.positivePartId,
          partBId: check.negativePartId,
          visualAId: check.positiveVisualId,
          visualBId: check.negativeVisualId,
        },
        allowance,
      )
    case 'expect_within':
      return partVisualPairMatchesAllowance(
        {
          partAId: check.innerPartId,
          partBId: check.outerPartId,
          visualAId: check.innerVisualId,
          visualBId: check.outerVisualId,
        },
        allowance,
      )
    case 'expect_path_contacts':
      return check.targets.some((target) =>
        partVisualPairMatchesAllowance(
          {
            partAId: check.pathPartId,
            partBId: target.partId,
            visualAId: check.pathVisualId,
            visualBId: target.visualId,
          },
          allowance,
        ),
      )
    case 'joint_exists':
    case 'part_exists':
    case 'expect_material_side':
      return false
    default:
      return assertNever(check)
  }
}

function validateSurfaceSideContracts(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []
  const materialById = new Map(asset.materials.map((material) => [material.id, material]))

  for (const [partIndex, part] of asset.parts.entries()) {
    for (const [visualIndex, visual] of part.visuals.entries()) {
      if (!isSurfaceSideSensitiveGeometry(visual.geometry)) {
        continue
      }

      const material = materialById.get(visual.materialId)

      if (!material) {
        continue
      }

      const side = normalizeManifestMaterialSide(material.side)

      if (hasMatchingMaterialSideCheck(asset.checks, visual.id, side)) {
        continue
      }

      signals.push(
        createValidationSignal(
          'authored_checks',
          'surface_side_missing_check',
          `Surface-sensitive visual "${visual.id}" needs an authored material-side check.`,
          {
            details:
              'Open or cutaway lathe surfaces can disappear from some viewing angles when rendered single-sided. Add expect_material_side for this visual, and use material.side double when both faces should be visible.',
            path: `/parts/${partIndex}/visuals/${visualIndex}/geometry`,
            refs: {
              materialId: material.id,
              materialSide: side,
              partId: part.id,
              visualId: visual.id,
            },
            source: 'checks',
            stage: 'structure',
          },
        ),
      )
    }
  }

  return signals
}

function hasMatchingMaterialSideCheck(
  checks: readonly ManifestCheck[],
  visualId: string,
  side: string,
) {
  return checks.some(
    (check) =>
      check.type === 'expect_material_side' &&
      check.visualId === visualId &&
      check.side === side,
  )
}

function isSurfaceSideSensitiveGeometry(geometry: ManifestGeometry) {
  if (geometry.type !== 'lathe') {
    return false
  }

  const firstPoint = geometry.points[0]
  const lastPoint = geometry.points[geometry.points.length - 1]

  if (!firstPoint || !lastPoint) {
    return false
  }

  const phiLength = geometry.phiLength ?? fullLatheSweep
  const hasFullSweep = Math.abs(phiLength - fullLatheSweep) <= latheSweepEpsilon
  const profileTouchesAxisAtEnds =
    Math.abs(firstPoint[0]) <= latheAxisEpsilon &&
    Math.abs(lastPoint[0]) <= latheAxisEpsilon

  return !hasFullSweep || !profileTouchesAxisAtEnds
}

function partVisualPairMatchesAllowance(
  pair: {
    partAId: string
    partBId: string
    visualAId?: string
    visualBId?: string
  },
  allowance: Extract<ManifestAllowance, { type: 'allow_overlap' }>,
) {
  return (
    orderedPartVisualPairMatchesAllowance(pair, allowance) ||
    orderedPartVisualPairMatchesAllowance(
      {
        partAId: pair.partBId,
        partBId: pair.partAId,
        visualAId: pair.visualBId,
        visualBId: pair.visualAId,
      },
      allowance,
    )
  )
}

function orderedPartVisualPairMatchesAllowance(
  pair: {
    partAId: string
    partBId: string
    visualAId?: string
    visualBId?: string
  },
  allowance: Extract<ManifestAllowance, { type: 'allow_overlap' }>,
) {
  if (
    pair.partAId !== allowance.partAId ||
    pair.partBId !== allowance.partBId
  ) {
    return false
  }

  if (allowance.visualAId && pair.visualAId !== allowance.visualAId) {
    return false
  }

  if (allowance.visualBId && pair.visualBId !== allowance.visualBId) {
    return false
  }

  return true
}

function validateJointTree(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []
  const partIds = new Set(asset.parts.map((part) => part.id))
  const parentToChildren = new Map<string, string[]>()
  const childToJoint = new Map<string, ManifestJoint>()

  for (const part of asset.parts) {
    parentToChildren.set(part.id, [])
  }

  for (const joint of asset.joints) {
    if (!partIds.has(joint.parentPartId) || !partIds.has(joint.childPartId)) {
      continue
    }

    parentToChildren.get(joint.parentPartId)?.push(joint.childPartId)

    const existingParentJoint = childToJoint.get(joint.childPartId)

    if (existingParentJoint) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'part_multiple_parent_joints',
          `Part "${joint.childPartId}" has multiple parent joints: "${existingParentJoint.id}" and "${joint.id}".`,
          {
            refs: { childPartId: joint.childPartId, jointId: joint.id },
            stage: 'structure',
          },
        ),
      )
    } else {
      childToJoint.set(joint.childPartId, joint)
    }
  }

  const roots = asset.parts.filter((part) => !childToJoint.has(part.id))

  if (roots.length === 0) {
    signals.push(
      createValidationSignal(
        'single_root_policy',
        'root_part_missing',
        'Asset has no root part; every part is a joint child, which implies a cycle or invalid assembly tree.',
        { path: '/joints', stage: 'structure' },
      ),
    )
    return signals
  }

  if (roots.length > 1) {
    signals.push(
      createValidationSignal(
        'single_root_policy',
        'root_part_count',
        `Asset must have exactly one root part, but found ${roots.length}: ${roots.map((part) => part.id).join(', ')}.`,
        { path: '/parts', stage: 'structure' },
      ),
    )
    return signals
  }

  const visited = new Set<string>()
  const visiting = new Set<string>()
  const cycleParts = new Set<string>()

  function visit(partId: string) {
    if (visiting.has(partId)) {
      cycleParts.add(partId)
      return
    }

    if (visited.has(partId)) {
      return
    }

    visiting.add(partId)

    for (const childId of parentToChildren.get(partId) ?? []) {
      visit(childId)
    }

    visiting.delete(partId)
    visited.add(partId)
  }

  visit(roots[0].id)

  if (cycleParts.size > 0) {
    signals.push(
      createValidationSignal(
        'single_root_policy',
        'joint_tree_cycle',
        `Joint tree contains a cycle involving: ${[...cycleParts].join(', ')}.`,
        { path: '/joints', stage: 'structure' },
      ),
    )
  }

  const unreachablePartIds = asset.parts
    .map((part) => part.id)
    .filter((partId) => !visited.has(partId))

  if (unreachablePartIds.length > 0) {
    signals.push(
      createValidationSignal(
        'single_root_policy',
        'part_unreachable',
        `Parts are unreachable from the root joint tree: ${unreachablePartIds.join(', ')}.`,
        { path: '/joints', stage: 'structure' },
      ),
    )
  }

  return signals
}

function validateJointSemantics(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []

  for (const [jointIndex, joint] of asset.joints.entries()) {
    const jointPath = `/joints/${jointIndex}`

    if (requiresAxis(joint.type) && !hasNonzeroAxis(joint.axis)) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'joint_axis_required',
          `Joint "${joint.id}" needs a nonzero axis for ${joint.type} motion.`,
          {
            path: `${jointPath}/axis`,
            refs: { jointId: joint.id },
            stage: 'structure',
          },
        ),
      )
    }

    if (joint.type === 'fixed' && joint.limits) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'fixed_joint_limits_unsupported',
          `Fixed joint "${joint.id}" must not include motion limits.`,
          {
            path: `${jointPath}/limits`,
            refs: { jointId: joint.id },
            stage: 'structure',
          },
        ),
      )
    }

    if (joint.type === 'revolute' || joint.type === 'prismatic') {
      signals.push(...validateBoundedJointLimits(joint, jointPath))
    }

    if (joint.type === 'continuous') {
      if (!joint.limits) {
        signals.push(
          createValidationSignal(
            'model_validity',
            'continuous_limits_required',
            `Continuous joint "${joint.id}" should include positive effort and velocity limits without lower/upper bounds.`,
            {
              path: `${jointPath}/limits`,
              refs: { jointId: joint.id },
              stage: 'structure',
            },
          ),
        )
      } else {
        if (
          joint.limits.lower !== undefined ||
          joint.limits.upper !== undefined
        ) {
          signals.push(
            createValidationSignal(
              'model_validity',
              'continuous_joint_lower_upper_unsupported',
              `Continuous joint "${joint.id}" must not include lower or upper limits.`,
              {
                path: `${jointPath}/limits`,
                refs: { jointId: joint.id },
                stage: 'structure',
              },
            ),
          )
        }

        if (
          joint.limits.effort === undefined ||
          joint.limits.velocity === undefined
        ) {
          signals.push(
            createValidationSignal(
              'model_validity',
              'continuous_effort_velocity_required',
              `Continuous joint "${joint.id}" needs positive effort and velocity limits.`,
              {
                path: `${jointPath}/limits`,
                refs: { jointId: joint.id },
                stage: 'structure',
              },
            ),
          )
        }
      }
    }
  }

  return signals
}

function validateBoundedJointLimits(joint: ManifestJoint, jointPath: string) {
  const signals: ValidationSignal[] = []

  if (joint.limits?.lower === undefined || joint.limits.upper === undefined) {
    signals.push(
      createValidationSignal(
        'model_validity',
        `${joint.type}_limits_required`,
        `${capitalizeJointType(joint.type)} joint "${joint.id}" needs lower and upper limits.`,
        {
          path: `${jointPath}/limits`,
          refs: { jointId: joint.id },
          stage: 'structure',
        },
      ),
    )

    return signals
  }

  if (joint.limits.lower > joint.limits.upper) {
    signals.push(
      createValidationSignal(
        'model_validity',
        'joint_limits_order',
        `Joint "${joint.id}" lower limit must not exceed its upper limit.`,
        {
          path: `${jointPath}/limits`,
          refs: { jointId: joint.id },
          stage: 'structure',
        },
      ),
    )
  }

  if (
    joint.type === 'prismatic' &&
    joint.limits.upper - joint.limits.lower > maxPrismaticTravelMeters
  ) {
    signals.push(
      createValidationSignal(
        'model_validity',
        'prismatic_limits_too_large',
        `Prismatic joint "${joint.id}" has more than ${maxPrismaticTravelMeters} meters of travel.`,
        {
          path: `${jointPath}/limits`,
          refs: { jointId: joint.id },
          stage: 'structure',
        },
      ),
    )
  }

  return signals
}

type MaterialEmissionKeyframe = NonNullable<
  ManifestAsset['materials'][number]['emissionAnimation']
>['keyframes'][number]

function hasVisibleMaterialEmissionMotion(
  keyframes: readonly MaterialEmissionKeyframe[],
) {
  const firstState = getVisibleMaterialEmissionState(keyframes[0])

  return keyframes.slice(1).some((keyframe) => {
    const state = getVisibleMaterialEmissionState(keyframe)

    return (
      Math.abs(state.intensity - firstState.intensity) > 1e-8 ||
      ((state.intensity > 1e-8 || firstState.intensity > 1e-8) &&
        state.color !== firstState.color)
    )
  })
}

function getVisibleMaterialEmissionState(keyframe: MaterialEmissionKeyframe) {
  return {
    color: keyframe.color.toLowerCase(),
    intensity: keyframe.hasEmission ? keyframe.intensity : 0,
  }
}

function resolveControlBindingJointValue(
  joint: ManifestJoint,
  binding: ManifestJointControl['joints'][number],
  controlValue: number,
) {
  const value = binding.offset + binding.scale * controlValue

  if (joint.type === 'continuous') {
    return value
  }

  if (joint.type === 'revolute' || joint.type === 'prismatic') {
    if (joint.limits?.lower === undefined || joint.limits.upper === undefined) {
      return null
    }

    return clamp(value, joint.limits.lower, joint.limits.upper)
  }

  return null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function requiresAxis(jointType: ManifestJointType) {
  return jointType === 'revolute' ||
    jointType === 'prismatic' ||
    jointType === 'continuous'
}

function hasNonzeroAxis(axis: ManifestVector3 | undefined) {
  if (!axis) {
    return false
  }

  return (
    Number.isFinite(axis[0]) &&
    Number.isFinite(axis[1]) &&
    Number.isFinite(axis[2]) &&
    Math.hypot(axis[0], axis[1], axis[2]) > axisLengthEpsilon
  )
}

function capitalizeJointType(jointType: ManifestJointType) {
  return jointType.charAt(0).toUpperCase() + jointType.slice(1)
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D structure value: ${JSON.stringify(value)}`)
}
