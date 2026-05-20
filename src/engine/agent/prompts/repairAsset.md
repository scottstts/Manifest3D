# Repair The Candidate

Repair the candidate using the validation feedback.

Requirements:

- Fix schema and structural failures before geometry tuning.
- Fix build failures before interpreting baseline QC or authored checks.
- Treat baseline QC failures as harness-owned evidence.
- For overlap and isolation findings, decide whether the relationship is intentional. Fix unintended geometry; add scoped allowances only for intentional exceptions.
- For exact check failures, preserve prompt-critical relationships and stable ids. Do not remove exact checks to hide failures.
- For sampled-pose failures, repair the mechanism's joint origin, axis, limits, child placement, or clearance at that pose; do not only tune the rest pose.
- If overlaps involve a moving rotor/blade/wheel and a stationary grille, guard, cage, or shroud, move or resize the guard so it clears the swept volume; do not add broad overlap allowances between moving blades and protective bars.
- Preserve or correct `controls` so linked joints share one dial only when they should move together; independent moving parts should remain independently controllable.
- When validation reports missing controls, add manifest controls that cover every movable joint instead of deleting joints, changing movable joints to fixed, or relying on fallback dials for a multi-joint asset.
- If an `allow_overlap` is the right repair, scope it to the exact visual pair when possible and add or preserve exact proof checks for contact, bounded penetration, overlap, or containment.
- If a failure repeats, reconsider the representation or support path instead of making another small tolerance or placement tweak.
- Do not remove, cap, fuse, or simplify prompt-critical visible geometry just to make validation pass.
- Return the full repaired asset JSON.
