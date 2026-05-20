import * as THREE from 'three/webgpu'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import type {
  ManifestGeometry,
  ManifestVector2,
  ManifestVector3,
} from '../schema/manifestTypes'

export function buildPrimitiveGeometry(
  geometry: ManifestGeometry,
): THREE.BufferGeometry {
  switch (geometry.type) {
    case 'box':
      return new THREE.BoxGeometry(...geometry.size)
    case 'roundedBox':
      return new RoundedBoxGeometry(
        geometry.size[0],
        geometry.size[1],
        geometry.size[2],
        geometry.segments ?? 4,
        geometry.radius,
      )
    case 'cylinder':
      return new THREE.CylinderGeometry(
        geometry.radiusTop,
        geometry.radiusBottom,
        geometry.height,
        geometry.radialSegments ?? 32,
      )
    case 'sphere':
      return new THREE.SphereGeometry(
        geometry.radius,
        geometry.widthSegments ?? 32,
        geometry.heightSegments ?? 16,
      )
    case 'torus':
      return new THREE.TorusGeometry(
        geometry.radius,
        geometry.tube,
        geometry.radialSegments ?? 16,
        geometry.tubularSegments ?? 48,
      )
    case 'cone':
      return new THREE.ConeGeometry(
        geometry.radius,
        geometry.height,
        geometry.radialSegments ?? 32,
      )
    case 'capsule':
      return new THREE.CapsuleGeometry(
        geometry.radius,
        geometry.height,
        geometry.capSegments ?? 8,
        geometry.radialSegments ?? 24,
        geometry.heightSegments ?? 1,
      )
    case 'lathe':
      return new THREE.LatheGeometry(
        geometry.points.map(toVector2),
        geometry.segments ?? 32,
        geometry.phiStart ?? 0,
        geometry.phiLength ?? Math.PI * 2,
      )
    case 'extrude':
      return new THREE.ExtrudeGeometry(
        new THREE.Shape(geometry.shape.map(toVector2)),
        {
          bevelEnabled: geometry.bevelEnabled ?? false,
          bevelSegments: geometry.bevelSegments ?? 0,
          bevelSize: geometry.bevelSize ?? 0.02,
          bevelThickness: geometry.bevelThickness ?? 0.02,
          depth: geometry.depth,
          steps: 1,
        },
      )
    case 'tube': {
      const curve = new THREE.CatmullRomCurve3(
        geometry.points.map(toVector3),
        geometry.closed ?? false,
      )

      return new THREE.TubeGeometry(
        curve,
        geometry.tubularSegments ?? 32,
        geometry.radius,
        geometry.radialSegments ?? 12,
        geometry.closed ?? false,
      )
    }
    default:
      return assertNever(geometry)
  }
}

function toVector2([x, y]: ManifestVector2) {
  return new THREE.Vector2(x, y)
}

function toVector3([x, y, z]: ManifestVector3) {
  return new THREE.Vector3(x, y, z)
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Manifest3D geometry: ${JSON.stringify(value)}`)
}
