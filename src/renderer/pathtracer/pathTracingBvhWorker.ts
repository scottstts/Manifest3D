import type { BVHWorker } from 'three-gpu-pathtracer'
import { GenerateMeshBVHWorker } from 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js'

export type PathTracingBvhWorker = BVHWorker & {
  dispose: () => void
}

export function createPathTracingBvhWorker(): PathTracingBvhWorker {
  return new GenerateMeshBVHWorker() as PathTracingBvhWorker
}
