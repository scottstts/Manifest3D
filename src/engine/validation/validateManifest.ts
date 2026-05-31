import * as THREE from 'three/webgpu'
import { buildManifestAsset, disposeManifestObject } from '../geometry/assetBuilder'
import { manifestAssetSchema } from '../schema/manifestSchema'
import type { ManifestAsset } from '../schema/manifestTypes'
import type {
  ValidationReport,
  ValidationSignal,
  ValidationStage,
} from '../schema/validationTypes'
import {
  createValidationReport,
  createValidationSignal,
  hasBlockingSignals,
} from './reportBuilder'
import { runBaselineQc } from './runBaselineQc'
import { runPromptChecks } from './runPromptChecks'
import { runSampledPoseValidation } from './runSampledPoseValidation'
import { validateGeometryDescriptors } from './validateGeometryDescriptors'
import { validateStructure } from './validateStructure'
import {
  createManifestProbeReport,
  type ManifestProbeReport,
} from './probeReport'

export type ManifestValidationResult = {
  asset: ManifestAsset | null
  probeReport: ManifestProbeReport | null
  report: ValidationReport
}

export function validateManifestAssetCandidate(
  candidate: unknown,
): ManifestValidationResult {
  const signals: ValidationSignal[] = []
  const skippedStages = new Set<ValidationStage>()
  const parsedCandidate = manifestAssetSchema.safeParse(candidate)
  let probeReport: ManifestProbeReport | null = null

  if (!parsedCandidate.success) {
    for (const schemaIssue of parsedCandidate.error.issues) {
      signals.push(
        createValidationSignal(
          'schema_parse',
          'schema_invalid',
          schemaIssue.message,
          {
            path: formatSchemaPath(schemaIssue.path),
            source: 'schema',
            stage: 'schema',
          },
        ),
      )
    }

    markSkipped(skippedStages, [
      'structure',
      'build',
      'baseline_qc',
      'checks',
      'sampled_poses',
      'export',
    ])

    return {
      asset: null,
      probeReport: null,
      report: createValidationReport({
        asset: null,
        signals,
        skippedStages,
      }),
    }
  }

  const asset = parsedCandidate.data as ManifestAsset

  signals.push(...validateStructure(asset))
  signals.push(...validateGeometryDescriptors(asset))

  if (hasBlockingSignals(signals, ['structure'])) {
    markSkipped(skippedStages, [
      'build',
      'baseline_qc',
      'checks',
      'sampled_poses',
      'export',
    ])

    return {
      asset,
      probeReport: null,
      report: createValidationReport({
        asset,
        signals,
        skippedStages,
      }),
    }
  }

  try {
    const builtAsset = buildManifestAsset(asset)

    try {
      signals.push(...runBaselineQc(asset, builtAsset))
      signals.push(...runPromptChecks(asset, builtAsset))
      signals.push(...runSampledPoseValidation(asset, builtAsset))
      signals.push(...runExportReadiness(asset, builtAsset.group))
      probeReport = createManifestProbeReport(asset, builtAsset, signals)
    } finally {
      disposeManifestObject(builtAsset.group)
    }
  } catch (error) {
    signals.push(
      createValidationSignal(
        'compile_runtime',
        'asset_build_failed',
        error instanceof Error
          ? error.message
          : 'Manifest3D candidate could not be built.',
        {
          source: 'harness',
          stage: 'build',
        },
      ),
    )
    markSkipped(skippedStages, ['baseline_qc', 'checks', 'sampled_poses', 'export'])
  }

  return {
    asset,
    probeReport,
    report: createValidationReport({
      asset,
      signals,
      skippedStages,
    }),
  }
}

function runExportReadiness(asset: ManifestAsset, group: THREE.Object3D) {
  const signals: ValidationSignal[] = []
  let meshCount = 0

  group.traverse((object) => {
    if (!isMesh(object)) {
      return
    }

    meshCount += 1

    if (!object.geometry.getAttribute('position')) {
      signals.push(
        createValidationSignal(
          'mesh_assets',
          'export_mesh_missing_positions',
          `Asset "${asset.id}" contains a mesh without position data.`,
          {
            refs: { assetId: asset.id },
            source: 'export',
            stage: 'export',
          },
        ),
      )
    }
  })

  if (meshCount === 0) {
    signals.push(
      createValidationSignal(
        'mesh_assets',
        'export_traversal_no_meshes',
        `Asset "${asset.id}" contains no exportable mesh geometry.`,
        {
          refs: { assetId: asset.id },
          source: 'export',
          stage: 'export',
        },
      ),
    )
  }

  return signals
}

function markSkipped(
  skippedStages: Set<ValidationStage>,
  stages: readonly ValidationStage[],
) {
  for (const stage of stages) {
    skippedStages.add(stage)
  }
}

function formatSchemaPath(path: readonly (PropertyKey | symbol)[]) {
  if (path.length === 0) {
    return '/'
  }

  return `/${path.map(String).join('/')}`
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}
