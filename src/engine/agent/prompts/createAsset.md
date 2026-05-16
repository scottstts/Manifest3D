# Create A New Asset

Create a complete Manifest3D asset that satisfies the user prompt and fits the current scene.

Requirements:

- The asset must be valid Contract V2 JSON.
- Use a single rooted joint tree.
- Give every visual a stable id that can be referenced by checks.
- Add authored checks for the prompt-critical relationships.
- Keep the initial candidate compact, physically plausible, and exportable as GLB.
- Model the object's real construction logic. Use visible walls, rims, lips, rails, bosses, shafts, brackets, panels, and controls instead of one generic placeholder mass.
- Use real-world dimensions and plausible materials.
- If the prompt describes a primary mechanism or visible control, represent it as a separate part with an appropriate joint and realistic limits.
- Do not duplicate baseline QC as checks. Use authored checks for exact prompt-critical relationships only.
