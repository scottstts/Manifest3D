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

Part visuals support geometry types `box`, `roundedBox`, `cylinder`, `sphere`, `cone`, `capsule`, `torus`, `lathe`, `extrude`, `tube`, and `connectorTube`. Visual transforms are local to the owning part, except `connectorTube`, which resolves from endpoint parts and must use an empty or identity transform. When a full transform object is required, use `position: [0, 0, 0]`, `rotation: [0, 0, 0]`, and `scale: [1, 1, 1]`.

Geometry authoring guidance:

- Use composed wall, rim, rail, sleeve, panel, handle, boss, shaft, and bracket visuals when the real object has those features.
- Use `roundedBox` for softened manufactured housings, panels, padded blocks, cases, seats, and controls that should not read as sharp placeholder boxes.
- For every `roundedBox`, set `radius <= min(size[0], size[1], size[2]) / 2`. Prefer visibly subtle radii on thin panels and small details; if the form should be fully pill-shaped, use `capsule` instead.
- Use `capsule` for pill-shaped handles, rounded rails, grips, rubber feet, bumpers, soft bars, and small retained pins with rounded ends.
- Use `connectorTube` for flexible chains, cables, hoses, ropes, straps, tethers, static suspension cables, bridge hangers, and wires that visually connect two parts, especially when one endpoint is on a movable part. It has `{ "type": "connectorTube", "start": { "partId", "position" }, "end": { "partId", "position" }, "radius", "sag" }`; endpoint `position` values are local to their referenced parts.
- Do not represent visible hollow bodies or open cavities as one solid box or capped cylinder.
- For protective grilles, cages, guards, and shrouds around moving internals, model the guard as stationary bars/rings with real clearance around the moving part's swept volume.
- For cutaway housings, blocks, heads, covers, guards, frames, rails, and shells, use actual windows, posts, collars, split panels, flanges, or open shell surfaces around moving internals. Do not represent an exposed mechanism by placing a solid block, wall, cover lip, or end plate through the moving parts.
- Keep visual ids stable and meaningful because checks and allowances may reference them directly.
- Use one connected part for a manufactured continuous piece. Visuals inside that part should touch, mount, or visibly support each other; otherwise split the separate island into its own fixed child part.

Joints are the assembly source of truth:

- `fixed`: no axis required and no limits.
- `revolute`: nonzero axis plus lower and upper limits.
- `prismatic`: nonzero axis plus lower and upper limits.
- `continuous`: nonzero axis, positive effort and velocity, no lower or upper limits.
- Use `prismatic` for guided linear movers such as pistons, sliders, plungers, sleeves, and valves. The parent should be the guide, cylinder, rail, housing, or support that constrains the part, not the rod or linkage that visually contacts it.
- Use `revolute` for rigid connecting rods, link arms, pushrods, and similar couplers that swing on pins, bearing eyes, clevises, sockets, wrist pins, crank pins, or journals. Do not make a motion-transfer coupler only a fixed child when it should pivot during linked motion.

Controls define the preview dials exposed by the app:

- Use `controls: []` for static assets, or for a single-movable-joint asset when the fallback dial is acceptable.
- Add a control when one UI dial should drive one or more movable joints.
- If an asset has more than one movable joint, include manifest controls that cover every movable joint. Group linked motion such as wheel spin or paired steering under shared controls, and give independent mechanisms separate controls.
- Each control has `{ "id", "name", "joints", "limits" }`.
- Each control joint binding has `{ "jointId", "scale", "offset" }` and maps dial value to joint value as `offset + scale * dialValue`.
- Control `limits` is only `{ "lower": number, "upper": number }`; authored checks and relation descriptors never belong inside control limits.
- Use one grouped control for linked motion such as four spinning wheels or paired steering knuckles; use separate controls when mechanisms should move independently, such as two separate window hinges.
- For slider-crank, piston pump, engine, linkage, belt, chain, drivetrain, or gear-train motion, use one grouped control that binds the guided prismatic joint and the rotary joint together with suitable scale and phase.
- If a rod or linkage has a pivot joint, bind that pivot in the same grouped control as the guided and rotary joints when those parts move as one mechanism.
- Use `scale: -1` for mirrored motion and `offset` only for intentional phase shifts.

