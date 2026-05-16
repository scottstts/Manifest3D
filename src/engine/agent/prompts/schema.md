# Manifest3D Contract V2

Return one object with this shape:

```json
{
  "schemaVersion": 2,
  "id": "stable-asset-id",
  "name": "Display Name",
  "prompt": "user-facing prompt summary",
  "units": "meters",
  "parts": [],
  "joints": [],
  "materials": [],
  "checks": [],
  "allowances": [],
  "metadata": {
    "createdAt": "ISO-8601 datetime",
    "updatedAt": "ISO-8601 datetime",
    "sourceImageIds": [],
    "generationStatus": "draft"
  }
}
```

Part visuals support geometry types `box`, `cylinder`, `sphere`, `cone`, `torus`, `lathe`, `extrude`, and `tube`. Visual transforms are local to the owning part.

Geometry authoring guidance:

- Use composed wall, rim, rail, sleeve, panel, handle, boss, shaft, and bracket visuals when the real object has those features.
- Do not represent visible hollow bodies or open cavities as one solid box or capped cylinder.
- Keep visual ids stable and meaningful because checks and allowances may reference them directly.
- Use one connected part for a manufactured continuous piece; use separate parts only when the real object has a separate body or a meaningful joint.

Joints are the assembly source of truth:

- `fixed`: no axis required and no limits.
- `revolute`: nonzero axis plus lower and upper limits.
- `prismatic`: nonzero axis plus lower and upper limits.
- `continuous`: nonzero axis, positive effort and velocity, no lower or upper limits.

Authored checks should prove prompt-critical exact relationships:

- `part_exists`
- `joint_exists`
- `expect_contact`
- `expect_gap`
- `expect_overlap`
- `expect_within`

Allowances:

- `allow_overlap` for intentional scoped overlap, preferably exact visual pairs.
- `allow_isolated_part` only when a physically isolated part is intentional.
- Broad part-pair allowances are a last resort and still need a concrete reason.
- Intentional overlap should normally be paired with `expect_contact`, `expect_gap`, `expect_overlap`, or `expect_within`.
