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

- This project is WebGPU with TSL only, no WebGL
- always run test, typecheck, lint, and build after code changes, but Don't run dev server
- code file structure should be modular, well designed, optimized for ease of maintainability (generally speak try not to exceed 2000 loc per file). If you see a file about to exceed 2000 loc, **Don't** keep piling it on, bring it up to me for a potential local refactor to split code out more modularly before the new implementation
- if there are ambiguities or issues during implementation that you can't solve or you need to clarify, stop the job and ask me and report issues so i can help you (like fundamental tradeoffs of the approach, unclear design choices, installing packages, look for assets, etc.). DO NOT fall back to any inferior choices without asking me first!
- When asked for plan or proposal for implementation, always plan for the ultimate state, do NOT plan or propose anything like "V1 fix for now and V2 for later", there is no later, there's only now
- non-visual parts of the project, especially like agent harness, asset validation, etc, must create corresponding unit tests along with code implementation to ensure logic is correct, and any bug fixes require corresponding regression tests
- pay attention to relevant md docs in dev_docs/ dir, these can include intentions and design principles derived or surfaced during implementation beyond the code itself that are important for further implementing related features. Make sure you always update relevant docs in dev_docs/ after new implementation to avoid stale and outdated references
- Do Not run browser to verify visuals, unless explcitly told so
- When asked to write implementation documentations, do NOT include verbose and irrelevant things like broad project rules, what text was used, etc. The point of documentation for a specific session of implementation is to capture only design choices that were discussed or surfaced during coding beyond what code alone can tell that could potentially impact future implementations, not to repeat what the code or AGENTS.md already says 
- the dev docs will mention a "V2", but there isn't literal versioning in code or in docs, just treat it as the de facto current plan in effect--the only version

# Notes

`dev_docs/notes.md` is a scratch pad that you will write to concisely about things you've notes and learned during the implementation, including but not limited to design choices. Whenever you feel like there's something that other coding agents after you will benefit from in later implementation, write to it

This serves as the agent continuous memory so even when i start a new coding agent, you will also benefit from the notes the agents before you have noted.

You can write to it and read it as well. Over time, this notes.md will contain all the accumulated lessons about this project, dos and don'ts, preferred and not preferred

Try MOSTLY to append to it. only delete or edit existing notes when they explicitly contradict with new approved design choices