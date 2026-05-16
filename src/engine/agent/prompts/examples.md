# Compact Example

```json
{
  "schemaVersion": 2,
  "id": "example-hinged-box",
  "name": "Example Hinged Box",
  "prompt": "A compact box with a hinged lid.",
  "units": "meters",
  "parts": [
    {
      "id": "box-base",
      "name": "Base",
      "role": "base",
      "visuals": [
        {
          "id": "box-base-shell",
          "name": "Base shell",
          "geometry": { "type": "box", "size": [0.8, 0.3, 0.5] },
          "transform": { "position": [0, 0.15, 0] },
          "materialId": "mat-body"
        }
      ]
    },
    {
      "id": "box-lid",
      "name": "Lid",
      "role": "hinge",
      "visuals": [
        {
          "id": "box-lid-panel",
          "name": "Lid panel",
          "geometry": { "type": "box", "size": [0.82, 0.06, 0.52] },
          "transform": { "position": [0, 0.03, 0] },
          "materialId": "mat-lid"
        }
      ]
    }
  ],
  "joints": [
    {
      "id": "box-lid-hinge",
      "name": "Lid hinge",
      "type": "revolute",
      "parentPartId": "box-base",
      "childPartId": "box-lid",
      "origin": { "position": [0, 0.3, 0] },
      "axis": [1, 0, 0],
      "limits": { "lower": 0, "upper": 1.8, "effort": 8, "velocity": 2 }
    }
  ],
  "materials": [
    {
      "id": "mat-body",
      "name": "Soft body",
      "color": "#8fa7ff",
      "metalness": 0.05,
      "roughness": 0.5
    },
    {
      "id": "mat-lid",
      "name": "Light lid",
      "color": "#f7f6ff",
      "metalness": 0,
      "roughness": 0.35
    }
  ],
  "checks": [
    { "type": "part_exists", "partId": "box-base" },
    {
      "type": "joint_exists",
      "jointId": "box-lid-hinge",
      "jointType": "revolute"
    },
    {
      "type": "expect_contact",
      "partAId": "box-base",
      "partBId": "box-lid",
      "visualAId": "box-base-shell",
      "visualBId": "box-lid-panel"
    }
  ],
  "allowances": [],
  "metadata": {
    "createdAt": "2026-05-16T00:00:00.000Z",
    "updatedAt": "2026-05-16T00:00:00.000Z",
    "sourceImageIds": [],
    "generationStatus": "draft"
  }
}
```
