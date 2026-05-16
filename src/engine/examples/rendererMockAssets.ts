import type { ManifestAsset } from '../schema/manifestTypes'

export const rendererMockAssets: readonly ManifestAsset[] = [
  {
    schemaVersion: 2,
    id: 'mock-hinged-box',
    name: 'Mock Hinged Box',
    prompt: 'Simple mock asset for renderer inspection.',
    units: 'meters',
    parts: [
      {
        id: 'box-base',
        name: 'Box base',
        role: 'base',
        visuals: [
          {
            id: 'box-base-visual',
            geometry: { size: [0.9, 0.28, 0.55], type: 'box' },
            materialId: 'mock-blue',
            transform: { position: [0, 0.14, 0] },
          },
        ],
      },
      {
        id: 'box-lid',
        name: 'Box lid',
        role: 'hinge',
        visuals: [
          {
            id: 'box-lid-visual',
            geometry: { size: [0.94, 0.06, 0.59], type: 'box' },
            materialId: 'mock-white',
            transform: { position: [0, 0.03, 0] },
          },
        ],
      },
    ],
    joints: [
      {
        axis: [1, 0, 0],
        childPartId: 'box-lid',
        id: 'box-lid-hinge',
        limits: { effort: 8, lower: 0, upper: 1.7, velocity: 2 },
        name: 'Box lid hinge',
        origin: { position: [0, 0.28, 0] },
        parentPartId: 'box-base',
        type: 'revolute',
      },
    ],
    materials: [
      {
        color: '#8ea4ff',
        id: 'mock-blue',
        metalness: 0.05,
        name: 'Mock blue',
        roughness: 0.45,
      },
      {
        color: '#f8f7ff',
        id: 'mock-white',
        metalness: 0,
        name: 'Mock white',
        roughness: 0.38,
      },
    ],
    checks: [],
    allowances: [],
    metadata: {
      createdAt: '2026-05-16T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-16T00:00:00.000Z',
    },
  },
  {
    schemaVersion: 2,
    id: 'mock-slider',
    name: 'Mock Slider',
    prompt: 'Simple prismatic mock asset for renderer inspection.',
    units: 'meters',
    parts: [
      {
        id: 'slider-rail',
        name: 'Slider rail',
        role: 'base',
        visuals: [
          {
            id: 'slider-rail-visual',
            geometry: { size: [1.1, 0.08, 0.16], type: 'box' },
            materialId: 'mock-steel',
            transform: { position: [0, 0.04, 0] },
          },
        ],
      },
      {
        id: 'slider-carriage',
        name: 'Slider carriage',
        role: 'mechanism',
        visuals: [
          {
            id: 'slider-carriage-visual',
            geometry: { size: [0.24, 0.14, 0.24], type: 'box' },
            materialId: 'mock-orange',
            transform: { position: [0, 0.07, 0] },
          },
        ],
      },
    ],
    joints: [
      {
        axis: [1, 0, 0],
        childPartId: 'slider-carriage',
        id: 'slider-prismatic',
        limits: { effort: 10, lower: -0.35, upper: 0.35, velocity: 1 },
        name: 'Slider prismatic joint',
        origin: { position: [0, 0.08, 0] },
        parentPartId: 'slider-rail',
        type: 'prismatic',
      },
    ],
    materials: [
      {
        color: '#72788d',
        id: 'mock-steel',
        metalness: 0.45,
        name: 'Mock steel',
        roughness: 0.3,
      },
      {
        color: '#ffb15c',
        id: 'mock-orange',
        metalness: 0.05,
        name: 'Mock orange',
        roughness: 0.42,
      },
    ],
    checks: [],
    allowances: [
      {
        partAId: 'slider-rail',
        partBId: 'slider-carriage',
        reason: 'The simple carriage proxy intentionally sits on the rail for this renderer mock.',
        type: 'allow_overlap',
        visualAId: 'slider-rail-visual',
        visualBId: 'slider-carriage-visual',
      },
    ],
    metadata: {
      createdAt: '2026-05-16T00:00:00.000Z',
      generationStatus: 'ready',
      sourceImageIds: [],
      updatedAt: '2026-05-16T00:00:00.000Z',
    },
  },
]
