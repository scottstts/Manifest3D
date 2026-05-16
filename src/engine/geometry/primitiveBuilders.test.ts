import { describe, expect, it } from 'vitest'
import { buildPrimitiveGeometry } from './primitiveBuilders'

describe('buildPrimitiveGeometry', () => {
  it('builds a box with the requested dimensions', () => {
    const geometry = buildPrimitiveGeometry({
      type: 'box',
      size: [0.4, 0.2, 0.8],
    })

    geometry.computeBoundingBox()

    expect(geometry.type).toBe('BoxGeometry')
    expect(geometry.boundingBox?.max.x).toBeCloseTo(0.2)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(0.1)
    expect(geometry.boundingBox?.max.z).toBeCloseTo(0.4)
  })

  it('builds tapered cylinders without losing positive volume', () => {
    const geometry = buildPrimitiveGeometry({
      type: 'cylinder',
      height: 0.7,
      radialSegments: 16,
      radiusBottom: 0.2,
      radiusTop: 0.1,
    })

    geometry.computeBoundingBox()

    expect(geometry.type).toBe('CylinderGeometry')
    expect(geometry.boundingBox?.max.y).toBeGreaterThan(0.3)
    expect(geometry.boundingBox?.min.y).toBeLessThan(-0.3)
  })

  it('builds procedural tube paths from manifest points', () => {
    const geometry = buildPrimitiveGeometry({
      type: 'tube',
      points: [
        [0, 0, 0],
        [0.2, 0.1, 0],
        [0.4, 0, 0.1],
      ],
      radius: 0.03,
      radialSegments: 8,
      tubularSegments: 16,
    })

    geometry.computeBoundingBox()

    expect(geometry.type).toBe('TubeGeometry')
    expect(geometry.boundingBox?.isEmpty()).toBe(false)
  })
})
