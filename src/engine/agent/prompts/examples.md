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
      "description": "Rigid lower box body with the rim where the lid seats.",
      "visuals": [
        {
          "id": "box-base-shell",
          "name": "Base shell",
          "geometry": { "type": "box", "size": [0.8, 0.3, 0.5] },
          "transform": {
            "position": [0, 0.15, 0],
            "rotation": [0, 0, 0],
            "scale": [1, 1, 1]
          },
          "materialId": "mat-body"
        }
      ]
    },
    {
      "id": "box-lid",
      "name": "Lid",
      "role": "hinge",
      "description": "Separate lid panel mounted to the rear hinge line.",
      "visuals": [
        {
          "id": "box-lid-panel",
          "name": "Lid panel",
          "geometry": { "type": "box", "size": [0.82, 0.06, 0.52] },
          "transform": {
            "position": [0, 0.03, 0.26],
            "rotation": [0, 0, 0],
            "scale": [1, 1, 1]
          },
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
      "origin": {
        "position": [0, 0.3, -0.26],
        "rotation": [0, 0, 0],
        "scale": [1, 1, 1]
      },
      "axis": [1, 0, 0],
      "limits": { "lower": -1.8, "upper": 0, "effort": 8, "velocity": 2 }
    }
  ],
  "controls": [
    {
      "id": "lid-control",
      "name": "Lid",
      "joints": [{ "jointId": "box-lid-hinge", "scale": 1, "offset": 0 }],
      "limits": { "lower": -1.8, "upper": 0 }
    }
  ],
  "materials": [
    {
      "id": "mat-body",
      "name": "Soft body",
      "color": "#8fa7ff",
      "metalness": 0.05,
      "roughness": 0.5,
      "opacity": 1
    },
    {
      "id": "mat-lid",
      "name": "Light lid",
      "color": "#f7f6ff",
      "metalness": 0,
      "roughness": 0.35,
      "opacity": 1
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
      "visualBId": "box-lid-panel",
      "contactTolerance": 0.01
    },
    {
      "type": "expect_gap",
      "positivePartId": "box-lid",
      "negativePartId": "box-base",
      "axis": "y",
      "minGap": -0.08,
      "maxGap": 0.6,
      "maxPenetration": 0.08,
      "positiveVisualId": "box-lid-panel",
      "negativeVisualId": "box-base-shell",
      "pose": {
        "name": "lid-open",
        "joints": [{ "jointId": "box-lid-hinge", "value": -1.2 }]
      }
    }
  ],
  "allowances": [],
  "metadata": {
    "createdAt": "2026-05-16T00:00:00.000Z",
    "updatedAt": "2026-05-16T00:00:00.000Z",
    "sourceImageIds": [],
    "generationStatus": "ready"
  }
}
```
