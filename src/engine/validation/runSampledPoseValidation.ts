import {
  buildManifestAsset,
  disposeManifestObject,
  type BuiltManifestAsset,
} from '../geometry/assetBuilder'
import {
  createGeneratedJointPoseSamples,
  resolvePoseSpecValues,
  type JointPoseSample,
  type JointPoseValues,
} from '../geometry/jointPoses'
import {
  findCurrentPoseVisualOverlaps,
  type GeometryOverlapFinding,
} from '../geometry/overlapChecks'
import * as THREE from 'three/webgpu'
import type { ManifestAsset } from '../schema/manifestTypes'
import type { ValidationSignal } from '../schema/validationTypes'
import { createValidationSignal } from './reportBuilder'
import { isOverlapAllowed } from './runAllowances'
import {
  runPromptChecks,
  type IndexedManifestCheck,
} from './runPromptChecks'

const sampledPoseOverlapToleranceMeters = 0.001
const sampledPoseOverlapVolumeToleranceCubicMeters = 1e-8
const relativeTransformTolerance = 1e-6

const overlapOptions = {
  overlapTolerance: sampledPoseOverlapToleranceMeters,
  volumeTolerance: sampledPoseOverlapVolumeToleranceCubicMeters,
}

export function runSampledPoseValidation(
  asset: ManifestAsset,
  restBuiltAsset?: BuiltManifestAsset,
) {
  const poseSpecificChecks = asset.checks
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => check.pose)
  const generatedSamples = createGeneratedJointPoseSamples(asset)
  const authoredSamples = createAuthoredPoseSamples(asset, poseSpecificChecks)
  const signals: ValidationSignal[] = []
  const activeRestBuiltAsset = restBuiltAsset ?? buildManifestAsset(asset)

  signals.push(...authoredSamples.signals)

  const allSamples = dedupeSamples([
    ...generatedSamples,
    ...authoredSamples.samples,
  ])
  const restOverlapKeys = new Set(
    findCurrentPoseVisualOverlaps(activeRestBuiltAsset, overlapOptions).map(
      getOverlapFindingKey,
    ),
  )

  try {
    for (const sample of allSamples) {
      const builtAsset = buildManifestAsset(asset, {
        jointPoses: sample.poses,
      })

      try {
        signals.push(
          ...runSampledPoseOverlapQc(asset, sample, builtAsset, {
            restBuiltAsset: activeRestBuiltAsset,
            restOverlapKeys,
          }),
        )

        const checksForPose = poseSpecificChecks.filter(
          ({ check }) =>
            check.pose && resolvedPoseKey(asset, check.pose) === poseValuesKey(sample.poses),
        )

        if (checksForPose.length > 0) {
          signals.push(
            ...runPromptChecks(asset, builtAsset, {
              checks: checksForPose,
              includeMissingChecksWarning: false,
              poseLabel: formatSampleLabel(sample),
              stage: 'sampled_poses',
            }),
          )
        }
      } finally {
        disposeManifestObject(builtAsset.group)
      }
    }
  } finally {
    if (!restBuiltAsset) {
      disposeManifestObject(activeRestBuiltAsset.group)
    }
  }

  return signals
}

function createAuthoredPoseSamples(
  asset: ManifestAsset,
  checks: readonly IndexedManifestCheck[],
) {
  const samples: JointPoseSample[] = []
  const signals: ValidationSignal[] = []

  for (const { check, index } of checks) {
    if (!check.pose) {
      continue
    }

    const resolved = resolvePoseSpecValues(asset, check.pose)

    if (resolved.errors.length > 0) {
      signals.push(
        createValidationSignal(
          'sampled_pose',
          'sampled_pose_invalid',
          `Authored check "${check.type}" has an invalid sampled pose.`,
          {
            details: resolved.errors.join(' '),
            path: `/checks/${index}/pose`,
            source: 'checks',
            stage: 'sampled_poses',
          },
        ),
      )
      continue
    }

    samples.push({
      id: `authored:${index}:${poseValuesKey(resolved.poseValues)}`,
      label: check.pose.name ?? `check ${index + 1}`,
      poses: resolved.poseValues,
      source: 'authored_check',
    })
  }

  return {
    samples,
    signals,
  }
}

