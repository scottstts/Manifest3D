import * as THREE from 'three'

export type ViewportShadowCameraBounds = {
  bottom: number
  far: number
  left: number
  near: number
  right: number
  top: number
}

export type ViewportShadowState = {
  camera: ViewportShadowCameraBounds
  lightPosition: [number, number, number]
  targetPosition: [number, number, number]
}

export const defaultViewportShadowConfig = {
  camera: {
    bottom: -36,
    far: 120,
    left: -36,
    near: 0.1,
    right: 36,
    top: 36,
  },
  depthMargin: 6,
  groundPlaneY: 0,
  lightDistanceMultiplier: 3.2,
  mapSize: 4096,
  minCameraSpan: 72,
  minLightDistance: 96,
  xyMargin: 4,
}

export function computeDefaultViewportShadowState(
  casterBounds: THREE.Box3,
  lightOffset: THREE.Vector3,
): ViewportShadowState {
  const lightDirection = normalizeLightOffset(lightOffset)
  const fitPoints = getShadowFitPoints(
    casterBounds,
    lightDirection,
    defaultViewportShadowConfig.groundPlaneY,
  )

  if (fitPoints.length === 0) {
    return {
      camera: { ...defaultViewportShadowConfig.camera },
      lightPosition: scaleVectorToTuple(
        lightDirection,
        defaultViewportShadowConfig.minLightDistance,
      ),
      targetPosition: [0, 0, 0],
    }
  }

  const fitBounds = new THREE.Box3().setFromPoints(fitPoints)
  const target = fitBounds.getCenter(new THREE.Vector3())
  const radius = fitBounds.getBoundingSphere(new THREE.Sphere()).radius
  const lightDistance = Math.max(
    defaultViewportShadowConfig.minLightDistance,
    radius * defaultViewportShadowConfig.lightDistanceMultiplier,
  )
  const lightPosition = target
    .clone()
    .add(lightDirection.clone().multiplyScalar(lightDistance))

  const shadowCamera = new THREE.OrthographicCamera()
  shadowCamera.position.copy(lightPosition)
  shadowCamera.lookAt(target)
  shadowCamera.updateMatrixWorld(true)

  const viewMatrix = shadowCamera.matrixWorld.clone().invert()
  const lightSpaceBounds = computeLightSpaceBounds(fitPoints, viewMatrix)
  const xRange = expandRange(
    lightSpaceBounds.minX,
    lightSpaceBounds.maxX,
    defaultViewportShadowConfig.minCameraSpan,
    defaultViewportShadowConfig.xyMargin,
  )
  const yRange = expandRange(
    lightSpaceBounds.minY,
    lightSpaceBounds.maxY,
    defaultViewportShadowConfig.minCameraSpan,
    defaultViewportShadowConfig.xyMargin,
  )

  return {
    camera: {
      bottom: yRange.min,
      far: Math.max(
        defaultViewportShadowConfig.camera.far,
        lightSpaceBounds.maxDepth + defaultViewportShadowConfig.depthMargin,
      ),
      left: xRange.min,
      near: defaultViewportShadowConfig.camera.near,
      right: xRange.max,
      top: yRange.max,
    },
    lightPosition: vectorToTuple(lightPosition),
    targetPosition: vectorToTuple(target),
  }
}

function getShadowFitPoints(
  casterBounds: THREE.Box3,
  lightDirection: THREE.Vector3,
  groundPlaneY: number,
) {
  if (casterBounds.isEmpty()) {
    return []
  }

  const points = getBoxCorners(casterBounds)

  for (const corner of getBoxCorners(casterBounds)) {
    const projected = projectPointToGroundAlongLight(
      corner,
      lightDirection,
      groundPlaneY,
    )

    if (projected) {
      points.push(projected)
    }
  }

  return points
}

function getBoxCorners(bounds: THREE.Box3) {
  const { max, min } = bounds

  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ]
}

function projectPointToGroundAlongLight(
  point: THREE.Vector3,
  lightDirection: THREE.Vector3,
  groundPlaneY: number,
) {
  if (lightDirection.y <= 0.000001) {
    return null
  }

  const distanceAlongRay = (point.y - groundPlaneY) / lightDirection.y

  if (distanceAlongRay < 0) {
    return null
  }

  return point.clone().addScaledVector(lightDirection, -distanceAlongRay)
}

function computeLightSpaceBounds(
  points: THREE.Vector3[],
  viewMatrix: THREE.Matrix4,
) {
  const first = points[0]?.clone().applyMatrix4(viewMatrix)

  if (!first) {
    return {
      maxDepth: 0,
      maxX: 0,
      maxY: 0,
      minDepth: 0,
      minX: 0,
      minY: 0,
    }
  }

  let minX = first.x
  let maxX = first.x
  let minY = first.y
  let maxY = first.y
  let minDepth = -first.z
  let maxDepth = -first.z

  for (const point of points.slice(1)) {
    const localPoint = point.clone().applyMatrix4(viewMatrix)
    const depth = -localPoint.z

    minX = Math.min(minX, localPoint.x)
    maxX = Math.max(maxX, localPoint.x)
    minY = Math.min(minY, localPoint.y)
    maxY = Math.max(maxY, localPoint.y)
    minDepth = Math.min(minDepth, depth)
    maxDepth = Math.max(maxDepth, depth)
  }

  return { maxDepth, maxX, maxY, minDepth, minX, minY }
}

function expandRange(
  min: number,
  max: number,
  minSpan: number,
  margin: number,
) {
  const center = (min + max) / 2
  const span = Math.max(max - min + margin * 2, minSpan)

  return {
    max: center + span / 2,
    min: center - span / 2,
  }
}

function normalizeLightOffset(lightOffset: THREE.Vector3) {
  if (lightOffset.lengthSq() <= 0.000001) {
    return new THREE.Vector3(4.2, 3.2, -4.5).normalize()
  }

  return lightOffset.clone().normalize()
}

function scaleVectorToTuple(
  vector: THREE.Vector3,
  scale: number,
): [number, number, number] {
  return vectorToTuple(vector.clone().multiplyScalar(scale))
}

function vectorToTuple(vector: THREE.Vector3): [number, number, number] {
  return [vector.x, vector.y, vector.z]
}
