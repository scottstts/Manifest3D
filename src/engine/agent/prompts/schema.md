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
  "controls": [],
  "materials": [],
  "checks": [],
  "allowances": [],
  "metadata": {
    "createdAt": "ISO-8601 datetime",
    "updatedAt": "ISO-8601 datetime",
    "sourceImageIds": [],
    "generationStatus": "ready"
  }
}
```

For structured output, include fully populated values for optional authoring
fields when they are useful: visual `name`, part `role` and `description`,
all transform `position`/`rotation`/`scale` arrays, material `opacity`, and
geometry segment or bevel fields. Use `position: [0, 0, 0]`,
`rotation: [0, 0, 0]`, and `scale: [1, 1, 1]` when no local transform is
needed.

Part visuals support geometry types `box`, `roundedBox`, `cylinder`, `sphere`, `cone`, `capsule`, `torus`, `lathe`, `extrude`, and `tube`. Visual transforms are local to the owning part.

Geometry authoring guidance:

- Use composed wall, rim, rail, sleeve, panel, handle, boss, shaft, and bracket visuals when the real object has those features.
- Use `roundedBox` for softened manufactured housings, panels, padded blocks, cases, seats, and controls that should not read as sharp placeholder boxes.
- Use `capsule` for pill-shaped handles, rounded rails, grips, rubber feet, bumpers, soft bars, and small retained pins with rounded ends.
- Do not represent visible hollow bodies or open cavities as one solid box or capped cylinder.
- For protective grilles, cages, guards, and shrouds around moving internals, model the guard as stationary bars/rings with real clearance around the moving part's swept volume.
- Keep visual ids stable and meaningful because checks and allowances may reference them directly.
- Use one connected part for a manufactured continuous piece; use separate parts only when the real object has a separate body or a meaningful joint.

Joints are the assembly source of truth:

- `fixed`: no axis required and no limits.
- `revolute`: nonzero axis plus lower and upper limits.
- `prismatic`: nonzero axis plus lower and upper limits.
- `continuous`: nonzero axis, positive effort and velocity, no lower or upper limits.

Controls define the preview dials exposed by the app:

- Use `controls: []` for static assets, or for a single-movable-joint asset when the fallback dial is acceptable.
- Add a control when one UI dial should drive one or more movable joints.
- If an asset has more than one movable joint, include manifest controls that cover every movable joint. Group linked motion such as wheel spin or paired steering under shared controls, and give independent mechanisms separate controls.
- Each control has `{ "id", "name", "joints", "limits" }`.
- Each control joint binding has `{ "jointId", "scale", "offset" }` and maps dial value to joint value as `offset + scale * dialValue`.
- Use one grouped control for linked motion such as four spinning wheels or paired steering knuckles; use separate controls when mechanisms should move independently, such as two separate window hinges.
- Use `scale: -1` for mirrored motion and `offset` only for intentional phase shifts.

Authored checks should prove prompt-critical exact relationships:

- `part_exists`
- `joint_exists`
- `expect_contact`
- `expect_gap`
- `expect_overlap`
- `expect_within`
- Any check may include `pose: { "name": "...", "joints": [{ "jointId": "...", "value": number }] }` to run it at a sampled joint pose. Use radians for revolute/continuous values and meters for prismatic values.
- Add pose-specific checks for primary mechanisms: open lids, extended drawers/slides, rotated handles, wheels, hinges, sleeves, retainers, and controls.

Allowances:

- `allow_overlap` for intentional scoped overlap, preferably exact visual pairs.
- `allow_isolated_part` only when a physically isolated part is intentional.
- Broad part-pair allowances are a last resort and still need a concrete reason.
- Intentional overlap should normally be paired with `expect_contact`, `expect_gap`, `expect_overlap`, or `expect_within`.
