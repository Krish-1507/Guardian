---
description: "Autonomous engineering quality loop — scans, shows findings, fixes on confirmation, loops until clean"
---

# Guardian — Autonomous Engineering Quality Loop

You are running the `guardian-cli` quality loop against this repository. Follow these
steps **exactly**, in order. Do not improvise around them.

The loop has exactly **one** mandatory pause: after the first scan (Step 2), before the
first fix. After that, you act autonomously until a hard stop condition.

---

## Step 1 — Scan and show the box

Run the scan:

`!npx guardian-cli scan`

Print the **entire boxed output verbatim** as your complete response. Do not summarize
it, do not add commentary, do not explain it — let the box speak for itself. Nothing else
in your response except the box.

---

## Step 2 — Confirmation (mandatory pause, never skipped)

Immediately after the box, append exactly this line (fill in N and M):

```
Found [N] root-cause clusters covering [M] issues. Reply with anything (or just hit enter) to start the autonomous fix loop, or 'skip <cluster>' to exclude one.
```

- **N** = number of root-cause clusters shown in the box.
- **M** = total issues spanned by those clusters = N + the total symptom count (i.e.
  root causes + symptoms), or simply count every finding listed under every cluster.

Even if the scan found only **1** issue, you MUST print this line and stop. This
confirmation step is non-negotiable.

Then **end your turn and wait** for the user's next message. Do not read files, do not plan
fixes, do not touch anything yet.

- If the user's message starts with `stop` / `cancel` / `abort` → do not start the loop;
  go straight to Step 6.
- If the user's message matches `skip <cluster>` → exclude that cluster from consideration,
  then proceed to Step 3 on the remaining clusters (no new confirmation needed).
- Any other input (including an empty reply) → confirmation granted, proceed to Step 3.

---

## Step 3 — Autonomous fix loop (runs after confirmation)

For each iteration, do all of (a)–(j) without asking for confirmation again:

**a. Pick the cluster.** Choose the highest-value remaining cluster (most severe, or most
central). Skip any the user excluded.

**b. Branch.** If you are not already on a `guardian/*` branch, create and switch to:

`guardian/<short-slug>-<date>`

where `<short-slug>` is a 2–4 word kebab slug of the cluster (e.g. `circular-core-deps`)
and `<date>` is `YYYY-MM-DD`. Never branch off or commit to `main`.

**c. State your hypothesis.** In one or two sentences, say *why* you believe this cluster's
root cause is what the scanner claims it is, and what a minimal correct fix looks like.

**d. Make the smallest fix.** Using your own file-edit tools, change the minimum needed to
address the **root cause** (not just a symptom). Stay on the `guardian/*` branch.

**e. Verify.**

`!npx guardian-cli verify`

Read the result, especially the Regression Risk and the Δ columns.

**f. If Regression Risk is High:** `git checkout` (or otherwise revert) your change, note
that this hypothesis failed, and try **once more** with a different approach for the **same**
cluster. Maximum 2 attempts per cluster, then move on.

**g. If Risk is Low/Medium and tests are not newly failing:** commit with a clear message
describing the root cause and fix, then record it:

`!npx guardian-cli memory add "..." --type fix`

(keep the summary short and factual — this is the "six months later" recall.)

**h. Re-scan and show a shorter status.** Run the scan again — this is the "check again"
loop — and print a **short updated boxed status** in the same visual style as Step 1,
showing: issues fixed so far, issues remaining. No long commentary.

**i. Success check.** If the fresh scan shows **zero remaining actionable clusters**,
stop — this is the success condition. Your final line should be:

`nothing left to fix, nothing broken.`

**j. Otherwise repeat.** Go back to (a) automatically. You do **not** ask for confirmation
again. The loop pauses only once, at Step 2, before the very first fix.

---

## Step 4 — Hard stop conditions

Whichever comes first:

- **(a)** a fresh scan shows zero actionable clusters (success), or
- **(b)** 10 total fix iterations, or
- **(c)** 45 minutes of wall-clock time.

If you stop because of **(b)** or **(c)** rather than **(a)**, say so plainly. Do not imply
everything is done when it is not. Report how many clusters remain.

---

## Step 5 — Non-negotiable safety rules

- Never force-push. Ever.
- Never touch `.env`, `.git/`, or any secret/credential file.
- Never delete a file unless the dependency graph confirms it has zero incoming references.
- Never silently modify CI/deploy config — if a fix would require it, flag it to the user
  instead and skip that change.
- Always stay on the `guardian/*` branch. Leave `main` (and any protected branch) untouched.
- If a fix feels risky, prefer the smaller safer change; the loop can retry.

---

## Step 6 — Final report

On **any** stop condition (success, max iterations, or timeout), run:

`!npx guardian-cli report`

and present the resulting **`GUARDIAN_REPORT.md` / boxed output verbatim** as your final
message. Do not rewrite or summarize it.
