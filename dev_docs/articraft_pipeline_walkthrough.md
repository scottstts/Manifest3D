# Articraft core engine and agent harness

## Executive summary

In the paper and in the repo, the main artifact being authored is a **Python program** in `model.py`. That program uses the Articraft SDK to build an `ArticulatedObject`, define its parts, geometry, joints, and tests; the harness then executes that program, compiles it into URDF plus meshes, runs baseline QC plus authored tests, converts the results into structured signals, and sends those signals back to the model for the next edit. In other words, the LLM is operating as a constrained code author inside a very narrow authoring sandbox, not as a one-shot schema emitter. 

The cleanest mental split is: **the core engine** is the SDK + compiler + QC/test/signalization stack, while **the agent harness** is the restricted workspace, prompt packaging, tool mediation, mutation tracking, compile freshness logic, repair guidance, and termination logic wrapped around that engine. The paper describes this at a high level, and the repo makes the implementation much more concrete, especially around compile caching, checkpoint persistence, AST-based guidance injection, and tool-argument validation. 

A compact way to see the core path is:

```text
user prompt + optional image
    -> system prompt + docs/workspace packet + task message
    -> LLM edits model.py through a tiny tool set
    -> compiler executes model.py
    -> baseline QC + run_tests()
    -> structured compile_signals / probe measurements
    -> iterative repair loop
    -> fresh successful compile
    -> final URDF + meshes + record metadata
```

That mapping is explicit in the paper’s Figure 2 / Appendix C and in the repo’s `single_run`, `harness`, `harness_compile`, `compiler`, and feedback code. 

## What the model is actually authoring

At the authoring layer, Articraft gives the model a domain-specific programmatic interface rather than asking it to hand-write URDF or arbitrary project code. The paper’s example shows a `build_object_model() -> ArticulatedObject` function that creates materials, defines named parts, and attaches geometry such as cylinders to those parts with explicit local transforms. The same interface also stores articulated joints between named parts, including joint type, origin, axis, and motion limits. That means the authored program is not just making shape; it is constructing a kinematic object graph whose motion semantics stay coupled to the part geometry. 

That coupling matters for articulated assets. A prismatic drawer is not just “a box that looks like a drawer”; it is a moving child part whose slide axis, limits, rails, and clearances must be mutually consistent. Likewise, a revolute door or lamp arm is not just a rotated mesh; it is a jointed mechanism with a hinge origin and axis that should sit where the real hinge would live. The paper explicitly frames the compiled output as a URDF containing meshes, semantic parts, joints, joint axes, and motion ranges, so the deliverable is both geometric and kinematic. 

The authored script also has a required self-validation entrypoint. The paper states that `model.py` includes `run_tests()`, and the compiler code enforces that requirement: if `run_tests()` is missing or does not return the SDK’s `TestReport`, compilation fails. So authored code has two required logical responsibilities: construct the object, and express object-specific test contracts that the generic baseline QC cannot know. 

This is why “payload schema” in Articraft really means two narrower things, not a geometry JSON. First, there is a **tool-calling schema** between the LLM and the harness. Second, there is a **program contract** for `model.py` and `run_tests()`. The geometry itself lives in executable SDK code, not in an intermediate declarative blob. 

## Pipeline walkthrough from input to output

The outer execution path starts in the single-run orchestrator. `execute_single_run(...)` builds a run context, resolves model/provider settings, writes the prompt text into a staging path, then instantiates `ArticraftAgent` with the bound script path, trace directory, checkpoint URDF path, provider settings, cost limits, and runtime limits. The actual agent run is then invoked as `result = await agent.run(user_content)`.

Inside the agent, the first practical step is to guarantee that the editable artifact exists. The harness has `_ensure_code_file()`, which checks whether `model.py` exists and is non-empty; if not, it writes a minimal scaffold loaded from the SDK profile’s canonical scaffold path. So the run does not begin from arbitrary repository state. It begins from a standardized object-script template.

