# Headless Agent Pipeline Smoke

Run the real create pipeline without the browser UI:

```sh
npm run test:headless
```

The smoke route uses the OpenAI key from `OPENAI_API_KEY`, `VITE_OPENAI_API_KEY`,
or the project `.env` file. It runs the real prompt compiler, OpenAI manifest
client, agent repair loop, validation harness, scene commit, and in-memory asset
library save.

Artifacts are written to `test/headless/artifacts/headless-agent/<run-id>/` by
default and are ignored by git. Each run captures:

- compiled system and user prompts
- model response text and parsed candidate JSON
- validation reports and signals for every attempt
- agent events, final scene, saved in-memory library, and summary JSON
- per-attempt static GLB exports whenever an attempt can be parsed and exported
- per-attempt dynamic GLB exports when the attempt has movable joints or material emission animation
- final static GLB export for ready runs
- final dynamic GLB export for ready runs with movable joints or material emission animation
- viewer URLs for `test/headless/glb_viewer.html`

Useful overrides:

```sh
HEADLESS_AGENT_PROMPT='a hinged toolbox with opening lid' npm run test:headless
HEADLESS_AGENT_PROMPT='a compact espresso machine based on the reference' HEADLESS_AGENT_IMAGE_PATHS=tmp/reference.png npm run test:headless
HEADLESS_AGENT_PROVIDER=gemini npm run test:headless
HEADLESS_AGENT_EXPECT_READY=0 npm run test:headless
HEADLESS_AGENT_MAX_REPAIR_TURNS=10 npm run test:headless
HEADLESS_AGENT_ARTIFACT_DIR=test/headless/artifacts/headless-agent npm run test:headless
```

`HEADLESS_AGENT_RUN_TIMEOUT_MS` aborts the agent run through the same signal path
used by the UI. `HEADLESS_AGENT_TIMEOUT_MS` controls the outer Vitest timeout
and defaults to one minute longer than the agent-run timeout.
`HEADLESS_AGENT_PROVIDER` selects the same provider factory used by the app and
defaults to OpenAI. Gemini reads `GEMINI_API_KEY`, `GOOGLE_API_KEY`, or legacy
Vite-prefixed variants from the environment or `.env`.
`HEADLESS_AGENT_IMAGE_PATH` or comma-separated `HEADLESS_AGENT_IMAGE_PATHS`
loads local PNG/JPEG/WEBP/GIF files as reference image attachments and copies
them into each run's `reference-images/` artifact folder.
The default agent-run timeout is one hour so stress runs can behave like real
pipeline runs; recent live runs completed in roughly 12-15 minutes but need
enough margin for slower repair turns.
The default repair cap is ten repair turns, matching the app runtime.

To inspect a GLB artifact, serve the headless directory and open the viewer URL
recorded in `summary.json`:

```sh
cd test/headless && python -m http.server 3000
```
