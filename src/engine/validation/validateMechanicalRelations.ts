import type { ManifestAsset } from '../schema/manifestTypes'
import type { ValidationSignal } from '../schema/validationTypes'
import { createValidationSignal } from './reportBuilder'
import { getRelationCheckPartVisualPairs } from './relationCheckPairs'

const mechanicalContextTerms = [
  'automotive',
  'bicycle',
  'bike',
  'cad',
  'compressor',
  'crank',
  'cutaway',
  'drive',
  'driven',
  'drivetrain',
  'mechanical',
  'mechanism',
  'engine',
  'gearbox',
  'gear train',
  'hoist',
  'linkage',
  'machine',
  'motor',
  'piston',
  'pulley',
  'pump',
  'sprocket',
  'tool',
  'turbine',
  'vehicle',
]
const pathLikePartTerms = [
  'belt',
  'cable',
  'chain',
  'hose',
  'rope',
  'strap',
  'timing belt',
  'timing chain',
  'track',
  'tread',
  'wire',
]
const endpointConnectorPathTerms = ['cable', 'hose', 'rope', 'strap', 'wire']
const couplerPartTerms = [
  'connecting rod',
  'link arm',
  'linkage',
  'push rod',
  'pushrod',
  'tie rod',
]
const guidedMoverPartTerms = [
  'carriage',
  'piston',
  'plunger',
  'slider',
  'sleeve',
  'valve',
]
const guidedMotionPromptTerms = [
  'extend',
  'extended',
  'linear motion',
  'linear travel',
  'move up and down',
  'moving up and down',
  'reciprocate',
  'reciprocating',
  'retract',
  'retracted',
  'slide',
  'slides',
  'sliding',
  'stroke',
  'strokes',
]
const guidedScopedMotionPromptTerms = [
  ...guidedMotionPromptTerms,
  'actuate',
  'actuated',
  'actuating',
  'close',
  'closes',
  'closing',
  'lift',
  'lifting',
  'open',
  'opens',
  'opening',
]
const conventionalGuidedMotionPartTerms = [
  'carriage',
  'piston',
  'plunger',
  'slider',
]
const rotaryMotionPromptTerms = [
  'belt driven',
  'chain driven',
  'crank',
  'crankshaft',
  'driven',
  'drivetrain',
  'gear train',
  'rotate',
  'rotates',
  'rotating',
  'rotation',
  'spin',
  'spinning',
  'timing',
  'turn',
  'turning',
]
const rotaryInterfacePartTerms = [
  'axle',
  'bearing',
  'cam',
  'collar',
  'crank',
  'gear',
  'hub',
  'pulley',
  'shaft',
  'sprocket',
  'wheel',
]
const rotaryMoverPartTerms = [
  'axle',
  'cam',
  'crank',
  'crankshaft',
  'fan',
  'gear',
  'hub',
  'impeller',
  'pulley',
  'rotor',
  'shaft',
  'spool',
  'sprocket',
  'turbine',
  'wheel',
]
const rotaryPathSupportPartTerms = [
  'gear',
  'pulley',
  'rim',
  'roller',
  'sprocket',
  'wheel',
]
const guideInterfacePartTerms = [
  'bore',
  'channel',
  'cylinder',
  'cylinder liner',
  'guide',
  'guide rail',
  'guideway',
  'housing',
  'liner',
  'rail',
  'sleeve',
  'slot',
]
const guidedCouplerEndpointTerms = [
  ...guidedMoverPartTerms,
  'crosshead',
  'wrist pin',
]
const rotaryCouplerEndpointTerms = [
  ...rotaryInterfacePartTerms,
  'crank pin',
  'journal',
]
const linkedMechanicalControlTerms = [
  'belt driven',
  'chain driven',
  'connecting rod',
  'coupled',
  'crank',
  'crankshaft',
  'drive train',
  'driven',
  'drivetrain',
  'gear train',
  'linkage',
  'move together',
  'synchronized',
  'timing',
  'together',
]
const wrappedPathPromptTerms = [
  'around',
  'encircling',
  'looped',
  'riding',
  'taut',
  'tensioned',
  'wrapped',
  'wound',
]

type RelationTargetEvidence = {
  partId: string
  visualId?: string
}

type RelationEvidence = {
  contactsByPartId: Map<string, Set<string>>
  connectorEndpointCountsByPartId: Map<string, number>
  pathContactsByPartId: Map<string, Set<string>>
  pathTargetsByPartId: Map<string, RelationTargetEvidence[]>
  posePathTargetsByPartId: Map<string, RelationTargetEvidence[]>
  poseRelationTargetsByPartId: Map<string, RelationTargetEvidence[]>
  relationTargetsByPartId: Map<string, RelationTargetEvidence[]>
}

