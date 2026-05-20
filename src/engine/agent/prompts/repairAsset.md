# Repair The Candidate

Repair the candidate using the validation feedback.

Requirements:

- Fix schema and structural failures before geometry tuning.
- Fix build failures before interpreting baseline QC or authored checks.
- If validation reports `rounded_box_radius_too_large`, reduce that radius below half of the shortest size component or adjust the size; do not remove useful softened geometry just to pass.
- Treat baseline QC failures as harness-owned evidence.
- For overlap and isolation findings, decide whether the relationship is intentional. Fix unintended geometry; add scoped allowances only for intentional exceptions.
- For exact check failures, preserve prompt-critical relationships and stable ids. Do not remove exact checks to hide failures.
- For sampled-pose failures, repair the mechanism's joint origin, axis, limits, child placement, or clearance at that pose; do not only tune the rest pose.
- If overlaps involve a moving rotor/blade/wheel and a stationary grille, guard, cage, or shroud, move or resize the guard so it clears the swept volume; do not add broad overlap allowances between moving blades and protective bars.
- Preserve or correct `controls` so linked joints share one dial only when they should move together; independent moving parts should remain independently controllable.
- When validation reports missing controls, add manifest controls that cover every movable joint instead of deleting joints, changing movable joints to fixed, or relying on fallback dials for a multi-joint asset.
- For material emission animation failures, repair the material `emissionAnimation` keyframe timing, on/off state, color, or intensity. Do not replace flashing material emission with separate glTF or scene light objects.
- If an `allow_overlap` is the right repair, scope it to the exact visual pair when possible and add or preserve exact proof checks for contact, bounded penetration, overlap, or containment.
- If validation reports `allowance_overlap_missing_proof_check`, add or correct a matching exact proof check for the same part pair and same visual pair; do not delete intentional-fit evidence unless the geometry no longer overlaps.
- If a failure repeats, reconsider the representation or support path instead of making another small tolerance or placement tweak.
- Do not remove, cap, fuse, or simplify prompt-critical visible geometry just to make validation pass.
- Return the full repaired asset JSON.
