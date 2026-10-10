---
description: Adopt a dependency update fully across the repository
---

A dependency bump is not a version string change. Every release exists for a
reason — a fix, a new capability, a better ergonomic, a faster path — and the
value of the bump is only realised once the repository uses the package the way
its current version intends. Treat the version change as the starting point of
the work, not the work itself.

## Establish the update

Identify the package and both versions from the branch. The lockfile diff and
the pull request title both carry this; prefer the lockfile, as it reflects what
actually resolved.

## Read what actually changed

Do not infer the contents of a release from its version number, its changelog,
or prior knowledge of the package. Read the diff:

```
npm diff --diff=<package>@<from> --diff=<package>@<to>
```

Start with `--diff-name-only` to see the shape of the release, then read the
files that matter in full. Scope to a path when a package is large:

```
npm diff --diff=<package>@<from> --diff=<package>@<to> --diff-name-only
npm diff --diff=<package>@<from> --diff=<package>@<to> src/
```

Pay attention to what the summary flags — changed entry points, new or removed
exports, dependency movement, install scripts. A deprecation is as informative
as an addition: it names the construct the release wants replaced.

## Understand the intent

From the diff, determine what the release is for. A bug fix implies code written
to work around that bug is now dead weight. A new export implies hand-rolled
equivalents elsewhere are now redundant. A relaxed type or widened signature
implies casts placed to satisfy the old one can go. A performance change implies
a call pattern the package now prefers.

Name the intent explicitly before touching anything. Every edit that follows
should trace back to it.

## Adopt it everywhere

Search the whole repository for every place the affected construct appears — not
only the files the pull request touched, which is usually just the lockfile.
Bring each one to the form the current version intends.

Scope is not a reason to stop. If honouring the release means a wide refactor,
do the wide refactor. A partial adoption leaves the repository in two idioms at
once, which is worse than either.

Use the solution the package documents and intends. Never reach for a workaround
where a supported API exists, and never leave a shim in place once the thing it
compensated for is fixed.

## Verify

Run the checks and report their real output:

```
npm run check
npm run test
```

Extend tests to cover behaviour that changed. If a test only passed because of a
bug that this release fixes, correct the test rather than preserving it.

## Report

Open with the package and the version delta as the heading, then a verdict and
the intent, then the three sections. Every section renders even when it has
nothing in it — write `None.` rather than dropping the heading, so a silent
omission is never mistaken for a clean result.

```markdown
## `<package>` <from> → <to>

**Verdict.** One line: whether this is ready to merge, or what blocks it.

**Intent.** One or two sentences on what the release is for. Reasoning, not a
transcript of the diff.

### Changelog

What changed and why, grouped by the domain it touches rather than by file. One
or two lines per group.

### Upstream opportunities

Every place the package's API forced something awkward: a limitation worked
around, an ergonomic gap, a type that could be tighter, a capability that would
have made the integration cleaner. Describe each concretely enough to open an
issue from.

### Open questions

Anything non-trivial where the right direction is genuinely unclear, or where
the change would reach further than the evidence supports. Ask rather than
guess. Leave that work undone, state plainly what is blocked and why, and
complete everything that does not depend on the answer.
```

## Status

Finish by recording the outcome on the pull request. Apply exactly one status,
clearing the others so the labels never contradict each other.

Use `Dependencies | Adopted` when the adoption is complete and nothing is waiting
on an answer, or `Dependencies | Blocked` when the open questions have to be
resolved before the work can finish.

```
gh pr edit <number> \
  --remove-label "Dependencies | Queued" \
  --remove-label "Dependencies | Dispatched" \
  --remove-label "Dependencies | Blocked" \
  --add-label "Dependencies | Adopted"
```

Status reflects this work only. Continuous integration reports on the code
separately, so do not wait on checks or fold their result into the label.
