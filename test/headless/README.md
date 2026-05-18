# Headless Agent Pipeline Smoke

Run the real create pipeline without the browser UI:

```sh
npm run test:headless
```

The smoke route uses the OpenAI key from `OPENAI_API_KEY`, `VITE_OPENAI_API_KEY`,
or the project `.env` file. It runs the real prompt compiler, OpenAI manifest
client, agent repair loop, validation harness, scene commit, and in-memory asset
library save.

Artifacts are written to `test/artifacts/headless-agent/<run-id>/` and are
ignored by git. Each run captures:

- compiled system and user prompts
- model response text and parsed candidate JSON
- validation reports and signals for every attempt
- agent events, final scene, saved in-memory library, and summary JSON

Useful overrides:

```sh
HEADLESS_AGENT_PROMPT='a hinged toolbox with opening lid' npm run test:headless
HEADLESS_AGENT_EXPECT_READY=0 npm run test:headless
HEADLESS_AGENT_MAX_REPAIR_TURNS=6 npm run test:headless
HEADLESS_AGENT_RUN_TIMEOUT_MS=900000 npm run test:headless
HEADLESS_AGENT_FETCH_TIMEOUT_MS=930000 npm run test:headless
HEADLESS_AGENT_ARTIFACT_DIR=/tmp/manifest3d-headless npm run test:headless
```

`HEADLESS_AGENT_RUN_TIMEOUT_MS` aborts the agent run through the same signal path
used by the UI. `HEADLESS_AGENT_TIMEOUT_MS` controls the outer Vitest timeout
and defaults to one minute longer than the agent-run timeout.
`HEADLESS_AGENT_FETCH_TIMEOUT_MS` controls the headless-only HTTPS request
timeout and defaults to 30 seconds longer than the agent-run timeout.