export function validateMechanicalRelationCoverage(asset: ManifestAsset): ValidationSignal[] {
  if (!isMechanicalRelationCoverageRequired(asset)) {
    return []
  }

  const signals: ValidationSignal[] = []
  const evidence = collectRelationEvidence(asset)
  const promptDescriptor = getAssetPromptDescriptor(asset)
  const promptAsksForWrappedPath = matchesAnyTerm(
    promptDescriptor,
    wrappedPathPromptTerms,
  )
  const targetContext = createRelationTargetContext(asset)
  const poseRelationEvidenceRequired =
    isLinkedMechanicalPoseEvidenceRequired(asset, promptDescriptor)

  for (const [partIndex, part] of asset.parts.entries()) {
    const descriptor = getPartIdentityDescriptor(part)
    const contactCount = evidence.contactsByPartId.get(part.id)?.size ?? 0
    const connectorEndpointCount =
      evidence.connectorEndpointCountsByPartId.get(part.id) ?? 0

    if (isPathLikeMechanicalPart(part)) {
      const endpointConnectorOnly =
        !promptAsksForWrappedPath &&
        matchesAnyTerm(descriptor, endpointConnectorPathTerms) &&
        connectorEndpointCount >= 2
      const pathContactCount = evidence.pathContactsByPartId.get(part.id)?.size ?? 0

      if (!endpointConnectorOnly && pathContactCount < 2) {
        signals.push(
          createValidationSignal(
            'mechanical_relation_coverage',
            'mechanical_path_contacts_missing',
            `Path-like mechanical part "${part.id}" needs authored contact evidence for at least two supports or targets.`,
            {
              details:
                'Use expect_path_contacts for belts, chains, tracks, wrapped cables, hoses, ropes, straps, and wires that must ride on wheels, pulleys, sprockets, fittings, guides, or mounts. ConnectorTube endpoints are sufficient only for simple endpoint-routed cables, hoses, ropes, straps, and wires.',
              path: `/parts/${partIndex}`,
              refs: {
                currentContacts: String(pathContactCount),
                partId: part.id,
                requiredContacts: '2',
              },
              source: 'checks',
              stage: 'structure',
            },
          ),
        )
      }

      signals.push(
        ...validatePathTargetQuality({
          asset,
          evidence,
          part,
          partIndex,
          promptDescriptor,
          targetContext,
        }),
      )
      signals.push(
        ...validatePathPoseTargetQuality({
          asset,
          evidence,
          part,
          partIndex,
          poseRelationEvidenceRequired,
          promptDescriptor,
          targetContext,
        }),
      )

      continue
    }

    if (matchesAnyTerm(descriptor, couplerPartTerms)) {
      signals.push(
        ...validateCouplerRigidRepresentation({
          part,
          partIndex,
        }),
      )

      if (contactCount < 2) {
        signals.push(
          createValidationSignal(
            'mechanical_relation_coverage',
            'mechanical_coupler_contacts_missing',
            `Mechanical coupler part "${part.id}" needs authored relation evidence at both ends.`,
            {
              details:
                'Rods and linkages that transfer motion should have exact checks proving contact, bounded gap, containment, or seated fit to at least two other parts, such as a slider/piston end and a crank/pivot end.',
              path: `/parts/${partIndex}`,
              refs: {
                currentContacts: String(contactCount),
                partId: part.id,
                requiredContacts: '2',
              },
              source: 'checks',
              stage: 'structure',
            },
          ),
        )
      }

      signals.push(
        ...validateCouplerTargetQuality({
          evidence,
          part,
          partIndex,
          promptDescriptor,
          targetContext,
        }),
      )
      signals.push(
        ...validateCouplerPoseTargetQuality({
          evidence,
          part,
          partIndex,
          poseRelationEvidenceRequired,
          promptDescriptor,
          targetContext,
        }),
      )
      signals.push(
        ...validateCouplerMotionJointQuality({
          asset,
          part,
          partIndex,
          poseRelationEvidenceRequired,
          promptDescriptor,
        }),
      )

      continue
    }

    const isGuidedMover = matchesAnyTerm(descriptor, guidedMoverPartTerms)
    const isRotaryInterface = matchesAnyTerm(descriptor, rotaryInterfacePartTerms)

    if (isGuidedMover || isRotaryInterface) {
      if (contactCount < 1) {
        signals.push(
          createValidationSignal(
            'mechanical_relation_coverage',
            'mechanical_interface_check_missing',
            `Mechanical interface part "${part.id}" needs authored fitted-interface evidence.`,
            {
              details:
                'Prompt-critical mechanical parts such as pistons, sliders, valves, shafts, gears, pulleys, sprockets, bearings, hubs, and wheels should have at least one exact relation check proving how they sit in a guide, bearing, collar, housing, mate, or support.',
              path: `/parts/${partIndex}`,
              refs: {
                currentContacts: String(contactCount),
                partId: part.id,
                requiredContacts: '1',
              },
              source: 'checks',
              stage: 'structure',
            },
          ),
        )
      }

      if (isGuidedMover) {
        const guidedMotionRequired = isGuidedMotionRequiredForPart(
          part,
          promptDescriptor,
        )

        signals.push(
          ...validateGuidedTargetQuality({
            evidence,
            part,
            partIndex,
            targetContext,
          }),
        )
        signals.push(
          ...validateGuidedPoseTargetQuality({
            evidence,
            part,
            partIndex,
            poseRelationEvidenceRequired:
              poseRelationEvidenceRequired && guidedMotionRequired,
            targetContext,
          }),
        )
        signals.push(
          ...validateGuidedMotionJointQuality({
            asset,
            part,
            partIndex,
            guidedMotionRequired,
            targetContext,
          }),
        )
      }

      if (matchesAnyTerm(descriptor, rotaryMoverPartTerms)) {
        signals.push(
          ...validateRotaryMotionJointQuality({
            asset,
            part,
            partIndex,
            promptDescriptor,
            targetContext,
          }),
        )
      }
    }
  }

  signals.push(...validateMechanicalPromptComponentCoverage(asset, promptDescriptor))
  signals.push(
    ...validateLinkedMechanicalControlCoverage(
      asset,
      promptDescriptor,
      targetContext,
    ),
  )

  return signals
}

function isMechanicalRelationCoverageRequired(asset: ManifestAsset) {
  const movableJointCount = asset.joints.filter((joint) => joint.type !== 'fixed')
    .length

  if (movableJointCount >= 2) {
    return true
  }

  return matchesAnyTerm(
    [
      asset.name,
      asset.prompt,
      ...asset.parts.flatMap((part) => [
        part.id,
        part.name,
        part.description ?? '',
        ...part.visuals.flatMap((visual) => [visual.id, visual.name ?? '']),
      ]),
    ].join(' '),
    mechanicalContextTerms,
  )
}

