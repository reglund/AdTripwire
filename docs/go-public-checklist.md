# Going public: checklist

Written 2026-11-06 by Claude Fable 5.1 (main session) after scanning the working tree and the
full git history. The decision to make the repository public is the maintainer's; this page
says what was found and what to do first.

## What the scan found (2026-11-06)

| Check                                               | Result                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home paths, user name, machine hostname in the tree | none (the only "aware" hits are the words "context-aware")                                                                                                          |
| E-mail addresses or employer names in the tree      | none                                                                                                                                                                |
| LAN addresses in the tree                           | two development addresses in `docs/evaluations/assist-eval.md` and a comment in `scripts/assist-eval.ts`; replaced with documentation addresses (`192.0.2.x`) today |
| Secrets, key files, `.env`, tokens tracked by git   | none; `.claude/` is not tracked                                                                                                                                     |
| Git history (all commits, patch text)               | no home paths, no LAN addresses; the author e-mail on every commit is the maintainer's work address                                                                 |
| Evaluation reports under `docs/evaluations/`        | counts, rule ids, hostnames of public sites and documented infrastructure; no personal browsing                                                                     |
| Indicator data                                      | public (Zero Breach list, CC0), vendored under `packages/indicators/upstream/`                                                                                      |

## Before clicking "public"

1. **Author e-mail.** Every commit carries the maintainer's work e-mail. That is normal for
   open source, but if a private address is preferred, rewriting history is the only way to
   change past commits (and it invalidates clones and the release tag). Recommended: leave
   history as is and set GitHub "Keep my email addresses private" for future commits.
2. **README** must describe the project as it is now (not "Phase 1"); refreshed 2026-11-06.
3. **Links** in `docs/verify-yourself.md`, the Settings card and `docs/rig-setup.md` point to
   this repository and only work once it is public.
4. **Issues.** Templates exist (`.github/ISSUE_TEMPLATE/`: bug report, indicator proposal, rule
   proposal) and the bug template asks for the sanitised export. Enable Issues on the repository.
5. **Security contact.** `SECURITY.md` exists (private reporting via GitHub Security Advisories,
   7-day acknowledgement). Enable private vulnerability reporting in the repository settings.
6. **Branch protection** on `main` (no force-push; CI required), since publishing scripts and
   a daily service depend on it.
7. **Release tag v0.2.0** stays; the GitHub release with the SBOM and SHA256SUMS becomes
   visible with the repository.
8. **Observatory deploy key** is scoped to the dataset repository, not this one; nothing to
   change.

## After

- Point the observatory page's repository link at the public repository (it already does).
- Announce with the explainer written for security contacts, and ask one of them for the
  one-hour read described in `docs/verify-yourself.md`, check 7.
