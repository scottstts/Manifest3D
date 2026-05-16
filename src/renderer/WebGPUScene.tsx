import { OrbitControls } from '@react-three/drei'
import type { RefObject } from 'react'
import type { Quaternion } from 'three'
import { CameraQuaternionBridge } from './ViewportGizmo'

type WebGPUSceneProps = {
  cameraQuaternionRef: RefObject<Quaternion>
}

export function WebGPUScene({ cameraQuaternionRef }: WebGPUSceneProps) {
  return (
    <>
      <CameraQuaternionBridge cameraQuaternionRef={cameraQuaternionRef} />
      <fogExp2 attach="fog" args={['#efeff9', 0.018]} />

      <hemisphereLight args={['#ffffff', '#d9dbee', 1.35]} />
      <directionalLight
        castShadow
        intensity={1.9}
        position={[-4.4, 6.5, 3.6]}
        shadow-camera-bottom={-6}
        shadow-camera-far={18}
        shadow-camera-left={-6}
        shadow-camera-near={0.5}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-mapSize-height={2048}
        shadow-mapSize-width={2048}
      />
      <directionalLight color="#cbd5ff" intensity={0.62} position={[4.2, 3.2, -4.5]} />

      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#f4f3fb" metalness={0.05} roughness={0.36} />
      </mesh>

      <OrbitControls
        dampingFactor={0.06}
        enableDamping
        makeDefault
        maxDistance={9}
        maxPolarAngle={Math.PI * 0.49}
        minDistance={2.2}
        target={[0, 0, -0.2]}
      />
    </>
  )
}