function collectRelationEvidence(asset: ManifestAsset): RelationEvidence {
  const visualCountByPartId = new Map(
    asset.parts.map((part) => [part.id, part.visuals.length]),
  )
  const evidence: RelationEvidence = {
    connectorEndpointCountsByPartId: new Map(),
    contactsByPartId: new Map(),
    pathContactsByPartId: new Map(),
    pathTargetsByPartId: new Map(),
    posePathTargetsByPartId: new Map(),
    poseRelationTargetsByPartId: new Map(),
    relationTargetsByPartId: new Map(),
  }

  for (const check of asset.checks) {
    if (check.type === 'expect_path_contacts') {
      const minContacts = check.minContacts ?? check.targets.length

      for (const target of check.targets) {
        const pair = {
          partAId: check.pathPartId,
          partBId: target.partId,
          visualAId: check.pathVisualId,
          visualBId: target.visualId,
        }

        if (!hasQualifiedRelationVisualScope(pair, visualCountByPartId)) {
          continue
        }

        addRelationEvidence(evidence, pair)
        if (check.pose) {
          addRelationEvidence(evidence, pair, { poseSpecific: true })
        }

        if (minContacts >= 2) {
          addPathRelationEvidence(
            evidence,
            pair.partAId,
            pair.partBId,
            pair.visualBId,
          )
          if (check.pose) {
            addPathRelationEvidence(
              evidence,
              pair.partAId,
              pair.partBId,
              pair.visualBId,
              { poseSpecific: true },
            )
          }
        }
      }

      continue
    }

    for (const pair of getRelationCheckPartVisualPairs(check)) {
      if (hasQualifiedRelationVisualScope(pair, visualCountByPartId)) {
        addRelationEvidence(evidence, pair)
        if (check.pose) {
          addRelationEvidence(evidence, pair, { poseSpecific: true })
        }
      }
    }
  }

  for (const part of asset.parts) {
    for (const visual of part.visuals) {
      if (visual.geometry.type !== 'connectorTube') {
        continue
      }

      let endpointCount = 0

      for (const endpointPartId of [
        visual.geometry.start.partId,
        visual.geometry.end.partId,
      ]) {
        if (endpointPartId === part.id) {
          continue
        }

        endpointCount += 1
        addRelationEvidence(evidence, {
          partAId: part.id,
          partBId: endpointPartId,
        })
      }

      evidence.connectorEndpointCountsByPartId.set(
        part.id,
        (evidence.connectorEndpointCountsByPartId.get(part.id) ?? 0) +
          endpointCount,
      )
    }
  }

  return evidence
}

type RelationTargetContext = {
  partById: ReadonlyMap<string, ManifestAsset['parts'][number]>
  visualDescriptorById: ReadonlyMap<string, string>
}

function createRelationTargetContext(asset: ManifestAsset): RelationTargetContext {
  const visualDescriptorById = new Map<string, string>()

  for (const part of asset.parts) {
    for (const visual of part.visuals) {
      visualDescriptorById.set(visual.id, [visual.id, visual.name ?? ''].join(' '))
    }
  }

  return {
    partById: new Map(asset.parts.map((part) => [part.id, part])),
    visualDescriptorById,
  }
}

