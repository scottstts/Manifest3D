import { Pause, Play, RotateCcw } from 'lucide-react'
import {
  getJointControlPreviewValue,
  getJointPreviewControls,
  type JointPoseValues,
} from '../engine/geometry/jointPoses'
import {
  getMaterialEmissionAnimationControls,
  getMaterialEmissionControlPreviewValue,
  type MaterialAnimationValues,
} from '../engine/geometry/materialAnimations'
import type { SceneAssetInstance } from '../engine/scene/sceneStore'

type PreviewControlKind = 'joint' | 'material'

type PlayingPreviewControl = {
  controlId: string
  kind: PreviewControlKind
}

type JointPreviewPanelProps = {
  instance: SceneAssetInstance | null
  jointPoses: JointPoseValues
  materialAnimationValues: MaterialAnimationValues
  playingPreview: PlayingPreviewControl | null
  rightOffset: number
  onJointPoseChange: (
    instanceId: string,
    controlId: string,
    value: number,
  ) => void
  onJointReset: (instanceId: string, controlId: string) => void
  onMaterialAnimationReset: (instanceId: string, controlId: string) => void
  onMaterialAnimationTimeChange: (
    instanceId: string,
    controlId: string,
    value: number,
  ) => void
  onMaterialAnimationTogglePlayback: (
    instanceId: string,
    controlId: string,
  ) => void
  onResetAll: (instanceId: string) => void
  onTogglePlayback: (instanceId: string, controlId: string) => void
}

export function JointPreviewPanel({
  instance,
  jointPoses,
  materialAnimationValues,
  playingPreview,
  rightOffset,
  onJointPoseChange,
  onJointReset,
  onMaterialAnimationReset,
  onMaterialAnimationTimeChange,
  onMaterialAnimationTogglePlayback,
  onResetAll,
  onTogglePlayback,
}: JointPreviewPanelProps) {
  if (!instance) {
    return null
  }

  const jointControls = getJointPreviewControls(instance.asset)
  const materialControls = getMaterialEmissionAnimationControls(instance.asset)

  if (jointControls.length === 0 && materialControls.length === 0) {
    return null
  }

  return (
    <section
      aria-label="Animation preview"
      className="joint-preview-panel"
      style={{ right: rightOffset }}
    >
      <div className="joint-preview-panel__header">
        <h2>Animation</h2>
        <button
          aria-label="Reset animation preview"
          title="Reset animation preview"
          type="button"
          onClick={() => onResetAll(instance.instanceId)}
        >
          <RotateCcw aria-hidden="true" />
        </button>
      </div>
      <ol className="joint-preview-list">
        {jointControls.map((control) => {
          const range = control.range
          const value = getJointControlPreviewValue(control, jointPoses)
          const isPlaying =
            playingPreview?.kind === 'joint' &&
            playingPreview.controlId === control.id

          return (
            <li key={`joint:${control.id}`}>
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
        {materialControls.map((control) => {
          const range = control.range
          const value = getMaterialEmissionControlPreviewValue(
            control,
            materialAnimationValues,
          )
          const isPlaying =
            playingPreview?.kind === 'material' &&
            playingPreview.controlId === control.id

          return (
            <li key={`material:${control.id}`}>
              <div className="joint-preview-list__label">
                <span>{control.name}</span>
                <small>{formatJointValue(value, range.unit)}</small>
              </div>
              <div className="joint-preview-list__controls">
                <button
                  aria-label={`${isPlaying ? 'Pause' : 'Play'} ${control.name}`}
                  title={isPlaying ? 'Pause' : 'Play'}
                  type="button"
                  onClick={() =>
                    onMaterialAnimationTogglePlayback(
                      instance.instanceId,
                      control.id,
                    )
                  }
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
                    onMaterialAnimationTimeChange(
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
                  onClick={() =>
                    onMaterialAnimationReset(instance.instanceId, control.id)
                  }
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

function formatJointValue(value: number, unit: 'meters' | 'radians' | 'seconds') {
  if (unit === 'seconds') {
    return `${value.toFixed(2)} s`
  }

  if (unit === 'meters') {
    return `${value.toFixed(3)} m`
  }

  return `${Math.round(value * 180 / Math.PI)} deg`
}
