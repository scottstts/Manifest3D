# Create A New Asset

Create a complete Manifest3D asset that satisfies the user prompt and fits the current scene.

Requirements:

- The asset must be valid Contract V2 JSON.
- Use a single rooted joint tree.
- Give every visual a stable id that can be referenced by checks.
- Add authored checks for the prompt-critical relationships.
- Keep the initial candidate compact, physically plausible, and exportable as GLB.
- Model the object's real construction logic. Use visible walls, rims, lips, rails, bosses, shafts, brackets, panels, and controls instead of one generic placeholder mass.
- Keep each part internally connected: panels, windows, lamps, rails, axles, and brackets assigned to the same part should touch or visibly mount to that part. Use fixed joints for separate attached pieces instead of disconnected visual islands.
- Choose geometry that carries the silhouette. Use `roundedBox` or beveled `extrude` for softened manufactured panels and shells, `capsule`/`tube` for handles and rods, and `lathe`/`torus` for rims, tires, knobs, bowls, wheels, and collars.
- Before returning a candidate, check every `roundedBox`: `radius` must be no larger than half the shortest `size` value.
- For fans, rotors, guarded wheels, or any moving part inside a grille/cage/shroud, leave visible clearance between the stationary guard bars/rings and the moving swept volume.
- Use real-world dimensions and plausible materials.
- For visible lighting requests, make the visible lens/screen material emissive; for flashing or color-switching lights, author material `emissionAnimation` instead of adding separate light objects.
- If the prompt describes a primary mechanism or visible control, represent it as a separate part with an appropriate joint and realistic limits.
- Add manifest `controls` for mechanical assets: group joints under one control when they should move together, and leave independent joints as separate controls or fallback joint dials.
- If the asset has more than one movable joint, controls must cover every movable joint; use fallback dials only for a single-joint mechanism.
- For primary mechanisms, include at least one pose-specific authored check with `check.pose` so validation can inspect the open, extended, rotated, or retained state.
- Do not duplicate baseline QC as checks. Use authored checks for exact prompt-critical relationships only.
- If you author an `allow_overlap`, include a matching exact proof check for the same part pair and exact visual pair when visuals are named.
