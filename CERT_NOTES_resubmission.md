# Codex Now vs Then — Cert Notes (resubmission wave, Phase 01)

**Version:** 1.1.0.22 (visual.version) · production GUID unchanged (`codexNowVsThen…`) · API 5.11.0 / pbiviz 7.0.2 (pinned).

One-wave AppSource resubmission carrying the transparency/formatting rework **and** the v2 appearance redesign. Partner Center re-evaluates the whole package (Pitfall 6).

## Transparency wave (Plans 04–06)
- New **Background** card: `ColorPicker` fill + 0–100 `transparency` slider via `hexToRGBString`. Additive.
- fx conditional formatting wired on eligible colour properties.

## Title + per-region text wave (Plans 11–13)
- Title + per-region text treatment reworked with adaptive text colour.

## v2 Appearance wave (Plan 17)
- Dumbbell redesign: hollow-ring (then) + beveled glow-dot (now); connector uses direction colour at 55% opacity; the then-ring is **never** direction-tinted (muted/unit-token stroke over card-surface fill) so the band/direction-tinted now-dot always dominates the pair.
- **New optional data roles:** per-row Target Range Low / High (+62 lines `capabilities.json`) rendering a translucent violet target band — additive-only, nothing renders unless bound.
- Custom axis min/max + gridlines; ≤400 ms row-entry choreography.
- **D-16:** saved colour/fx overrides still resolve.

## High-contrast rule
Shared HC rule wired (`src/shared/highContrast.ts`).

## CERT-01 regression guard
Empty-space right-click context menu confirmed intact after all three waves (Task 1, Neil-verified).

## Pending fixes riding this wave
No code gap (source matches last NAS-shipped baseline). 2026-06-11 memory listed Now vs Then as "not yet submitted" — **confirm current Partner Center status** rather than assume a clean baseline.
