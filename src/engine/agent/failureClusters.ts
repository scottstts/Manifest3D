import type {
  ValidationSignal,
  ValidationStage,
} from '../schema/validationTypes'

export type ValidationFailureCluster = {
  code: string
  count: number
  key: string
  kind: string
  label: string
  poseKey: string | null
  refs: Record<string, string>
  source: string
  stage: ValidationStage
}

export function createValidationFailureClusters(
  signals: readonly ValidationSignal[],
): ValidationFailureCluster[] {
  const clusters = new Map<string, ValidationFailureCluster>()

  for (const signal of signals) {
    if (signal.severity !== 'failure') {
      continue
    }

    const refs = normalizeClusterRefs(signal)
    const poseKey = extractPoseKey(signal)
    const key = [
      signal.stage,
      signal.kind,
      signal.code,
      signal.source,
      poseKey ?? '',
      ...Object.keys(refs)
        .sort()
        .map((name) => `${name}=${refs[name]}`),
    ].join('|')
    const existing = clusters.get(key)

    if (existing) {
      existing.count += 1
      continue
    }

    clusters.set(key, {
      code: signal.code,
      count: 1,
      key,
      kind: signal.kind,
      label: createClusterLabel(signal, refs, poseKey),
      poseKey,
      refs,
      source: signal.source,
      stage: signal.stage,
    })
  }

  return [...clusters.values()].sort((left, right) => {
    const countDelta = right.count - left.count

    if (countDelta !== 0) {
      return countDelta
    }

    return left.key.localeCompare(right.key)
  })
}

export function createValidationFailureClusterSignature(
  clusters: readonly ValidationFailureCluster[],
) {
  if (clusters.length === 0) {
    return null
  }

  return hashString(
    clusters
      .map((cluster) => cluster.key)
      .sort()
      .join('\n'),
  )
}

function normalizeClusterRefs(signal: ValidationSignal) {
  const refs = signal.refs ?? {}
  const normalized: Record<string, string> = {}
  const partPair = normalizePair(refs.partAId, refs.partBId)

  if (partPair) {
    normalized.partPair = partPair
  } else {
    for (const name of ['partId', 'jointId', 'controlId', 'materialId']) {
      const value = refs[name]

      if (value) {
        normalized[name] = value
      }
    }
  }

  if (!partPair) {
    const visualPair = normalizePair(refs.visualAId, refs.visualBId)

    if (visualPair) {
      normalized.visualPair = visualPair
    } else if (refs.visualId) {
      normalized.visualId = refs.visualId
    }
  }

  if (signal.checkName) {
    normalized.checkName = signal.checkName
  }

  if (signal.path && Object.keys(normalized).length === 0) {
    normalized.path = signal.path.replace(/\d+/g, '*')
  }

  return normalized
}

function normalizePair(left: string | undefined, right: string | undefined) {
  if (!left || !right) {
    return null
  }

  return [left, right].sort().join('<->')
}

function extractPoseKey(signal: ValidationSignal) {
  const details = signal.details ?? ''
  const joints = details.match(/\bjoints=([^\s]+)/)?.[1]

  if (joints) {
    return `joints:${joints}`
  }

  const pose = details.match(/\bpose=([^;]+)/)?.[1]?.trim()

  return pose ? `pose:${pose}` : null
}

function createClusterLabel(
  signal: ValidationSignal,
  refs: Record<string, string>,
  poseKey: string | null,
) {
  const refLabel = Object.keys(refs)
    .sort()
    .map((name) => `${name}=${refs[name]}`)
    .join(' ')
  const parts = [`[${signal.stage}/${signal.code}]`]

  if (refLabel) {
    parts.push(refLabel)
  }

  if (poseKey) {
    parts.push(poseKey)
  }

  return parts.join(' ')
}

function hashString(value: string) {
  let hash = 0x811c9dc5

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