The agent then builds the **virtual workspace** and **SDK docs context**. In code, `ArticraftAgent.__init__` constructs `self.virtual_workspace = build_virtual_workspace(...)` and `self.sdk_docs_context = load_sdk_docs_reference(...)`. In the paper’s Appendix C, that becomes the first user message: a compact packet telling the model that `model.py` is the only editable file, that `docs/` is read-only SDK guidance, and that a quickstart, probe reference, and testing reference are preloaded. The second user message contains runtime guidance, the actual object prompt, and optionally the reference image. 

From there, the runtime enters a constrained tool loop. The paper’s restricted action space contains `read_file`, edit tools (`apply_patch` or `replace`/`write_file` depending on provider), `find_examples`, `compile_model`, and `probe_model`. The system prompt explicitly tells the model to use tool calls rather than returning code in natural language, to read exact file text before patching, and to treat compile/QC/tests as sensors. It also tells the model that `probe_model` is inspection-only and `find_examples` is for reusable patterns rather than mechanical copying. 

Tool execution in the repo is mediated rather than direct. The harness parses tool arguments, rejects malformed JSON or non-object argument payloads, special-cases `compile_model`, and otherwise builds validated invocations from the tool registry. When the invocation exists, the harness binds the current `file_path` and `virtual_workspace` onto it before execution. This is the concrete “payload schema” layer: the harness is validating tool-call structure, not geometry structure. 

After any successful mutating edit tool, the harness increments an internal edit revision counter. That matters because compilation is tracked against revisions. If the code has not changed since the last successful compile, `compile_model` is not re-run; instead the cached fresh compile result is returned as authoritative. If the code *has* changed since the last successful compile, the harness can inject a reminder telling the model that it must run `compile_model` before concluding. 

When `compile_model` is called, the harness intercepts it rather than letting a generic tool implementation handle it. The explicit tool schema says `compile_model` takes no parameters and is intercepted by the harness so it can maintain compile freshness state and persist checkpoints. The harness rejects unexpected compile parameters, then dispatches into `_execute_compile_model`. 

A successful agent run returns an `AgentResult` that can already include `final_code`, `urdf_xml`, warnings, and counts. The outer single-run wrapper still has a safeguard: if the agent result lacks `urdf_xml`, it recompiles the final script one more time before persisting the success record. So the end-to-end output path is not “trust the final assistant message”; it is “trust the latest successful compile of the bound script.”

## The core engine

The engine begins when the compiler executes the generated script. `compile_urdf_report(...)` enters an asset session tied to the script and then calls `_compile_urdf_report_impl(...)`. That implementation first loads the script’s globals, then—when running full checks—runs the required authored tests via `run_tests()`, runs compiler-owned baseline tests, merges those reports, raises on failed tests, extracts URDF XML, and returns a `CompileReport` containing `urdf_xml`, warnings, and a typed `CompileSignalBundle`.

The **baseline QC** is more concrete in the repo than in the paper. The paper mentions runtime errors, disconnected parts, and overlaps as default checks. The repo’s `compile_model` tool description and compiler metadata make that more specific: model validity, exactly one root part, mesh assets ready, floating disconnected part groups, disconnected geometry islands inside a part, and current-pose real 3D overlaps are part of the automatic baseline stack. In plain 3D terms, the engine is checking things like “is this one coherent articulated object,” “do the mesh files actually exist,” “did some chunk of geometry end up floating off by itself,” “did one logical part secretly become multiple disconnected shells,” and “are solids physically interpenetrating at the rest pose.” 

The engine also supports **object-specific authored tests** that generic QC cannot infer. The paper describes `TestContext(object_model)` plus helpers for contact, gap, overlap, containment, and pose-dependent relations. That is how the authored program can express category-specific truths like “the drawer remains seated in the rails” or “the lid clears the base across its motion arc.” This is an important design choice: the generic baseline stack handles broad physical sanity; `run_tests()` handles semantic mechanism correctness.

