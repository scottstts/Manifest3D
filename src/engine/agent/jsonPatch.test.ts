import { describe, expect, it } from 'vitest'
import { applyJsonPatch } from './jsonPatch'

describe('applyJsonPatch', () => {
  it('applies add, replace, and remove operations without mutating input', () => {
    const document = {
      materials: [{ color: '#000000', id: 'mat' }],
      parts: [{ id: 'base', visuals: [{ id: 'panel' }] }],
    }

    const result = applyJsonPatch(document, {
      patch: [
        { op: 'replace', path: '/materials/0/color', value: '#ffffff' },
        { op: 'add', path: '/parts/0/visuals/-', value: { id: 'trim' } },
        { op: 'remove', path: '/parts/0/visuals/0' },
      ],
    })

    expect(result.status).toBe('ok')
    expect(result.status === 'ok' ? result.value : null).toEqual({
      materials: [{ color: '#ffffff', id: 'mat' }],
      parts: [{ id: 'base', visuals: [{ id: 'trim' }] }],
    })
    expect(document.materials[0].color).toBe('#000000')
  })

  it('resolves virtual byId path segments against the current document', () => {
    const document = {
      materials: [{ color: '#000000', id: 'mat' }],
      parts: [
        { id: 'base', visuals: [{ id: 'panel' }] },
        { id: 'lid', visuals: [{ id: 'handle' }] },
      ],
    }

    const result = applyJsonPatch(document, {
      patch: [
        {
          op: 'replace',
          path: '/parts/byId/lid/visuals/byId/handle/id',
          value: 'pull-handle',
        },
        {
          op: 'add',
          path: '/parts/byId/base/visuals/-',
          value: { id: 'trim' },
        },
      ],
    })

    expect(result.status).toBe('ok')
    expect(result.status === 'ok' ? result.value : null).toEqual({
      materials: [{ color: '#000000', id: 'mat' }],
      parts: [
        { id: 'base', visuals: [{ id: 'panel' }, { id: 'trim' }] },
        { id: 'lid', visuals: [{ id: 'pull-handle' }] },
      ],
    })
  })

  it('rejects invalid patch envelopes and unsafe paths', () => {
    expect(applyJsonPatch({}, [])).toMatchObject({
      status: 'error',
    })
    expect(
      applyJsonPatch(
        {},
        {
          patch: [{ op: 'add', path: '/__proto__/polluted', value: true }],
        },
      ),
    ).toMatchObject({
      status: 'error',
    })
    expect(
      applyJsonPatch(
        { parts: [{ id: 'base' }] },
        {
          patch: [{ op: 'replace', path: '/parts/byId/missing/id', value: 'x' }],
        },
      ),
    ).toMatchObject({
      message:
        'Patch operation 1 failed: No item with id "missing" exists under array path "/parts".',
      status: 'error',
    })
  })

  it('rejects patched results that fail a caller-provided schema check', () => {
    const document = {
      parts: [
        {
          visuals: [
            {
              transform: {
                position: [0, 0, 0],
              },
            },
          ],
        },
      ],
    }

    const result = applyJsonPatch(
      document,
      {
        patch: [
          {
            op: 'replace',
            path: '/parts/0/visuals/0/transform/position',
            value: [],
          },
        ],
      },
      {
        validateResult(value) {
          const position = (
            value as typeof document
          ).parts[0].visuals[0].transform.position

          return position.length === 3
            ? null
            : 'Patched result failed schema validation at /parts/0/visuals/0/transform/position.'
        },
      },
    )

    expect(result).toMatchObject({
      message:
        'Patched result failed schema validation at /parts/0/visuals/0/transform/position.',
      status: 'error',
    })
    expect(document.parts[0].visuals[0].transform.position).toEqual([0, 0, 0])
  })
})
