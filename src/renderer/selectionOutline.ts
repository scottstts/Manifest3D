import * as THREE from 'three/webgpu'
import {
  cameraProjectionMatrix,
  color,
  float,
  modelViewMatrix,
  normalLocal,
  normalize,
  positionLocal,
  vec4,
} from 'three/tsl'

const selectionOutlineColor = '#8b3dff'
const selectionOutlineThickness = 0.006
const ignoreRaycast: THREE.Object3D['raycast'] = () => undefined

const selectionOutlineMaterial = createSelectionOutlineMaterial()

export function createSelectionOutlineGroup(sourceGroup: THREE.Group) {
  const outlineGroup = sourceGroup.clone(true)

  outlineGroup.name = `${sourceGroup.name} Selection Outline`
  outlineGroup.traverse((object) => {
    object.userData = {}

    if (!isMesh(object)) {
      return
    }

    object.castShadow = false
    object.material = selectionOutlineMaterial
    object.raycast = ignoreRaycast
    object.receiveShadow = false
    object.renderOrder = 2
  })

  return outlineGroup
}

function createSelectionOutlineMaterial() {
  const material = new THREE.NodeMaterial()

  material.depthTest = true
  material.depthWrite = false
  material.name = 'Manifest3D_Selection_Outline'
  material.side = THREE.BackSide
  material.toneMapped = false

  const outlineNormal = normalLocal.negate()
  const modelViewProjection = cameraProjectionMatrix.mul(modelViewMatrix)
  const sourcePosition = modelViewProjection.mul(vec4(positionLocal, 1.0))
  const expandedPosition = modelViewProjection.mul(
    vec4(positionLocal.add(outlineNormal), 1.0),
  )
  const outlineDirection = normalize(sourcePosition.sub(expandedPosition))

  material.vertexNode = sourcePosition.add(
    outlineDirection
      .mul(float(selectionOutlineThickness))
      .mul(sourcePosition.w),
  )
  material.colorNode = vec4(color(selectionOutlineColor), float(1))

  return material
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true
}
