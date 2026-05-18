import { Pause, Play, RotateCcw } from 'lucide-react'
import {
  getJointControlPreviewValue,
  getJointPreviewControls,
  type JointPoseValues,
} from '../engine/geometry/jointPoses'
import type { SceneAssetInstance } from '../engine/scene/sceneStore'

type JointPreviewPanelProps = {
  instance: SceneAssetInstance | null
  jointPoses: JointPoseValues
  playingJointId: string | null
  rightOffset: number
  onJointPoseChange: (
    instanceId: string,
    controlId: string,
    value: number,
  ) => void
  onJointReset: (instanceId: string, controlId: string) => void
  onResetAll: (instanceId: string) => void
  onTogglePlayback: (instanceId: string, controlId: string) => void
}

export function JointPreviewPanel({
  instance,
  jointPoses,
  playingJointId,
  rightOffset,
  onJointPoseChange,
  onJointReset,
  onResetAll,
  onTogglePlayback,
}: JointPreviewPanelProps) {
  if (!instance) {
    return null
  }

  const controls = getJointPreviewControls(instance.asset)

  if (controls.length === 0) {
    return null
  }

  return (
    <section
      aria-label="Joint preview"
      className="joint-preview-panel"
      style={{ right: rightOffset }}
    >
      <div className="joint-preview-panel__header">
        <h2>Joints</h2>
        <button
          aria-label="Reset joint preview"
          title="Reset joint preview"
          type="button"
          onClick={() => onResetAll(instance.instanceId)}
        >
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
      <ol className="joint-preview-list">
        {controls.map((control) => {
          const range = control.range
          const value = getJointControlPreviewValue(control, jointPoses)
          const isPlaying = playingJointId === control.id

          return (
            <li key={control.id}>
              <div className="joint-preview-list__label">
                <span>{control.name}</span>
                <small>{formatJointValue(value, range.unit)}</small>
              </div>
              <div className="joint-preview-list__controls">
                <button
                  aria-label={`${isPlaying ? 'Pause' : 'Play'} ${control.name}`}
                  title={isPlaying ? 'Pause' : 'Play'}
                  type="button"
                  onClick={() => onTogglePlayback(instance.instanceId, control.id)}
                >
                  {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                </button>
                <input
                  aria-label={`${control.name} preview value`}
                  max={range.max}
                  min={range.min}
                  step={range.step}
                  type="range"
                  value={value}
                  onChange={(event) =>
                    onJointPoseChange(
                      instance.instanceId,
                      control.id,
                      Number(event.currentTarget.value),
                    )
                  }
                />
                <button
                  aria-label={`Reset ${control.name}`}
                  title="Reset"
                  type="button"
                  onClick={() => onJointReset(instance.instanceId, control.id)}
                >
                  <RotateCcw aria-hidden="true" />
                </button>
              </div>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function formatJointValue(value: number, unit: 'meters' | 'radians') {
  if (unit === 'meters') {
    return `${value.toFixed(3)} m`
  }

  return `${Math.round(value * 180 / Math.PI)} deg`
}
