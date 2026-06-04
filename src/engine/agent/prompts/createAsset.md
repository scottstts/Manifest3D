# Create A New Asset

Create a complete Manifest3D asset that satisfies the user prompt and fits the current scene.

Requirements:

- The asset must be valid Contract V2 JSON.
- Use a single rooted joint tree.
- Give every visual a stable id that can be referenced by checks.
- Add authored checks for the prompt-critical relationships.
- Keep the initial candidate compact, physically plausible, and exportable as GLB.
- Model the object's real construction logic. Use visible walls, rims, lips, rails, bosses, shafts, brackets, panels, and controls instead of one generic placeholder mass.
- For CAD-like mechanical requests such as engines, pumps, gearboxes, drivetrains, tools, vehicles, and cutaways, make fitted interfaces explicit: bearings/collars around shafts, guides around sliders or valves, pins at rod ends, flanges under covers, liners around pistons, and visible brackets or bosses where assemblies mount.
- For complex mechanical assets, build the moving mechanism and its fitted supports first, then add only the static shell/detail needed to read the object. Prefer a lean first candidate with robust repeated parts over many decorative rails, walls, plates, lobes, or caps that create collisions and expensive repairs.
- For cutaway housings, blocks, heads, covers, guards, frames, rails, and shells, leave real clearance windows around moving internals and their swept volume. Use split rails, posts, collars, brackets, flanges, open shells, or separated cover panels instead of broad solid walls or end plates that pass through shafts, sprockets, chains, rods, pistons, valves, gears, rotors, or other mechanism parts.
- If a static block, head, case, housing, cover, support, or bracket intentionally captures inserted components such as liners, bushings, bearings, collars, sleeves, shafts, hubs, or guide rails, add exact bounded `expect_within` or `expect_contact` proof for each repeated fitted pair that overlaps. Otherwise keep the static support visibly clear of those parts.
- For pistons, sliders, plungers, sleeves, or valves that should slide, stroke, reciprocate, or couple to a crank, use a prismatic joint from the guide/cylinder/rail/housing/support to the guided part. Keep rods/linkages visibly connected through relation checks and shared controls; do not make the guided mover only a fixed child of the rod.
- For rods and linkages that transfer motion between a guided mover and a crank, shaft, gear, sprocket, pulley, or wheel, add at least one revolute pivot joint at a real pin/bearing/clevis/socket endpoint and include it in the linked control. A fixed-only rod can pass rest-pose contact while looking detached or colliding during animation.
- Do not leave mechanical parts loose, hovering, barely tangent, or only visually aligned. Add exact contact, bounded gap, or bounded containment checks for the important mechanical fits.
- If the prompt asks for belts, chains, tracks, wrapped cables, hoses, ropes, straps, wires, rods, or linkages, create clearly named parts for those components instead of implying them with decorative shapes.
- For rigid rods and linkages, use rigid visuals such as capsules, tubes, cylinders, bars, and bearing-eye or clevis ends. Do not use `connectorTube` as the only visual for connecting rods, pushrods, tie rods, link arms, or crank linkages.
- For belts, chains, tracks, wrapped cables, hoses, ropes, straps, and wires, route the path tightly on the relevant supports, wheels, pulleys, sprockets, rims, guides, fittings, or mounts. Add `expect_path_contacts` with exact path and target visual ids for the required contact points; separate one-off `expect_contact` checks are not enough for wrapped path coverage.
- For prompt-critical path supports such as wheels, pulleys, sprockets, gears, rollers, rims, and bearings, create clearly named support parts instead of making them only visuals inside a broader shaft or housing part.
- Keep each part internally connected: panels, windows, lamps, rails, axles, and brackets assigned to the same part should touch or visibly mount to that part. Use fixed joints for separate attached pieces instead of disconnected visual islands.
- Choose geometry that carries the silhouette. Use `roundedBox` or beveled `extrude` for softened manufactured panels and shells, `capsule`/`tube` for handles and rods, and `lathe`/`torus` for rims, tires, knobs, bowls, wheels, and collars.
- Choose material `side` deliberately. Closed solids should usually use `front`; paper-thin, cutaway, or open shell surfaces that must be visible from both sides should use `double`.
- Add `expect_material_side` for any prompt-critical open or cutaway lathe visual so the renderer-side visibility choice is tested.
- Before returning a candidate, check every `roundedBox`: `radius` must be no larger than half the shortest `size` value.
- For fans, rotors, guarded wheels, or any moving part inside a grille/cage/shroud, leave visible clearance between the stationary guard bars/rings and the moving swept volume.
- For fan, compressor, turbine, propeller, or rotor blades, model blade roots as seated features attached to a hub, drum, root band, collar, or dovetail mount. Bare tangent blade contact is not enough.
- Use real-world dimensions and plausible materials.
- For visible lighting requests, make the visible lens/screen material emissive; for flashing or color-switching lights, author material `emissionAnimation` instead of adding separate light objects.
- If the prompt describes a primary mechanism or visible control, represent it as a separate part with an appropriate joint and realistic limits.
- Use `connectorTube` for flexible endpoint-routed cables, hoses, ropes, straps, tethers, bridge hangers, suspension cables, and wires whose endpoints belong to different parts. Use `tube` or `torus` plus `expect_path_contacts` for wrapped belts, chains, tracks, loops, and guided paths.
- Add manifest `controls` for mechanical assets: group joints under one control when they should move together, and leave independent joints as separate controls or fallback joint dials.
- For cranks, shafts, gears, pulleys, sprockets, wheels, rotors, turbines, fans, or impellers that should spin, rotate, drive, time, or transfer motion, use a revolute or continuous joint to a base, housing, support, bearing, collar, or hub.
- For crank, pump, engine, linkage, belt, chain, drivetrain, or gear-train mechanisms with guided linear movers, bind the guided prismatic joint and rotary joint in the same control with plausible scale/phase so the preview/export motion reads coupled.
- Include moving rod/linkage pivot joints in that same control when they are part of the motion-transfer chain.
- For linked mechanisms, make fitted interfaces work through the whole authored control range. Validation samples intermediate control phases, so rods, sliders, belts, chains, gears, and shafts should stay visibly coupled at quarter-cycle and half-cycle poses, not only at rest or at an endpoint.
- If the asset has more than one movable joint, controls must cover every movable joint; use fallback dials only for a single-joint mechanism.
- For primary mechanisms, include pose-specific authored checks with `check.pose` so validation can inspect the open, extended, rotated, or retained state. For linked mechanisms, pose checks should prove the fitted interfaces at that sampled pose: rod endpoints, guided movers in guides, and routed paths seated on their supports.
- For repeated linked mechanisms, reuse one named driven pose across the repeated checks for that mechanism, such as the same quarter-cycle crank pose for all rod endpoints and piston guide fits. Do not create scattered unrelated pose names for each repeated part.
- Do not duplicate baseline QC as checks. Use authored checks for exact prompt-critical relationships only.
- For relation checks between mechanical parts with multiple visuals, reference the exact visual ids that carry the fit. Broad part-level checks are weak evidence and may not satisfy mechanical relation coverage.
- For intentional seated/captured fits, prefer exact visual-pair `expect_contact.maxPenetration`, `expect_path_contacts.maxPenetration`, `expect_gap.maxPenetration`, or `expect_within.maxPenetration` so validation can recognize the bounded fit directly. Use `expect_within.maxPenetration` for guided inner parts such as sliders in rails, pistons in liners, plungers in sleeves, and shafts in bearings. If you author an `allow_overlap` for a different intentional exception, include a matching exact proof check for the same part pair and exact visual pair when visuals are named.
- Avoid using `part_exists` and `joint_exists` as filler checks. They are useful only for prompt-critical presence; they do not prove mechanical fit, physical contact, clearance, routed path seating, or coupled motion.
- Use `maxPenetration: 0` only for actual surface touch. Captured bearings, collars, liners, sleeves, rails, slots, and seated wrapped paths should use a small positive bound that matches the intended fitted overlap.
