# Builder / Evaluator loop

An **optional, self-contained** toolkit that iteratively improves the poker
trainer's UX/UI. It is completely separate from the app — the app never imports
or runs any of this, and the app works exactly the same whether or not the loop
exists.

## What it does

Each iteration:

1. **Screenshot** the key UI states (start screen, a flop decision with the odds
   explainer, a labeled showdown) via headless Chrome.
2. **Builder** (an LLM, Anthropic by default) looks at the screenshots + source
   and proposes **one** small UX/UI improvement as constrained find/replace edits.
3. **Apply** the edits to a throwaway copy of the app (`loop/.work/`).
4. **Gate** — the change must keep the **test suite green** *and* the app must
   **still render** in headless Chrome. If either fails → **auto-revert**.
5. **Screenshot** the same states again ("after").
6. **Evaluator** (a vision LLM) compares before/after and scores the change,
   returning `keep` or `revert`.
7. **Keep or revert.** Kept changes accumulate as the new baseline.

After all iterations, kept changes are copied back into the app and committed to
a **fresh branch** (e.g. `loop/ux-run-<timestamp>`) — never pushed. A markdown
report with per-iteration verdicts and before/after screenshots is written to
`loop/runs/<timestamp>/report.md`.

## Safety

- The builder may only edit `app.js`, `index.html`, `style.css`.
- Edits are exact, unique substring replacements — no whole-file rewrites.
- Every kept change passed `npm test` (65 engine + 10 brain + smoke) **and** a
  render check.
- Nothing touches your real working tree until the end, and nothing is pushed.

## Run it

Requires Node, the app's `node_modules` installed (`npm install`), and Chrome.

```bash
# Dry run — no API key needed. Exercises the server, screenshots and test gate
# for one iteration so you can confirm the harness works.
node loop/run.js --dry-run

# Full run (default 10 iterations).
export ANTHROPIC_API_KEY=sk-ant-...
node loop/run.js

# Fewer iterations / different model / port:
LOOP_ITERATIONS=3 LOOP_MODEL=claude-sonnet-4-5 LOOP_PORT=8011 node loop/run.js
```

Environment variables:

| var | default | meaning |
|-----|---------|---------|
| `ANTHROPIC_API_KEY` | — | required for a live run |
| `LOOP_ITERATIONS` | `10` | number of build/evaluate cycles |
| `LOOP_MODEL` | `claude-sonnet-4-5` | model for builder + evaluator (must support vision) |
| `LOOP_PORT` | `8011` | port for the temporary static server |
| `CHROME_PATH` | macOS Chrome path | headless Chrome binary |

## Output

- `loop/runs/<ts>/report.md` — summary + verdicts
- `loop/runs/<ts>/iter-NN/before_*.png` / `after_*.png` — visual diffs
- `loop/runs/<ts>/log.json` — machine-readable log
- branch `loop/ux-run-<ts>` — the kept changes for you to review/merge

## Reviewing a run

```bash
open loop/runs/<ts>/report.md
git diff main...loop/ux-run-<ts>      # see exactly what was kept
```

Merge what you like; delete the branch if you don't.
