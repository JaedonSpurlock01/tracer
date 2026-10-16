## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. TDD and Verification

**Behavior changes require test-first development and self-verification.**

### Red-Green-Refactor

For every behavior change or bug fix:

1. Name the observable behavior and the public interface that exposes it.
2. Write one focused test and run it to confirm it fails for the expected reason.
3. Write only enough production code to make that test pass.
4. Run the focused test again and confirm it passes.
5. Refactor only while green, rerunning the focused test after each refactor.
6. Repeat with the next behavior as a new vertical slice.

Do not write a batch of tests followed by a batch of implementation. Do not write production behavior before its failing test. A bug fix must begin with a regression test that reproduces the bug.

Documentation, copy, and pure visual-token changes do not require a new behavioral test. They still require every applicable formatting, lint, type, or build check for the files and configuration they affect.

### Test Quality

- Test observable behavior through public interfaces.
- Use the canonical language in `CONTEXT.md` in test names and fixtures.
- Prefer integration-style domain tests over tests of private methods or internal call order.
- Mock only external provider boundaries. Do not mock internal domain collaborators merely to isolate classes or functions.
- Use contract fixtures for Twilio, OpenAI, Trigger.dev, Cloudflare, and other provider payloads.
- Keep Trigger.dev registration thin so task behavior can be tested as ordinary functions.
- Do not use snapshots as the primary assertion for domain behavior.
- Never delete, skip, weaken, or rewrite a valid test merely to make a change pass. Change a test only when the agreed behavior changes, and state why.
- Every invariant documented in `CONTEXT.md` must map to executable coverage in the domain behavior matrix in `README.md`.

### Layered Verification

Use the narrowest useful check during development and broaden checks before handoff.

**Inner loop:**

- Run only the focused test file or affected domain suite during each red-green-refactor cycle.
- Do not run a production build after every edit.

**Before completing an implementation task:**

- Run all tests affected by the change.
- Run integration or contract tests when persistence, provider payloads, Worker bindings, or task behavior changed.
- Run incremental TypeScript typechecking.
- Run lint on changed files or the narrowest supported lint target.

**Full verification boundary:**

- Run the complete test suite, full lint, typecheck, and production build before merge.
- Also run full verification after build configuration, dependency, schema, migration, runtime binding, or cross-cutting architecture changes.
- Live provider smoke tests are separately tagged, require credentials, and do not run in the normal agent loop or required pull-request checks.

### Required Handoff

Every coding-task handoff must list:

- Tests added or changed, or why no behavioral test was required
- The red failure observed before implementation, when TDD applied
- Verification commands run and their results
- Typecheck, lint, and build status
- Any check not run, with the reason

Never claim completion while a required check is failing. Do not hide pre-existing failures; distinguish them from failures introduced by the change.

## 6. Roadmap and Changelog

**The implementation roadmap is the authoritative sequence for project work.**

- Before coding, identify the active milestone in `docs/IMPLEMENTATION_ROADMAP.md`.
- At most one milestone may be `In Progress`.
- Do not start a later milestone while the current milestone is incomplete unless the Product Owner explicitly defers the current milestone.
- If requested work is not represented by the roadmap, stop and add or change a milestone before implementing it.
- When starting a milestone, update its status, the roadmap Current state, and `docs/CHANGELOG.md` in the same change.
- When a milestone becomes blocked, record the blocker, dependency, and required resolution immediately.
- Mark a milestone Complete only after every exit criterion and required verification gate passes.
- Multiple agents may work only on disjoint tasks inside the same active milestone.

Update `docs/CHANGELOG.md` when:

- A milestone starts, completes, becomes Blocked, or is Deferred.
- Roadmap scope, order, dependencies, risks, gates, or exit criteria change.
- A substantive product, domain, design, architecture, security, testing, or environment decision changes.
- Scope is added or removed.
- An environment promotion, Production deployment, or rollback occurs.

Do not add Changelog entries for routine implementation, refactors without behavior changes, typo fixes, or formatting changes.

Every implementation handoff must state whether the roadmap and Changelog were updated. If no update was required, state why.

## 7. Miscellaneous

1. You must not use the em dash character in any of your changes. Instead, use the hyphen (-). This is a strict requirement and cannot be omitted.

2. Don't add comments in the code unless they are strictly necessary when describing unclear semantics or logic paths. The code itself should be descriptive.

3. Do not ever add emojis in your changes, particularly when writing code comments

4. Never perform write-level git commands such as `git push` or `git commit` without approval from the user. Read-only commands such as `git diff` are acceptable.

5. Always double check to make sure that the documentation is updated with your new changes. Particularly in changes regarding to the architecture of the app.

6. Make sure to not create any new linting errors in your changes for both frontend/backend.

7. Add code file headers that describe what the file does in simple terms. Below is a template you will use:

```
/**
 * -------------------------------------------------------------------------
 * @file   <file_name>.<file_extension>
 * @brief  <brief_description>
 *
 * @description
 *  Describe in detail but with simple terms what the file does.
 *
 * @remarks
 *  Describe why certain decisions were chosen
 *
 * @see
 *  Link to external resources, other files, docs, etc.
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