function validatePathTargetQuality({
  asset,
  evidence,
  part,
  partIndex,
  promptDescriptor,
  targetContext,
}: {
  asset: ManifestAsset
  evidence: RelationEvidence
  part: ManifestAsset['parts'][number]
  partIndex: number
  promptDescriptor: string
  targetContext: RelationTargetContext
}): ValidationSignal[] {
  if (
    !matchesAnyTerm(promptDescriptor, pathLikePartTerms) ||
    !matchesAnyTerm(promptDescriptor, rotaryPathSupportPartTerms)
  ) {
    return []
  }

  const requiredContacts = getRequiredRotaryPathTargetCount(
    asset,
    promptDescriptor,
  )
  const rotaryContactCount = countUniqueRelationTargets(
    evidence.pathTargetsByPartId.get(part.id) ?? [],
    (target) =>
      targetMatchesAnyTerm(
        target,
        rotaryPathSupportPartTerms,
        targetContext,
      ),
  )

  if (rotaryContactCount >= requiredContacts) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_path_rotary_contacts_missing',
      `Path-like mechanical part "${part.id}" needs contact evidence against the rotary supports named by the prompt.`,
      {
        details:
          'For wrapped belts, chains, tracks, and similar routed paths that mention pulleys, sprockets, wheels, rims, gears, or rollers, expect_path_contacts targets should be those support visuals rather than unrelated frames, guards, or decorative neighbors.',
        path: `/parts/${partIndex}`,
        refs: {
          currentRotaryContacts: String(rotaryContactCount),
          partId: part.id,
          requiredRotaryContacts: String(requiredContacts),
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validatePathPoseTargetQuality({
  asset,
  evidence,
  part,
  partIndex,
  poseRelationEvidenceRequired,
  promptDescriptor,
  targetContext,
}: {
  asset: ManifestAsset
  evidence: RelationEvidence
  part: ManifestAsset['parts'][number]
  partIndex: number
  poseRelationEvidenceRequired: boolean
  promptDescriptor: string
  targetContext: RelationTargetContext
}): ValidationSignal[] {
  if (
    !poseRelationEvidenceRequired ||
    !matchesAnyTerm(promptDescriptor, pathLikePartTerms) ||
    !matchesAnyTerm(promptDescriptor, rotaryPathSupportPartTerms)
  ) {
    return []
  }

  const requiredContacts = getRequiredRotaryPathTargetCount(
    asset,
    promptDescriptor,
  )
  const poseRotaryContactCount = countUniqueRelationTargets(
    evidence.posePathTargetsByPartId.get(part.id) ?? [],
    (target) =>
      targetMatchesAnyTerm(
        target,
        rotaryPathSupportPartTerms,
        targetContext,
      ),
  )

  if (poseRotaryContactCount >= requiredContacts) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_path_pose_contacts_missing',
      `Path-like mechanical part "${part.id}" needs pose-specific contact evidence for linked motion.`,
      {
        details:
          'For linked mechanisms with moving joints, wrapped belts, chains, tracks, and similar routed paths should include pose-specific expect_path_contacts evidence at a sampled driven pose so validation proves the path stays seated on the rotary supports during the intended motion.',
        path: `/parts/${partIndex}`,
        refs: {
          currentPoseRotaryContacts: String(poseRotaryContactCount),
          partId: part.id,
          requiredPoseRotaryContacts: String(requiredContacts),
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateCouplerRigidRepresentation({
  part,
  partIndex,
}: {
  part: ManifestAsset['parts'][number]
  partIndex: number
}): ValidationSignal[] {
  const connectorTubeVisualIds = part.visuals
    .filter((visual) => visual.geometry.type === 'connectorTube')
    .map((visual) => visual.id)
  const hasRigidVisual = part.visuals.some(
    (visual) => visual.geometry.type !== 'connectorTube',
  )

  if (connectorTubeVisualIds.length === 0 || hasRigidVisual) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_coupler_rigid_visual_missing',
      `Mechanical coupler part "${part.id}" needs rigid linkage geometry, not only connectorTube endpoint geometry.`,
      {
        details:
          'Connecting rods, pushrods, tie rods, link arms, and linkages should read as rigid bars with bearing eyes, pins, sockets, or clevis ends. connectorTube is reserved for flexible endpoint-routed cables, hoses, ropes, straps, tethers, and wires; it should not be the only visual proof for a rigid motion-transfer coupler.',
        path: `/parts/${partIndex}/visuals`,
        refs: {
          connectorTubeVisualIds: connectorTubeVisualIds.join(', '),
          partId: part.id,
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateCouplerTargetQuality({
  evidence,
  part,
  partIndex,
  promptDescriptor,
  targetContext,
}: {
  evidence: RelationEvidence
  part: ManifestAsset['parts'][number]
  partIndex: number
  promptDescriptor: string
  targetContext: RelationTargetContext
}): ValidationSignal[] {
  if (
    !matchesAnyTerm(promptDescriptor, guidedMoverPartTerms) ||
    !matchesAnyTerm(promptDescriptor, rotaryInterfacePartTerms)
  ) {
    return []
  }

  const targets = evidence.relationTargetsByPartId.get(part.id) ?? []
  const hasGuidedEndpoint = targets.some((target) =>
    targetMatchesAnyTerm(target, guidedCouplerEndpointTerms, targetContext),
  )
  const hasRotaryEndpoint = targets.some((target) =>
    targetMatchesAnyTerm(target, rotaryCouplerEndpointTerms, targetContext),
  )

  if (hasGuidedEndpoint && hasRotaryEndpoint) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_coupler_endpoint_targets_missing',
      `Mechanical coupler part "${part.id}" needs relation evidence to the guided and rotary mechanism endpoints.`,
      {
        details:
          'When a prompt combines pistons/sliders/valves with a crank, shaft, pulley, gear, sprocket, or wheel, rods and linkages should prove one end at the guided mover or wrist-pin side and the other end at the rotary/crank-pin side. Contacts to frames or decorative supports do not prove motion transfer.',
        path: `/parts/${partIndex}`,
        refs: {
          hasGuidedEndpoint: String(hasGuidedEndpoint),
          hasRotaryEndpoint: String(hasRotaryEndpoint),
          partId: part.id,
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateCouplerPoseTargetQuality({
  evidence,
  part,
  partIndex,
  poseRelationEvidenceRequired,
  promptDescriptor,
  targetContext,
}: {
  evidence: RelationEvidence
  part: ManifestAsset['parts'][number]
  partIndex: number
  poseRelationEvidenceRequired: boolean
  promptDescriptor: string
  targetContext: RelationTargetContext
}): ValidationSignal[] {
  if (
    !poseRelationEvidenceRequired ||
    !matchesAnyTerm(promptDescriptor, guidedMoverPartTerms) ||
    !matchesAnyTerm(promptDescriptor, rotaryInterfacePartTerms)
  ) {
    return []
  }

  const targets = evidence.poseRelationTargetsByPartId.get(part.id) ?? []
  const hasGuidedEndpoint = targets.some((target) =>
    targetMatchesAnyTerm(target, guidedCouplerEndpointTerms, targetContext),
  )
  const hasRotaryEndpoint = targets.some((target) =>
    targetMatchesAnyTerm(target, rotaryCouplerEndpointTerms, targetContext),
  )

  if (hasGuidedEndpoint && hasRotaryEndpoint) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_coupler_pose_targets_missing',
      `Mechanical coupler part "${part.id}" needs pose-specific evidence to its moving endpoints.`,
      {
        details:
          'For linked piston, slider, crank, shaft, gear, pulley, sprocket, or wheel mechanisms, rods and linkages should include pose-specific exact relation checks at a sampled driven pose. Rest-pose-only checks can pass while the moving rod visually detaches from the guided side or rotary side.',
        path: `/parts/${partIndex}`,
        refs: {
          hasPoseGuidedEndpoint: String(hasGuidedEndpoint),
          hasPoseRotaryEndpoint: String(hasRotaryEndpoint),
          partId: part.id,
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateCouplerMotionJointQuality({
  asset,
  part,
  partIndex,
  poseRelationEvidenceRequired,
  promptDescriptor,
}: {
  asset: ManifestAsset
  part: ManifestAsset['parts'][number]
  partIndex: number
  poseRelationEvidenceRequired: boolean
  promptDescriptor: string
}): ValidationSignal[] {
  if (
    !poseRelationEvidenceRequired ||
    !matchesAnyTerm(promptDescriptor, guidedMoverPartTerms) ||
    !matchesAnyTerm(promptDescriptor, rotaryInterfacePartTerms)
  ) {
    return []
  }

  const movableJointIds = asset.joints
    .filter(
      (joint) =>
        joint.type !== 'fixed' &&
        (joint.childPartId === part.id || joint.parentPartId === part.id),
    )
    .map((joint) => joint.id)

  if (movableJointIds.length > 0) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_coupler_motion_joint_missing',
      `Mechanical coupler part "${part.id}" needs a movable pivot joint for linked motion.`,
      {
        details:
          'In crank, piston, slider, and linkage mechanisms, rigid rods and link arms should pivot at a pin, bearing eye, clevis, socket, or crank end and participate in the linked control. A fixed-only rod can look connected at rest while detaching or colliding when the crank and guided mover animate.',
        path: `/parts/${partIndex}`,
        refs: {
          currentMovableJointIds: movableJointIds.join(', '),
          partId: part.id,
          requiredMovableJoints: '1',
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateGuidedTargetQuality({
  evidence,
  part,
  partIndex,
  targetContext,
}: {
  evidence: RelationEvidence
  part: ManifestAsset['parts'][number]
  partIndex: number
  targetContext: RelationTargetContext
}): ValidationSignal[] {
  const targets = evidence.relationTargetsByPartId.get(part.id) ?? []
  const hasGuideTarget = targets.some((target) =>
    targetMatchesGuideInterface(target, targetContext),
  )

  if (hasGuideTarget) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_guided_interface_target_missing',
      `Guided mechanical part "${part.id}" needs relation evidence to a guide, liner, cylinder, rail, housing, or support.`,
      {
        details:
          'Pistons, sliders, plungers, sleeves, and valves should not only connect to rods or loose neighboring hardware; authored relation evidence should prove the guide, cylinder, liner, rail, sleeve, housing, or support that constrains their motion.',
        path: `/parts/${partIndex}`,
        refs: { partId: part.id },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateGuidedPoseTargetQuality({
  evidence,
  part,
  partIndex,
  poseRelationEvidenceRequired,
  targetContext,
}: {
  evidence: RelationEvidence
  part: ManifestAsset['parts'][number]
  partIndex: number
  poseRelationEvidenceRequired: boolean
  targetContext: RelationTargetContext
}): ValidationSignal[] {
  if (!poseRelationEvidenceRequired) {
    return []
  }

  const targets = evidence.poseRelationTargetsByPartId.get(part.id) ?? []
  const hasPoseGuideTarget = targets.some((target) =>
    targetMatchesGuideInterface(target, targetContext),
  )

  if (hasPoseGuideTarget) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_guided_pose_target_missing',
      `Guided mechanical part "${part.id}" needs pose-specific guide evidence for linked motion.`,
      {
        details:
          'For linked mechanisms with moving joints, pistons, sliders, plungers, sleeves, and valves should include pose-specific relation evidence to their guide, liner, cylinder, rail, sleeve, housing, or support. This proves the guided mover stays constrained during preview/export motion instead of only at rest.',
        path: `/parts/${partIndex}`,
        refs: { partId: part.id },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateGuidedMotionJointQuality({
  asset,
  guidedMotionRequired,
  part,
  partIndex,
  targetContext,
}: {
  asset: ManifestAsset
  guidedMotionRequired: boolean
  part: ManifestAsset['parts'][number]
  partIndex: number
  targetContext: RelationTargetContext
}): ValidationSignal[] {
  if (!guidedMotionRequired) {
    return []
  }

  const guidedJoint = findGuidedPrismaticJoint(asset, part.id, targetContext)

  if (guidedJoint) {
    return []
  }

  const candidatePrismaticJoints = asset.joints
    .filter((joint) => joint.childPartId === part.id && joint.type === 'prismatic')
    .map((joint) => joint.id)

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_guided_motion_joint_missing',
      `Guided mechanical part "${part.id}" needs a prismatic joint to its guide for requested linear motion.`,
      {
        details:
          'Pistons, sliders, plungers, sleeves, and valves that are requested to slide, stroke, reciprocate, or couple to a crank should be movable children of a guide, cylinder, rail, housing, or support through a prismatic joint. Keep rods/linkages connected through relation checks and controls; do not make the guided mover only a fixed child of the rod.',
        path: `/parts/${partIndex}`,
        refs: {
          currentPrismaticJoints: candidatePrismaticJoints.join(', '),
          partId: part.id,
          requiredJointType: 'prismatic',
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateRotaryMotionJointQuality({
  asset,
  part,
  partIndex,
  promptDescriptor,
  targetContext,
}: {
  asset: ManifestAsset
  part: ManifestAsset['parts'][number]
  partIndex: number
  promptDescriptor: string
  targetContext: RelationTargetContext
}): ValidationSignal[] {
  if (!isRotaryMotionRequiredForPrompt(promptDescriptor)) {
    return []
  }

  const rotaryJoint = findRotaryMotionJoint(asset, part.id, targetContext)

  if (rotaryJoint) {
    return []
  }

  const candidateRotaryJoints = asset.joints
    .filter(
      (joint) =>
        joint.childPartId === part.id &&
        (joint.type === 'revolute' || joint.type === 'continuous'),
    )
    .map((joint) => joint.id)

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_rotary_motion_joint_missing',
      `Rotary mechanical part "${part.id}" needs a revolute or continuous joint to its support for requested rotary motion.`,
      {
        details:
          'Cranks, crankshafts, shafts, gears, pulleys, sprockets, wheels, rotors, turbines, fans, and impellers that are requested to spin, rotate, drive, time, or transfer coupled motion should be movable children of a base, housing, support, bearing, collar, or hub through a revolute or continuous joint. Relation checks prove fit; the rotary joint makes the motion inspectable and controllable.',
        path: `/parts/${partIndex}`,
        refs: {
          currentRotaryJoints: candidateRotaryJoints.join(', '),
          partId: part.id,
          requiredJointType: 'revolute_or_continuous',
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateLinkedMechanicalControlCoverage(
  asset: ManifestAsset,
  promptDescriptor: string,
  targetContext: RelationTargetContext,
): ValidationSignal[] {
  if (!matchesAnyTerm(promptDescriptor, linkedMechanicalControlTerms)) {
    return []
  }

  const movableJointIds = new Set(
    asset.joints
      .filter((joint) => joint.type !== 'fixed')
      .map((joint) => joint.id),
  )

  if (movableJointIds.size < 2) {
    return []
  }

  const hasLinkedControl = asset.controls.some((control) => {
    const movableBindingCount = new Set(
      control.joints
        .map((binding) => binding.jointId)
        .filter((jointId) => movableJointIds.has(jointId)),
    ).size

    return movableBindingCount >= 2
  })

  if (hasLinkedControl) {
    return validateGuidedLinkedControlCoverage(
      asset,
      promptDescriptor,
      targetContext,
    )
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_linked_control_missing',
      'Linked mechanical prompt needs at least one control that drives multiple movable joints together.',
      {
        details:
          'For driven, coupled, timing, crank, belt, chain, gear-train, or linkage mechanisms, controls should express the visible coupled motion instead of exposing every piston, rod, pulley, shaft, or wheel as an unrelated one-joint dial.',
        path: '/controls',
        refs: { movableJointCount: String(movableJointIds.size) },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function validateGuidedLinkedControlCoverage(
  asset: ManifestAsset,
  promptDescriptor: string,
  targetContext: RelationTargetContext,
): ValidationSignal[] {
  if (
    !isGuidedMotionRequiredForPrompt(promptDescriptor) ||
    !matchesAnyTerm(promptDescriptor, rotaryInterfacePartTerms)
  ) {
    return []
  }

  const guidedJointIds = new Set(
    getPromptCriticalGuidedPrismaticJoints(
      asset,
      promptDescriptor,
      targetContext,
    ).map((joint) => joint.id),
  )
  const rotaryJointIds = new Set(
    getPromptCriticalRotaryMotionJoints(asset, targetContext).map(
      (joint) => joint.id,
    ),
  )

  if (guidedJointIds.size === 0 || rotaryJointIds.size === 0) {
    return []
  }

  const hasGuidedRotaryControl = asset.controls.some((control) => {
    const boundJointIds = new Set(control.joints.map((binding) => binding.jointId))
    const bindsGuidedMotion = [...guidedJointIds].some((jointId) =>
      boundJointIds.has(jointId),
    )
    const bindsRotaryMotion = [...rotaryJointIds].some((jointId) =>
      boundJointIds.has(jointId),
    )

    return bindsGuidedMotion && bindsRotaryMotion
  })

  if (hasGuidedRotaryControl) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      'mechanical_guided_linked_control_missing',
      'Linked guided mechanical prompt needs one control that drives the guided linear joint and rotary joint together.',
      {
        details:
          'For piston/slider/plunger mechanisms driven by a crank, shaft, gear, pulley, sprocket, wheel, linkage, belt, chain, or drivetrain, the authored control should bind at least one guided prismatic joint and one rotary joint together. Separate controls can make the preview/export look disconnected even when contact checks pass.',
        path: '/controls',
        refs: {
          guidedJointIds: [...guidedJointIds].join(', '),
          rotaryJointIds: [...rotaryJointIds].join(', '),
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function isLinkedMechanicalPoseEvidenceRequired(
  asset: ManifestAsset,
  promptDescriptor: string,
) {
  if (!matchesAnyTerm(promptDescriptor, linkedMechanicalControlTerms)) {
    return false
  }

  const movableJointCount = asset.joints.filter((joint) => joint.type !== 'fixed')
    .length

  return movableJointCount >= 2
}

function isGuidedMotionRequiredForPrompt(promptDescriptor: string) {
  if (!matchesAnyTerm(promptDescriptor, guidedMoverPartTerms)) {
    return false
  }

  return (
    matchesAnyTerm(promptDescriptor, guidedMotionPromptTerms) ||
    matchesAnyTerm(promptDescriptor, linkedMechanicalControlTerms)
  )
}

function isGuidedMotionRequiredForPart(
  part: ManifestAsset['parts'][number],
  promptDescriptor: string,
) {
  if (!isGuidedMotionRequiredForPrompt(promptDescriptor)) {
    return false
  }

  const partDescriptor = getPartMotionDescriptor(part)
  const requestedPartTerms = guidedMoverPartTerms.filter((term) =>
    matchesTerm(partDescriptor, term),
  )

  if (requestedPartTerms.length === 0) {
    return false
  }

  if (matchesAnyTerm(partDescriptor, guidedScopedMotionPromptTerms)) {
    return true
  }

  if (
    requestedPartTerms.some((term) =>
      promptTermAppearsNearAnyTerm(
        promptDescriptor,
        term,
        guidedScopedMotionPromptTerms,
      ),
    )
  ) {
    return true
  }

  return (
    matchesAnyTerm(promptDescriptor, linkedMechanicalControlTerms) &&
    requestedPartTerms.some((term) =>
      conventionalGuidedMotionPartTerms.includes(term),
    )
  )
}

function isRotaryMotionRequiredForPrompt(promptDescriptor: string) {
  return matchesAnyTerm(promptDescriptor, rotaryMotionPromptTerms)
}

function getPromptCriticalGuidedPrismaticJoints(
  asset: ManifestAsset,
  promptDescriptor: string,
  targetContext: RelationTargetContext,
) {
  if (!isGuidedMotionRequiredForPrompt(promptDescriptor)) {
    return []
  }

  return asset.parts
    .filter((part) =>
      isGuidedMotionRequiredForPart(part, promptDescriptor),
    )
    .map((part) => findGuidedPrismaticJoint(asset, part.id, targetContext))
    .filter((joint): joint is ManifestAsset['joints'][number] =>
      Boolean(joint),
    )
}

function findGuidedPrismaticJoint(
  asset: ManifestAsset,
  partId: string,
  targetContext: RelationTargetContext,
) {
  return asset.joints.find(
    (joint) =>
      joint.type === 'prismatic' &&
      joint.childPartId === partId &&
      targetMatchesGuideInterface({ partId: joint.parentPartId }, targetContext),
  )
}

function findRotaryMotionJoint(
  asset: ManifestAsset,
  partId: string,
  targetContext: RelationTargetContext,
) {
  return asset.joints.find(
    (joint) =>
      (joint.type === 'revolute' || joint.type === 'continuous') &&
      joint.childPartId === partId &&
      targetMatchesRotarySupport({ partId: joint.parentPartId }, targetContext),
  )
}

function getPromptCriticalRotaryMotionJoints(
  asset: ManifestAsset,
  targetContext: RelationTargetContext,
) {
  return asset.joints.filter(
    (joint) =>
      (joint.type === 'revolute' || joint.type === 'continuous') &&
      jointMatchesAnyTerm(joint, rotaryMoverPartTerms, targetContext),
  )
}

function jointMatchesAnyTerm(
  joint: ManifestAsset['joints'][number],
  terms: readonly string[],
  targetContext: RelationTargetContext,
) {
  const parentPart = targetContext.partById.get(joint.parentPartId)
  const childPart = targetContext.partById.get(joint.childPartId)

  return (
    matchesAnyTerm([joint.id, joint.name].join(' '), terms) ||
    Boolean(parentPart && targetPartMatchesAnyTerm(parentPart, terms)) ||
    Boolean(childPart && targetPartMatchesAnyTerm(childPart, terms))
  )
}

function hasQualifiedRelationVisualScope(
  pair: {
    partAId: string
    partBId: string
    visualAId?: string
    visualBId?: string
  },
  visualCountByPartId: ReadonlyMap<string, number>,
) {
  const leftVisualCount = visualCountByPartId.get(pair.partAId)
  const rightVisualCount = visualCountByPartId.get(pair.partBId)

  if (leftVisualCount === undefined || rightVisualCount === undefined) {
    return false
  }

  return (
    (leftVisualCount <= 1 || Boolean(pair.visualAId)) &&
    (rightVisualCount <= 1 || Boolean(pair.visualBId))
  )
}

function addRelationEvidence(
  evidence: RelationEvidence,
  pair: {
    partAId: string
    partBId: string
    visualAId?: string
    visualBId?: string
  },
  options: { poseSpecific?: boolean } = {},
) {
  if (pair.partAId === pair.partBId) {
    return
  }

  addOneWayRelationEvidence(
    evidence,
    pair.partAId,
    pair.partBId,
    pair.visualBId,
  )
  addOneWayRelationEvidence(
    evidence,
    pair.partBId,
    pair.partAId,
    pair.visualAId,
  )

  if (options.poseSpecific) {
    addRelationTargetEvidence(
      evidence.poseRelationTargetsByPartId,
      pair.partAId,
      pair.partBId,
      pair.visualBId,
    )
    addRelationTargetEvidence(
      evidence.poseRelationTargetsByPartId,
      pair.partBId,
      pair.partAId,
      pair.visualAId,
    )
  }
}

function addOneWayRelationEvidence(
  evidence: RelationEvidence,
  partId: string,
  otherPartId: string,
  otherVisualId?: string,
) {
  const contacts = evidence.contactsByPartId.get(partId) ?? new Set<string>()

  contacts.add(otherPartId)
  evidence.contactsByPartId.set(partId, contacts)
  addRelationTargetEvidence(
    evidence.relationTargetsByPartId,
    partId,
    otherPartId,
    otherVisualId,
  )
}

function addPathRelationEvidence(
  evidence: RelationEvidence,
  pathPartId: string,
  targetPartId: string,
  targetVisualId?: string,
  options: { poseSpecific?: boolean } = {},
) {
  if (pathPartId === targetPartId) {
    return
  }

  const pathContacts = evidence.pathContactsByPartId.get(pathPartId) ?? new Set<string>()

  pathContacts.add(targetPartId)
  evidence.pathContactsByPartId.set(pathPartId, pathContacts)
  addRelationTargetEvidence(
    evidence.pathTargetsByPartId,
    pathPartId,
    targetPartId,
    targetVisualId,
  )

  if (options.poseSpecific) {
    addRelationTargetEvidence(
      evidence.posePathTargetsByPartId,
      pathPartId,
      targetPartId,
      targetVisualId,
    )
  }
}

function addRelationTargetEvidence(
  targetMap: Map<string, RelationTargetEvidence[]>,
  partId: string,
  targetPartId: string,
  targetVisualId?: string,
) {
  const targets = targetMap.get(partId) ?? []

  if (
    !targets.some(
      (target) =>
        target.partId === targetPartId && target.visualId === targetVisualId,
    )
  ) {
    targets.push({
      partId: targetPartId,
      ...(targetVisualId ? { visualId: targetVisualId } : {}),
    })
  }

  targetMap.set(partId, targets)
}

function getRequiredRotaryPathTargetCount(
  asset: ManifestAsset,
  promptDescriptor: string,
) {
  if (promptAsksForMultipleRotaryPathSupports(promptDescriptor)) {
    return 2
  }

  const rotarySupportPartCount = asset.parts.filter(
    (part) =>
      !isPathLikeMechanicalPart(part) &&
      targetPartMatchesAnyTerm(part, rotaryPathSupportPartTerms),
  ).length

  return rotarySupportPartCount >= 2 ? 2 : 1
}

function promptAsksForMultipleRotaryPathSupports(promptDescriptor: string) {
  return matchesAnyTerm(promptDescriptor, [
    'two gears',
    'two pulleys',
    'two rollers',
    'two sprockets',
    'two wheels',
    'gears',
    'pulleys',
    'rollers',
    'sprockets',
    'wheels',
  ])
}

function countUniqueRelationTargets(
  targets: readonly RelationTargetEvidence[],
  predicate: (target: RelationTargetEvidence) => boolean,
) {
  const targetPartIds = new Set<string>()

  for (const target of targets) {
    if (predicate(target)) {
      targetPartIds.add(target.partId)
    }
  }

  return targetPartIds.size
}

function targetMatchesAnyTerm(
  target: RelationTargetEvidence,
  terms: readonly string[],
  context: RelationTargetContext,
) {
  const part = context.partById.get(target.partId)
  const visualDescriptor = target.visualId
    ? context.visualDescriptorById.get(target.visualId) ?? ''
    : ''

  return (
    Boolean(part && targetPartMatchesAnyTerm(part, terms)) ||
    matchesAnyTerm(visualDescriptor, terms)
  )
}

function targetMatchesGuideInterface(
  target: RelationTargetEvidence,
  context: RelationTargetContext,
) {
  const part = context.partById.get(target.partId)

  return (
    targetMatchesAnyTerm(target, guideInterfacePartTerms, context) ||
    part?.role === 'base' ||
    part?.role === 'housing' ||
    part?.role === 'support'
  )
}

function targetMatchesRotarySupport(
  target: RelationTargetEvidence,
  context: RelationTargetContext,
) {
  const part = context.partById.get(target.partId)

  return (
    targetMatchesAnyTerm(
      target,
      ['bearing', 'collar', 'housing', 'hub', 'mount', 'support'],
      context,
    ) ||
    part?.role === 'base' ||
    part?.role === 'housing' ||
    part?.role === 'support'
  )
}

function targetPartMatchesAnyTerm(
  part: ManifestAsset['parts'][number],
  terms: readonly string[],
) {
  return matchesAnyTerm(getPartIdentityDescriptor(part), terms)
}

function validateMechanicalPromptComponentCoverage(
  asset: ManifestAsset,
  promptDescriptor: string,
): ValidationSignal[] {
  const signals: ValidationSignal[] = []

  signals.push(
    ...validateMechanicalPromptComponentGroup(asset, promptDescriptor, {
      code: 'mechanical_path_part_missing',
      details:
        'The prompt asks for a belt, chain, track, cable, hose, rope, strap, wire, or similar routed path. The manifest should include a clearly named path-like part so relation checks can prove it rides on its supports.',
      kindLabel: 'path-like mechanical part',
      terms: pathLikePartTerms,
    }),
  )
  signals.push(
    ...validateMechanicalPromptComponentGroup(asset, promptDescriptor, {
      code: 'mechanical_coupler_part_missing',
      details:
        'The prompt asks for a connecting rod, linkage, pushrod, or tie rod. The manifest should include a clearly named coupler part so relation checks can prove both motion-transfer ends.',
      kindLabel: 'mechanical coupler part',
      terms: couplerPartTerms,
    }),
  )
  signals.push(
    ...validateMechanicalPromptComponentGroup(asset, promptDescriptor, {
      code: 'mechanical_guided_part_missing',
      details:
        'The prompt asks for a piston, slider, plunger, carriage, sleeve, or valve. The manifest should include a clearly named guided-motion part so relation checks can prove it sits in a guide, cylinder, rail, or housing.',
      kindLabel: 'guided mechanical part',
      terms: guidedMoverPartTerms,
    }),
  )
  signals.push(
    ...validateMechanicalPromptComponentGroup(asset, promptDescriptor, {
      code: 'mechanical_rotary_part_missing',
      details:
        'The prompt asks for a shaft, crank, cam, gear, pulley, sprocket, wheel, axle, hub, bearing, or collar. The manifest should include a clearly named rotary-interface part so relation checks can prove how it is supported or coupled.',
      kindLabel: 'rotary mechanical part',
      terms: rotaryInterfacePartTerms,
    }),
  )

  return signals
}

function validateMechanicalPromptComponentGroup(
  asset: ManifestAsset,
  promptDescriptor: string,
  group: {
    code: string
    details: string
    kindLabel: string
    terms: readonly string[]
  },
): ValidationSignal[] {
  const requestedTerms = getRequestedComponentTerms(
    promptDescriptor,
    group.terms,
  )

  if (requestedTerms.length === 0) {
    return []
  }

  const missingTerms = requestedTerms.filter(
    (term) =>
      !asset.parts.some((part) =>
        partRepresentsComponentTerm(part, term, group.code),
      ),
  )

  if (missingTerms.length === 0) {
    return []
  }

  return [
    createValidationSignal(
      'mechanical_relation_coverage',
      group.code,
      `Prompt asks for a ${group.kindLabel}, but no part is named as one.`,
      {
        details: group.details,
        path: '/parts',
        refs: {
          missingTerms: missingTerms.join(', '),
          requestedTerms: requestedTerms.join(', '),
        },
        source: 'checks',
        stage: 'structure',
      },
    ),
  ]
}

function getPartIdentityDescriptor(part: ManifestAsset['parts'][number]) {
  return [part.id, part.name, part.role].join(' ')
}

function getPartMotionDescriptor(part: ManifestAsset['parts'][number]) {
  return [part.id, part.name, part.role, part.description].join(' ')
}

function isPathLikeMechanicalPart(part: ManifestAsset['parts'][number]) {
  const descriptor = getPartIdentityDescriptor(part)

  if (!matchesAnyTerm(descriptor, pathLikePartTerms)) {
    return false
  }

  if (part.role === 'wheel' || matchesAnyTerm(descriptor, rotaryInterfacePartTerms)) {
    return false
  }

  return true
}

function partRepresentsComponentTerm(
  part: ManifestAsset['parts'][number],
  term: string,
  groupCode: string,
) {
  if (!matchesTerm(getPartIdentityDescriptor(part), term)) {
    return false
  }

  if (groupCode === 'mechanical_path_part_missing') {
    return isPathLikeMechanicalPart(part)
  }

  return true
}

function getAssetPromptDescriptor(asset: ManifestAsset) {
  return [asset.name, asset.prompt].join(' ')
}

function matchesAnyTerm(value: string, terms: readonly string[]) {
  return terms.some((term) => matchesTerm(value, term))
}

function matchesTerm(value: string, term: string) {
  const normalizedValue = normalizeMatchText(value)
  const spacedValue = ` ${normalizedValue} `
  const compactValue = normalizedValue.replaceAll(' ', '')
  const normalizedTerm = normalizeMatchText(term)

  return (
    spacedValue.includes(` ${normalizedTerm} `) ||
    compactValue.includes(normalizedTerm.replaceAll(' ', ''))
  )
}

function getRequestedComponentTerms(
  promptDescriptor: string,
  terms: readonly string[],
) {
  const requestedTerms = terms.filter((term) =>
    matchesTerm(promptDescriptor, term),
  )

  return requestedTerms.filter((term) => {
    const termCompact = normalizeMatchText(term).replaceAll(' ', '')

    return !requestedTerms.some((otherTerm) => {
      if (otherTerm === term) {
        return false
      }

      const otherCompact = normalizeMatchText(otherTerm).replaceAll(' ', '')

      return termCompact.length > otherCompact.length &&
        termCompact.includes(otherCompact)
    })
  })
}

function promptTermAppearsNearAnyTerm(
  value: string,
  anchorTerm: string,
  nearbyTerms: readonly string[],
  maxWords = 5,
) {
  const words = normalizeMatchText(value).split(' ').filter(Boolean)
  const anchorWords = normalizeMatchText(anchorTerm).split(' ').filter(Boolean)

  if (anchorWords.length === 0) {
    return false
  }

  for (let index = 0; index <= words.length - anchorWords.length; index += 1) {
    const hasAnchor = matchesTerm(
      words.slice(index, index + anchorWords.length).join(' '),
      anchorTerm,
    )

    if (!hasAnchor) {
      continue
    }

    const start = Math.max(0, index - maxWords)
    const end = Math.min(words.length, index + anchorWords.length + maxWords)
    const window = words.slice(start, end).join(' ')

    if (matchesAnyTerm(window, nearbyTerms)) {
      return true
    }
  }

  return false
}

function normalizeMatchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
