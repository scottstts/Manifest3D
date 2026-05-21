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
material `side`, and geometry segment or bevel fields. Use `position: [0, 0, 0]`,
`rotation: [0, 0, 0]`, and `scale: [1, 1, 1]` when no local transform is
needed.

Materials must choose an explicit render side:

- Use `side: "front"` for normal closed solid geometry and one-way front-facing details such as labels, screens, and decals.
- Use `side: "back"` only for intentionally interior-facing shells.
- Use `side: "double"` for intentional paper-thin, cutaway, or open surfaces that should remain visible from either side.
- If an open or cutaway lathe visual is prompt-critical, add an `expect_material_side` check for that visual so the side choice is tested.
- Use separate material ids when two visuals share color/finish but need different side behavior.

Materials may define emission in their own material object:

- Use `emission: null` and `emissionAnimation: null` for ordinary non-emissive materials.
- Use `emission: { "hasEmission": true, "color": "#rrggbb", "intensity": number }` for a static glowing material.
- Use `emissionAnimation` only for visible light-emission behavior such as flashing police lights, beacons, warning LEDs, screens, or pulsing indicators.
- Each emission animation has `{ "id", "name", "interpolation", "keyframes", "loop" }`; `interpolation` is `"step"` for hard switching or `"linear"` for fades.
- Keyframes use seconds and must start at `time: 0` with strictly increasing times. Each keyframe has `{ "time", "hasEmission", "color", "intensity" }`; set `hasEmission: false` and `intensity: 0` for off intervals.
- Keep the base `emission` aligned with the first keyframe so rest-state preview and dynamic GLB export begin from the same material state.

Part visuals support geometry types `box`, `roundedBox`, `cylinder`, `sphere`, `cone`, `capsule`, `torus`, `lathe`, `extrude`, and `tube`. Visual transforms are local to the owning part.

Geometry authoring guidance:

- Use composed wall, rim, rail, sleeve, panel, handle, boss, shaft, and bracket visuals when the real object has those features.
- Use `roundedBox` for softened manufactured housings, panels, padded blocks, cases, seats, and controls that should not read as sharp placeholder boxes.
- For every `roundedBox`, set `radius <= min(size[0], size[1], size[2]) / 2`. Prefer visibly subtle radii on thin panels and small details; if the form should be fully pill-shaped, use `capsule` instead.
- Use `capsule` for pill-shaped handles, rounded rails, grips, rubber feet, bumpers, soft bars, and small retained pins with rounded ends.
- Do not represent visible hollow bodies or open cavities as one solid box or capped cylinder.
- For protective grilles, cages, guards, and shrouds around moving internals, model the guard as stationary bars/rings with real clearance around the moving part's swept volume.
- Keep visual ids stable and meaningful because checks and allowances may reference them directly.
- Use one connected part for a manufactured continuous piece. Visuals inside that part should touch, mount, or visibly support each other; otherwise split the separate island into its own fixed child part.

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
- `expect_material_side`
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
- Intentional overlap must be paired with `expect_contact`, `expect_gap`, `expect_overlap`, or `expect_within` for the same part pair. If the allowance has `visualAId`/`visualBId`, the proof check must reference that same visual pair.
