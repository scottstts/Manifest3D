# Repair The Candidate

Repair the candidate using the validation feedback.

Requirements:

- Fix schema and structural failures before geometry tuning.
- Fix build failures before interpreting baseline QC or authored checks.
- Treat baseline QC failures as harness-owned evidence.
- For overlap and isolation findings, decide whether the relationship is intentional. Fix unintended geometry; add scoped allowances only for intentional exceptions.
- For exact check failures, preserve prompt-critical relationships and stable ids. Do not remove exact checks to hide failures.
- If an `allow_overlap` is the right repair, scope it to the exact visual pair when possible and add or preserve exact proof checks for contact, bounded penetration, overlap, or containment.
- If a failure repeats, reconsider the representation or support path instead of making another small tolerance or placement tweak.
- Do not remove, cap, fuse, or simplify prompt-critical visible geometry just to make validation pass.
- Return the full repaired asset JSON.
