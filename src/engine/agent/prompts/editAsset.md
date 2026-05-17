# Edit The Selected Asset

Revise the selected Manifest3D asset according to the user prompt.

Requirements:

- Preserve existing stable ids unless the requested edit truly changes the contract.
- If a referenced id changes, update every dependent check and allowance in the same JSON.
- Keep unrelated parts, materials, joints, and checks intact.
- Keep the original object's physical support paths, mechanism intent, and prompt-critical visible geometry unless the edit explicitly changes them.
- Preserve or add pose-specific checks for any edited mechanism so sampled-pose validation covers the new open, extended, rotated, or retained state.
- Do not make a shape less realistic just to avoid a validation finding; repair the underlying support, placement, joint, or scoped allowance instead.
- Return the full revised asset JSON, not a patch.
