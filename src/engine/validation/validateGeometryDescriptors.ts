import type {
  ManifestAsset,
  ManifestGeometry,
  ManifestTransform,
  ManifestVector2,
  ManifestVector3,
} from '../schema/manifestTypes'
import type { ValidationSignal } from '../schema/validationTypes'
import { createValidationSignal } from './reportBuilder'

const minScaleComponent = 0.001

export function validateGeometryDescriptors(
  asset: ManifestAsset,
): ValidationSignal[] {
  const signals: ValidationSignal[] = []

  for (const [partIndex, part] of asset.parts.entries()) {
    if (part.visuals.length === 0) {
      signals.push(
        createValidationSignal(
          'model_validity',
          'part_has_no_visuals',
          `Part "${part.id}" has no renderable visuals.`,
          {
            path: `/parts/${partIndex}/visuals`,
            refs: { partId: part.id },
            stage: 'structure',
          },
        ),
      )
    }

    for (const [visualIndex, visual] of part.visuals.entries()) {
      const visualPath = `/parts/${partIndex}/visuals/${visualIndex}`

      signals.push(
        ...validateManifestGeometry(
          visual.geometry,
          `${visualPath}/geometry`,
          { partId: part.id, visualId: visual.id },
        ),
      )
      signals.push(
        ...validateTransform(visual.transform, `${visualPath}/transform`, {
          partId: part.id,
          visualId: visual.id,
        }),
      )
    }
  }

  return signals
}

function validateManifestGeometry(
  geometry: ManifestGeometry,
  path: string,
  refs: Record<string, string>,
): ValidationSignal[] {
  switch (geometry.type) {
    case 'box':
      return validatePositiveVector3(geometry.size, `${path}/size`, refs)
    case 'cylinder':
      return [
        ...validatePositiveNumber(geometry.radiusTop, `${path}/radiusTop`, refs),
        ...validatePositiveNumber(geometry.radiusBottom, `${path}/radiusBottom`, refs),
        ...validatePositiveNumber(geometry.height, `${path}/height`, refs),
      ]
    case 'sphere':
      return validatePositiveNumber(geometry.radius, `${path}/radius`, refs)
    case 'torus':
      return [
        ...validatePositiveNumber(geometry.radius, `${path}/radius`, refs),
        ...validatePositiveNumber(geometry.tube, `${path}/tube`, refs),
      ]
    case 'cone':
      return [
        ...validatePositiveNumber(geometry.radius, `${path}/radius`, refs),
        ...validatePositiveNumber(geometry.height, `${path}/height`, refs),
      ]
    case 'lathe':
      return validateVector2List(geometry.points, `${path}/points`, refs)
    case 'extrude':
      return [
        ...validateVector2List(geometry.shape, `${path}/shape`, refs),
        ...validatePositiveNumber(geometry.depth, `${path}/depth`, refs),
      ]
    case 'tube':
      return [
        ...validateVector3List(geometry.points, `${path}/points`, refs),
        ...validatePositiveNumber(geometry.radius, `${path}/radius`, refs),
      ]
    default:
      return assertNever(geometry)
  }
}

function validateTransform(
  transform: ManifestTransform,
  path: string,
  refs: Record<string, string>,
) {
  const signals: ValidationSignal[] = []

  if (transform.position) {
    signals.push(...validateFiniteVector3(transform.position, `${path}/position`, refs))
  }

  if (transform.rotation) {
    signals.push(...validateFiniteVector3(transform.rotation, `${path}/rotation`, refs))
  }

  if (transform.scale) {
    signals.push(...validateFiniteVector3(transform.scale, `${path}/scale`, refs))

    for (const [axisIndex, scale] of transform.scale.entries()) {
      if (Math.abs(scale) <= minScaleComponent) {
        signals.push(
          createValidationSignal(
            'model_validity',
            'transform_zero_scale',
            `Transform scale component at index ${axisIndex} is too close to zero.`,
            {
              path: `${path}/scale/${axisIndex}`,
              refs,
              stage: 'structure',
            },
          ),
        )
      }
    }
  }

  return signals
}

function validatePositiveVector3(
  vector: ManifestVector3,
  path: string,
  refs: Record<string, string>,
) {
  return vector.flatMap((value, index) =>
    validatePositiveNumber(value, `${path}/${index}`, refs),
  )
}

function validateFiniteVector3(
  vector: ManifestVector3,
  path: string,
  refs: Record<string, string>,
) {
  return vector.flatMap((value, index) =>
    validateFiniteNumber(value, `${path}/${index}`, refs),
  )
}

function validateVector2List(
  points: readonly ManifestVector2[],
  path: string,
  refs: Record<string, string>,
) {
  return points.flatMap((point, pointIndex) =>
    point.flatMap((value, valueIndex) =>
      validateFiniteNumber(value, `${path}/${pointIndex}/${valueIndex}`, refs),
    ),
  )
}

function validateVector3List(
  points: readonly ManifestVector3[],
  path: string,
  refs: Record<string, string>,
) {
  return points.flatMap((point, pointIndex) =>
    point.flatMap((value, valueIndex) =>
      validateFiniteNumber(value, `${path}/${pointIndex}/${valueIndex}`, refs),
    ),
  )
}

function validatePositiveNumber(
  value: number,
  path: string,
  refs: Record<string, string>,
) {
  if (!Number.isFinite(value) || value <= 0) {
    return [
      createValidationSignal(
        'model_validity',
        'geometry_positive_number_required',
        'Geometry values must be finite positive numbers.',
        { path, refs, stage: 'structure' },
      ),
    ]
  }

  return []
}

function validateFiniteNumber(
  value: number,
  path: string,
  refs: Record<string, string>,
) {
  if (!Number.isFinite(value)) {
    return [
      createValidationSignal(
        'model_validity',
        'finite_number_required',
        'Transform and procedural geometry values must be finite numbers.',
        { path, refs, stage: 'structure' },
      ),
    ]
  }

  return []
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D geometry: ${JSON.stringify(value)}`)
}