function runSampledPoseOverlapQc(
  asset: ManifestAsset,
  sample: JointPoseSample,
  builtAsset: BuiltManifestAsset,
  restContext: {
    restBuiltAsset: BuiltManifestAsset
    restOverlapKeys: ReadonlySet<string>
  },
) {
  const signals: ValidationSignal[] = []
  const findings = findCurrentPoseVisualOverlaps(builtAsset, overlapOptions)

  for (const finding of findings) {
    if (isRigidSharedPoseArtifact(finding, builtAsset, restContext)) {
      continue
    }

    const details = [
      formatOverlapDetails(finding.depth, finding.volume),
      `pose=${formatSampleLabel(sample)}`,
      `joints=${formatPoseValues(sample.poses)}`,
    ].join(' ')

    if (isOverlapAllowed(finding, asset.allowances)) {
      signals.push(
        createValidationSignal(
          'sampled_pose_overlap',
          'part_overlap_sampled_pose_allowed',
          `Sampled-pose overlap between "${finding.partAId}" and "${finding.partBId}" is covered by an authored allowance.`,
          {
            details,
            group: 'qc',
            refs: {
              partAId: finding.partAId,
              partBId: finding.partBId,
              poseValues: formatPoseValues(sample.poses),
              visualAId: finding.visualAId,
              visualBId: finding.visualBId,
            },
            severity: 'note',
            source: 'baseline_qc',
            stage: 'sampled_poses',
          },
        ),
      )
      continue
    }

    signals.push(
      createValidationSignal(
        'sampled_pose_overlap',
        'part_overlap_sampled_pose',
        `Sampled-pose overlap detected between "${finding.partAId}" and "${finding.partBId}".`,
        {
          details,
          group: 'qc',
          refs: {
            partAId: finding.partAId,
            partBId: finding.partBId,
            poseValues: formatPoseValues(sample.poses),
            visualAId: finding.visualAId,
            visualBId: finding.visualBId,
          },
          source: 'baseline_qc',
          stage: 'sampled_poses',
        },
      ),
    )
  }

  return signals
}

function isRigidSharedPoseArtifact(
  finding: GeometryOverlapFinding,
  builtAsset: BuiltManifestAsset,
  {
    restBuiltAsset,
    restOverlapKeys,
  }: {
    restBuiltAsset: BuiltManifestAsset
    restOverlapKeys: ReadonlySet<string>
  },
) {
  if (restOverlapKeys.has(getOverlapFindingKey(finding))) {
    return false
  }

  return haveSameRelativePartTransform(
    restBuiltAsset,
    builtAsset,
    finding.partAId,
    finding.partBId,
  )
}

function haveSameRelativePartTransform(
  restBuiltAsset: BuiltManifestAsset,
  sampledBuiltAsset: BuiltManifestAsset,
  partAId: string,
  partBId: string,
) {
  const restRelative = getPartRelativeMatrix(restBuiltAsset, partAId, partBId)
  const sampledRelative = getPartRelativeMatrix(sampledBuiltAsset, partAId, partBId)

  if (!restRelative || !sampledRelative) {
    return false
  }

  return matricesApproximatelyEqual(
    restRelative,
    sampledRelative,
    relativeTransformTolerance,
  )
}

function getPartRelativeMatrix(
  builtAsset: BuiltManifestAsset,
  partAId: string,
  partBId: string,
) {
  const partA = builtAsset.partGroups.get(partAId)
  const partB = builtAsset.partGroups.get(partBId)

  if (!partA || !partB) {
    return null
  }

  return new THREE.Matrix4()
    .copy(partA.matrixWorld)
    .invert()
    .multiply(partB.matrixWorld)
}

function matricesApproximatelyEqual(
  left: THREE.Matrix4,
  right: THREE.Matrix4,
  tolerance: number,
) {
  return left.elements.every(
    (value, index) => Math.abs(value - right.elements[index]) <= tolerance,
  )
}

function getOverlapFindingKey(finding: GeometryOverlapFinding) {
  return [
    `${finding.partAId}:${finding.visualAId}`,
    `${finding.partBId}:${finding.visualBId}`,
  ].sort().join('|')
}

function dedupeSamples(samples: readonly JointPoseSample[]) {
  const samplesByPose = new Map<string, JointPoseSample>()

  for (const sample of samples) {
    const key = poseValuesKey(sample.poses)
    const existing = samplesByPose.get(key)

    if (!existing || sample.source === 'authored_check') {
      samplesByPose.set(key, sample)
    }
  }

  return [...samplesByPose.values()]
}

function resolvedPoseKey(
  asset: ManifestAsset,
  pose: { joints: readonly { jointId: string; value: number }[] },
) {
  const resolved = resolvePoseSpecValues(asset, pose)

  return resolved.errors.length === 0 ? poseValuesKey(resolved.poseValues) : null
}

function poseValuesKey(values: JointPoseValues) {
  return Object.entries(values)
    .filter(([, value]) => Number.isFinite(value))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([jointId, value]) => `${jointId}:${value.toFixed(6)}`)
    .join('|')
}

function formatPoseValues(values: JointPoseValues) {
  return Object.entries(values)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([jointId, value]) => `${jointId}=${value.toFixed(4)}`)
    .join(',')
}

function formatSampleLabel(sample: JointPoseSample) {
  return `${sample.label} (${formatPoseValues(sample.poses)})`
}

function formatOverlapDetails(depth: { x: number; y: number; z: number }, volume: number) {
  return `depth=(${depth.x.toFixed(4)}, ${depth.y.toFixed(4)}, ${depth.z.toFixed(4)}) volume=${volume.toExponential(3)}`
}
