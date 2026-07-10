"use strict";

// ─── Shared Band Engine (v3) ─────────────────────────────────
// The v2-look appearance engine's core mechanic (D-16, DESIGN-LANGUAGE
// §2): ONE colour token drives every status element on a visual — accent
// bar, status dot, delta pill, bar fill, needle tint. band() judges a
// value against a target; directionColor() is the DISTINCT "direction
// law" used by waterfall / now-vs-then / time-breakdown deltas (lime =
// increase or saved, magenta = decrease or added) — never conflate the
// two. The violet target token is NEVER returned by either function; it
// marks a target/goal marker only.
//
// Mirrors colorHelpers.ts's single-call-site discipline: every batch
// visual reads status colour through band()/bandColor()/directionColor(),
// never by hard-coding the hex values below a second time.
// `_shared/formatting/` v3 is additive-only (D-11) — this file, once
// proven by the Plan 15 pbiKpiCard pilot, is frozen for the batch.

export type Band = "success" | "warning" | "danger";
export type Theme = "dark" | "light";

const BAND_TOKENS: Record<Band, Record<Theme, string>> = {
    success: { dark: "#8aff2b", light: "#1f8a3b" },
    warning: { dark: "#ffb020", light: "#a85f00" },
    danger: { dark: "#ff3b52", light: "#c81d6b" },
};

const ACCENT_TOKEN: Record<Theme, string> = { dark: "#00d9ff", light: "#0384a3" };
const TARGET_TOKEN: Record<Theme, string> = { dark: "#b9a7ff", light: "#6d28d9" };

/**
 * band(value, target): the value-vs-target status law.
 * ratio = value / target
 * ratio >= 1    -> "success"  (at/over target)
 * ratio >= 0.9  -> "warning"  (within 90%)
 * else          -> "danger"   (below)
 *
 * A non-finite or non-positive target has no meaningful ratio — reads
 * neutral-good ("success") rather than dividing by zero, matching a
 * met/absent target.
 */
export function band(value: number, target: number): Band {
    if (!Number.isFinite(target) || target <= 0) return "success";
    if (!Number.isFinite(value)) return "danger";
    const ratio = value / target;
    if (ratio >= 1) return "success";
    if (ratio >= 0.9) return "warning";
    return "danger";
}

/** bandColor(band, theme): the single hex token for a band, per theme. */
export function bandColor(b: Band, theme: Theme = "dark"): string {
    return BAND_TOKENS[b][theme];
}

/**
 * directionColor(delta, theme): the DIRECTION LAW — distinct from
 * band(), which judges a value against a target. delta >= 0 -> the lime
 * "increase/saved" token; delta < 0 -> the magenta "decrease/added"
 * token. Never returns the violet target token.
 */
export function directionColor(delta: number, theme: Theme = "dark"): string {
    return delta >= 0 ? BAND_TOKENS.success[theme] : BAND_TOKENS.danger[theme];
}

/** accentToken(theme): the brand cyan — selection, anchors, chrome. */
export function accentToken(theme: Theme = "dark"): string {
    return ACCENT_TOKEN[theme];
}

/** targetToken(theme): the violet target/goal marker — never a band colour. */
export function targetToken(theme: Theme = "dark"): string {
    return TARGET_TOKEN[theme];
}
