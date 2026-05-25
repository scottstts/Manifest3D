# Manifest3D Project

This is a vite React TS + three.js TSL WebGPU project.

# Rules

- DPR of the viewport if applicable should use below setting:

```typescript
const maxPixels = 4_000_000;

const dpr = Math.min(
  window.devicePixelRatio,
  1.75,
  Math.sqrt(maxPixels / (innerWidth * innerHeight))
);

renderer.setPixelRatio(Math.max(1, dpr));
```

- The default viewport renderer must remain WebGPU with TSL. The path tracer viewport render mode is the single approved WebGL2 exception, and its code should stay in a separate modular renderer pipeline rather than being mixed into the default WebGPU renderer.
- always run test, typecheck, lint, and build after code changes, but Don't run dev server
- code file structure should be modular, well designed, optimized for ease of maintainability (generally speak try not to exceed 2000 loc per file). If you see a file about to exceed 2000 loc, **Don't** keep piling it on, bring it up to me for a potential local refactor to split code out more modularly before the new implementation
- if there are ambiguities or issues during implementation that you can't solve or you need to clarify, stop the job and ask me and report issues so i can help you (like fundamental tradeoffs of the approach, unclear design choices, installing packages, look for assets, etc.). DO NOT fall back to any inferior choices without asking me first!
- When asked for plan or proposal for implementation, always plan for the ultimate state, do NOT plan or propose anything like "V1 fix for now and V2 for later", there is no later, there's only now
- non-visual parts of the project, especially like agent harness, asset validation, etc, must create corresponding unit tests along with code implementation to ensure logic is correct, and any bug fixes require corresponding regression tests
- pay attention to relevant md docs in dev_docs/ dir, these can include intentions and design principles derived or surfaced during implementation beyond the code itself that are important for further implementing related features. Make sure you always update relevant docs in dev_docs/ after new implementation to avoid stale and outdated references
- Do Not run browser to verify visuals, unless explcitly told so
- When asked to write implementation documentations, do NOT include verbose and irrelevant things like broad project rules, what text was used, etc. The point of documentation for a specific session of implementation is to capture only design choices that were discussed or surfaced during coding beyond what code alone can tell that could potentially impact future implementations, not to repeat what the code or AGENTS.md already says 
- the dev docs will mention a "V2", but there isn't literal versioning in code or in docs, just treat it as the de facto current plan in effect--the only version

# Headless Test

inside test/headless/ is a headless test. the entire point of headless run test is to artificially pool all the exact same pipelines from the app src/ code and run the exact same engine and harness but run headlessly. That means:

- what the headless test does is: pool existing pipelines in app src/, stitch them up as headless run, save intermediate run data for analysis
- inside headless test code (/test/headless/agentPipelineSmoke.test.ts), don't recreate parts of the app src code that already exists in src/ (should directly import them), because that would mean you're not testing app src code, you're testing the recreated version of it in headless test, which defeats the purpose of having this test to begin with (remember: headless run === in-app run - GUI)
- any wiring inconvenience created by pulling src/ pipelines into test code MUST be contained within the headless test code (test/headless/ ). code inside src/ is only to be modified for the benefit of improving app features, NOT for the benefit of making headless test run wiring easier

Headless run is set to use default timeout 1 hr. do not interrupt it while it is running, let it finish, unless explicitly told otherwise. This is because a run typically takes a while (at least 10 mins, sometimes 2x-3x longer)

Generally every headless run requires visually inspection of the output glb (unless explicitly told otherwise), as output asset visual is part of the pipeline evaluation factors (i.e., asset with bad visual means bad engine and harness no matter how smoothly they ran)

For visual inspection, use the helper glb viewer tool: test/headless/glb_viewer.html. to use this:

1. serve it: `zsh -ic 'cd test && python -m http.server 3000'`. This does NOT count as "dev server" mentioned above, so it does not contradict with the "no dev server" rule
2. open the asset inside the viewer in **Codex built-in browser** at http://localhost:3000/glb_viewer.html?src=headless/artifacts/headless-agent/headless-run-id/glb/asset-for-inspection.glb
3. view the asset
4. kill the python server and close the tab in the codex built-in browser after inspection

# Notes

`dev_docs/notes.md` is a scratch pad that you will write to concisely about things you've notes and learned during the implementation, including but not limited to design choices. Whenever you feel like there's something that other coding agents after you will benefit from in later implementation, write to it

This serves as the agent continuous memory so even when i start a new coding agent, you will also benefit from the notes the agents before you have noted.

You can write to it and read it as well. Over time, this notes.md will contain all the accumulated lessons about this project, dos and don'ts, preferred and not preferred

Try MOSTLY to append to it. only delete or edit existing notes when they explicitly contradict with new approved design choices