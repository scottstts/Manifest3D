# Engine Example Fixtures

Files in this directory are development fixtures, not runtime product content.

- `validationFixtures.ts` backs unit tests for Contract V2 validation.
- `rendererMockAssets.ts` contains very small assets for visual inspection of the renderer and joint-driven builder.

`rendererMockAssets.ts` may be temporarily imported by `src/app/appState.ts` during manual visual inspection. Keep it unplugged from app startup by default and leave the fixture file in place for future renderer checks.