A particularly important geometric sanity check in the repo is visual connectivity around joints. `_validate_mesh_connectivity(...)` computes distance findings between articulation origins and exact visual geometry and raises if the joint origin is far from where the visible parts actually touch. In practical terms, this is checking whether the hinge or slider anchor is sitting near the place where a human would expect the mechanism to be mounted, not floating in space or hidden far away inside mismatched geometry.

The compiler’s feedback is deliberately normalized into a **typed signal model**. `CompileSignal` carries severity, kind, code, summary, details, blocking flag, source, group, check name, and a dedupe key; signals are grouped into a `CompileSignalBundle` with overall status and summary. The feedback module defines explicit specs for many cases, including compile-runtime failures, model validity failures, single-root failures, mesh-asset failures, isolated parts, real overlap, missing exact geometry, visual connectivity warnings, geometry scale warnings, and path-hygiene warnings. This is the engine’s “sensor bus”: instead of dumping raw logs back to the LLM, it produces a structured diagnosis vocabulary. 

The engine is also hardened against pathological scripts. `compile_urdf_report_maybe_timeout(...)` runs compilation in a separate process with a hard timeout controlled by `URDF_COMPILE_TIMEOUT_SECONDS`, defaulting to 300 seconds. That guards against infinite loops, very expensive mesh operations, or extremely slow overlap checking. On timeout or other failures, the harness still tries to convert the exception into compile signals, and if a partial `compiled_urdf_xml` exists, it can preserve that as a checkpoint for debugging and recovery. 

## The agent harness

The harness’s first defining feature is **restriction**. The model does not get shell, repository navigation, multi-file refactors, or arbitrary execution. It gets one writable file, read-only SDK references and curated examples, plus a tiny action space aligned to object authoring. That restriction is not cosmetic. It is what turns a generic coding model into a specialized articulated-asset author: unnecessary degrees of freedom are removed, and all available actions are semantically relevant to building and repairing the asset.

The second defining feature is **tool mediation with provider-specific editing adapters**. The paper says OpenAI runs use `apply_patch`, while Gemini, Anthropic, and OpenRouter use `replace` and `write_file`; all variants expose `read_file`, `find_examples`, `compile_model`, and `probe_model`. In the repo, the harness builds a provider client, constructs a tool registry, validates tool arguments, and then executes through provider-normalized message codecs. So the harness makes the underlying provider choice matter mostly at the edit-transport layer, not at the asset semantics layer.

The third defining feature is **revision-aware compile control**. `CompileFeedbackLoop` tracks the current edit revision, the last successful compile revision, the last successful report, compile attempt count, last failure signature, and consecutive failure streak. A successful mutating tool increments revision. A fresh successful compile is reusable without recompilation. Repeated failures are detected by a signature over the compile-signal bundle and rendered with a failure streak. This is exactly the kind of control logic that keeps the loop cheap and sharply repair-oriented instead of wasting turns on redundant compiles. 

The fourth defining feature is **guided repair, not just passive validation**. After successful mutations, `GuidanceInjector` parses the current code with an AST scan. It detects missing “exact geometry contracts” when `ctx.expect_*` references visual element names that no longer exist, and it injects a user-side guidance message telling the model to restore or update those names in the same edit. It also detects when `run_tests()` has reintroduced compiler-owned baseline checks and injects a reminder to leave baseline sanity/QC to `compile_model`, reserving `run_tests()` for prompt-specific checks, targeted pose checks, and explicit allowances. That is a subtle but important design move: the harness is teaching the model how to maintain the intended division of labor between baseline QC and authored semantics. 

The harness also repairs **tool-use mistakes**, not just geometry mistakes. For example, if provider variants using `replace` fail because `old_string` does not match the current file exactly, `maybe_inject_edit_code_guidance(...)` adds a message instructing the model to re-read `model.py`, use a smaller exact snippet, and retry surgically. So part of the harness’s job is preserving robustness of the edit protocol itself.

