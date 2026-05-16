import { Cpu } from 'lucide-react'

type UnsupportedWebGPUProps = {
  reason?: string
}

export function UnsupportedWebGPU({ reason }: UnsupportedWebGPUProps) {
  return (
    <div className="unsupported-webgpu" role="status">
      <Cpu aria-hidden="true" />
      <h2>WebGPU is required</h2>
      <p>
        Manifest3D runs this viewport with Three.js WebGPU only. Open the app in
        a WebGPU-capable browser to render the demo scene.
      </p>
      {reason && <small>{reason}</small>}
    </div>
  )
}
