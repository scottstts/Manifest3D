import {
  buildManifestAsset,
  disposeManifestObject,
} from '../geometry/assetBuilder'
import {
  createGeneratedJointPoseSamples,
  resolvePoseSpecValues,
  type JointPoseSample,
  type JointPoseValues,
} from '../geometry/jointPoses'
import { findCurrentPoseVisualOverlaps } from '../geometry/overlapChecks'
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

export function runSampledPoseValidation(asset: ManifestAsset) {
  const poseSpecificChecks = asset.checks
    .map((check, index) => ({ check, index }))
    .filter(({ check }) => check.pose)
  const generatedSamples = createGeneratedJointPoseSamples(asset)
  const authoredSamples = createAuthoredPoseSamples(asset, poseSpecificChecks)
  const signals: ValidationSignal[] = []

  signals.push(...authoredSamples.signals)

  const allSamples = dedupeSamples([
    ...generatedSamples,
    ...authoredSamples.samples,
  ])

  for (const sample of allSamples) {
    const builtAsset = buildManifestAsset(asset, {
      jointPoses: sample.poses,
    })

    try {
      signals.push(...runSampledPoseOverlapQc(asset, sample, builtAsset))

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
  builtAsset: ReturnType<typeof buildManifestAsset>,
) {
  const signals: ValidationSignal[] = []
  const findings = findCurrentPoseVisualOverlaps(builtAsset, {
    overlapTolerance: sampledPoseOverlapToleranceMeters,
    volumeTolerance: sampledPoseOverlapVolumeToleranceCubicMeters,
  })

  for (const finding of findings) {
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