Finally, the harness includes **history management** for long runs. The paper says older intermediate history can be compacted under hard context pressure or soft repair-plateau conditions, while preserving the immutable run prefix and recent raw tail. That is not the core semantic loop, but it is part of how the harness scales the same loop to long repair sessions without changing the object-authoring abstraction. 

## Failure handling and the exact iteration semantics

The most useful way to think about Articraft’s iteration logic is: **edit, sense, inspect, repair, recompile, then only conclude on a fresh compile**. The system prompt’s runtime guidance tells the model to make one small coherent change at a time, run `compile_model` after the latest revision, and conclude only when compile is clean and no specific remaining defect can be named. The repo reinforces that with compile freshness tracking and a compile-required reminder if code changed after the last successful compile.

Failure feedback is not monolithic. The paper explicitly says the harness returns `failure`, `warning`, and `note` signals rather than raw logs, and the repo’s signal classes and specs make that concrete. Failures are blocking repair targets. Warnings are non-fatal concerns such as geometry scale or visual-connectivity issues. Notes capture context and allowances, such as intentional overlaps. That matters because articulated assets often require *allowed* contacts or penetrations—an axle stub intentionally captured in a wheel bore is different from accidental body-panel interpenetration. The typed signal system gives the model a way to reason about that distinction instead of treating all geometry collisions as equal. 

`probe_model` sits in the loop as the “measurement tool” for cases where compile feedback is insufficiently specific. The paper says it executes a read-only Python snippet over the current `object_model` and returns JSON measurements; it is intended for distances, overlap-related inspection, containment, pose checks, and similar geometry questions. In the toolbox trace, probe snippets inspect AABBs, part summaries, helper availability, and a lightweight catalog to choose the right next repair. That is a key distinction from image-based agents: Articraft’s repair loop is driven mostly by structured geometric introspection and QC signals, not by rendering an image every turn.

One subtle implementation detail from the repo is that the harness can persist a **checkpoint URDF even on some failures** when the compiler managed to materialize a partial `compiled_urdf_xml`. That means failure handling is not “all or nothing.” The system tries to preserve the last meaningful compiled state, which is useful both for debugging and for keeping a repair loop anchored to the most recent executable artifact.

The repo also shows a final success packaging path that is stricter than ordinary chat completion. `_build_code_valid_result(...)` packages success from the `last_successful_report`, including `final_code`, `urdf_xml`, warnings, and run statistics. Although the fetched snippet does not include the full body of `_handle_finish_attempt(...)`, the surrounding helpers make the intended contract clear: **a natural-language “done” is not enough; the code must correspond to a fresh valid compile**. That is an inference from the visible success builder plus the compile-required reminder and fresh-compile reuse logic, and it matches the runtime guidance in the paper.

## The clearest way to read Articraft’s design

If you want the shortest technically faithful description of the system, it is this:

Articraft is a **code-authoring agent for articulated assets**. The LLM does not directly emit URDF or a high-level geometry schema. It iteratively edits a single SDK script, `model.py`, in a tightly controlled workspace. The compiler executes that script into an `ArticulatedObject`, runs generic QC plus authored `run_tests()`, transforms all findings into structured signals, and feeds them back into the harness; `probe_model` adds targeted geometric measurement when the signals are not specific enough. The harness manages the conversation, validates tool arguments, tracks code revisions and compile freshness, injects repair guidance, and only accepts a result when the latest code has a fresh successful compile. 

So the deepest truth about the pipeline is that **validation is not a post-processing layer attached to generation; validation is the environment that generation happens inside**. The asset emerges from repeated contact between SDK code, compiler/QC sensors, object-specific tests, and targeted probes. That is why the system can produce mechanically meaningful assets rather than meshes that merely look plausible.