Authored checks should prove prompt-critical exact relationships:

- `part_exists`
- `joint_exists`
- `expect_material_side`
- `expect_contact` with optional `contactTolerance` and `maxPenetration`. Use exact `visualAId`/`visualBId` for multi-visual assemblies. Use `maxPenetration: 0` for surface touch, or a small positive value only for intentional seated/captured fits.
- `expect_path_contacts` for belts, chains, cables, hoses, ropes, straps, wires, tracks, and similar routed or looped parts that must touch multiple wheels, pulleys, sprockets, guides, fittings, supports, or mounts. It has `{ "pathPartId", "pathVisualId", "targets": [{ "partId", "visualId" }], "minContacts", "contactTolerance", "maxPenetration" }`. Use exact path and target visual ids. Use `minContacts` equal to the number of required supports for taut belts, chains, tracks, and wrapped paths; separate one-off `expect_contact` checks are not sufficient path coverage.
- `expect_gap`
- `expect_overlap`
- `expect_within` with optional `margin` and `maxPenetration`. Use exact `innerVisualId`/`outerVisualId` and a small positive `maxPenetration` when a guided or captured inner component intentionally sits inside a liner, sleeve, slot, rail, housing, or bearing and should not be treated as loose overlap.
- Any check may include `pose: { "name": "...", "joints": [{ "jointId": "...", "value": number }] }` to run it at a sampled joint pose. Use radians for revolute/continuous values and meters for prismatic values.
- Add pose-specific checks for primary mechanisms: open lids, extended drawers/slides, rotated handles, wheels, hinges, pistons, sleeves, retainers, and controls. For linked guided mechanisms, include the prismatic and rotary joint values in the same pose.
- Entries in `check.pose.joints` are sampled values for existing joints, not full joint descriptors. Do not include `id`, `name`, `type`, `parentPartId`, `childPartId`, `origin`, `axis`, or `limits` in pose samples.
- `check.pose` is not an asset, part, check, or transform container. It must not contain `schemaVersion`, `parts`, `materials`, `checks`, `allowances`, `metadata`, `position`, `rotation`, `scale`, or nested check fields such as `type`, `partAId`, `partBId`, `visualAId`, or `visualBId`.
- Every part, visual, joint, and material reference in a check must name a real stable id from the asset. Do not use placeholder ids such as `x`, `y`, `a`, `b`, `__invalid__`, `invalid`, `part-a`, `part-b`, `visual-a`, or `visual-b`.

Allowances:

- `allow_overlap` for intentional scoped overlap, preferably exact visual pairs.
- `allow_isolated_part` only when a physically isolated part is intentional.
- Broad part-pair allowances are a last resort and still need a concrete reason.
- Intentional fitted contact or containment should be proven with exact visual ids and bounded penetration through `expect_contact.maxPenetration`, `expect_path_contacts.maxPenetration`, `expect_gap.maxPenetration`, or `expect_within.maxPenetration`; validation treats that bounded visual-pair proof as a fitted-contact note instead of a collision. Intentional overlap exceptions that are not bounded fitted contacts should use `allow_overlap` plus a matching `expect_contact`, `expect_path_contacts`, `expect_gap`, `expect_overlap`, or `expect_within` proof for the same part pair. If the allowance has `visualAId`/`visualBId`, the proof check must reference that same visual pair.
- Use `maxPenetration: 0` only for no-penetration surface touch. Captured liners, bearings, collars, sleeves, slots, rails, and seated wrapped paths should use a small positive bound that describes the intended hidden fit.
