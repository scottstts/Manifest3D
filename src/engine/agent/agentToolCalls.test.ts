import { describe, expect, it } from 'vitest'
import { parseManifestAgentToolCall } from './agentToolCalls'

describe('parseManifestAgentToolCall', () => {
  it('parses submit_manifest_asset tool arguments', () => {
    const result = parseManifestAgentToolCall(
      {
        argumentsJson: JSON.stringify({
          asset: {
            id: 'asset-1',
            schemaVersion: 2,
          },
        }),
        tool: 'submit_manifest_asset',
      },
      'submit_manifest_asset',
    )

    expect(result).toMatchObject({
      candidate: {
        id: 'asset-1',
        schemaVersion: 2,
      },
      kind: 'asset',
      status: 'ok',
    })
  })

  it('parses apply_manifest_patch valueJson operations into canonical patch values', () => {
    const result = parseManifestAgentToolCall(
      {
        argumentsJson: JSON.stringify({
          operations: [
            {
              op: 'replace',
              path: '/parts/byId/body/transform/position',
              valueJson: JSON.stringify([0, 1, 0]),
            },
            {
              op: 'add',
              path: '/checks/-',
              valueJson: JSON.stringify({
                partId: 'body',
                type: 'part_exists',
              }),
            },
            {
              op: 'remove',
              path: '/allowances/0',
            },
          ],
        }),
        tool: 'apply_manifest_patch',
      },
      'apply_manifest_patch',
    )

    expect(result).toEqual({
      candidate: {
        patch: [
          {
            op: 'replace',
            path: '/parts/byId/body/transform/position',
            value: [0, 1, 0],
          },
          {
            op: 'add',
            path: '/checks/-',
            value: {
              partId: 'body',
              type: 'part_exists',
            },
          },
          {
            op: 'remove',
            path: '/allowances/0',
          },
        ],
      },
      kind: 'patch',
      status: 'ok',
      tool: 'apply_manifest_patch',
    })
  })

  it('rejects the wrong tool for the turn', () => {
    const result = parseManifestAgentToolCall(
      {
        argumentsJson: JSON.stringify({ operations: [] }),
        tool: 'apply_manifest_patch',
      },
      'submit_manifest_asset',
    )

    expect(result).toMatchObject({
      status: 'error',
    })
  })

  it('rejects root-level repair replacement patches', () => {
    const result = parseManifestAgentToolCall(
      {
        argumentsJson: JSON.stringify({
          operations: [
            {
              op: 'replace',
              path: '',
              valueJson: JSON.stringify({
                id: 'full-asset-rewrite',
                schemaVersion: 2,
              }),
            },
          ],
        }),
        tool: 'apply_manifest_patch',
      },
      'apply_manifest_patch',
    )

    expect(result).toMatchObject({
      message: expect.stringContaining('Do not replace the whole asset'),
      status: 'error',
    })
  })

  it('keeps legacy raw patch fixtures usable for regression tests', () => {
    const result = parseManifestAgentToolCall(
      {
        patch: [
          {
            op: 'replace',
            path: '/name',
            value: 'Updated',
          },
        ],
      },
      'apply_manifest_patch',
    )

    expect(result).toMatchObject({
      kind: 'patch',
      status: 'ok',
    })
  })
})
