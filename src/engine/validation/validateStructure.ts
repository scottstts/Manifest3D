import type {
  ManifestAsset,
  ManifestJoint,
  ManifestJointType,
  ManifestVector3,
} from '../schema/manifestTypes'
import type { ValidationSignal } from '../schema/validationTypes'
import { createValidationSignal } from './reportBuilder'

const axisLengthEpsilon = 0.000001
const maxPrismaticTravelMeters = 10

export function validateStructure(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []

  signals.push(...validateUniqueIds(asset))
  signals.push(...validateRefs(asset))
  signals.push(...validateAllowanceRefs(asset))
  signals.push(...validateJointTree(asset))
  signals.push(...validateJointSemantics(asset))

  return signals
}

function validateUniqueIds(asset: ManifestAsset): ValidationSignal[] {
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
      asset.joints.map((joint) => joint.id),
      'duplicate_joint_id',
      '/joints',
      'Joint ids must be unique.',
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

function validateRefs(asset: ManifestAsset): ValidationSignal[] {
  const signals: ValidationSignal[] = []
  const partIds = new Set(asset.parts.map((part) => part.id))
  const materialIds = new Set(asset.materials.map((material) => material.id))

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
