"use strict";

// ─── Shared Colour Helper ───────────────────────────────────
// Single call site for hexToRGBString suite-wide (D-04). No visual may
// call hexToRGBString directly — always go through toRgba() so the
// transparency-direction fix (if needed) only has to happen once, here.

import { hexToRGBString } from "powerbi-visuals-utils-colorutils";

/**
 * Convert a hex colour + a PBI-native transparency percentage (0-100,
 * 0 = fully opaque, 100 = fully transparent) into an rgba() string.
 *
 * VERIFIED 2026-07-09 (Plan 03 Task 1 spike, ran the exact published
 * `hexToRGBString` source in isolation): the raw function does NOT do any
 * 0-100-percentage normalisation itself — its second argument is passed
 * straight through as the CSS rgba() ALPHA CHANNEL (0-1 float), e.g.
 * `hexToRGBString('#000000', 0)` -> `rgba(0,0,0,0)` (transparent) and
 * `hexToRGBString('#000000', 1)` -> `rgba(0,0,0,1)` (opaque). Passing a raw
 * 0-100 percentage (the original ASSUMPTION) is a SEVERE bug, not just a
 * direction flip: any value >1 is silently CSS-clamped to alpha=1 (opaque),
 * so a naive pass-through would render every transparency slider value from
 * 2-100 as fully opaque and only 0/1 would show any effect.
 *
 * This wrapper is the fix + the single suite-wide normalisation point
 * (D-04): it converts the PBI slider's 0-100 "Transparency %" convention
 * into the 0-1 alpha `hexToRGBString` actually expects, inverting direction
 * (slider 0 = opaque = alpha 1; slider 100 = transparent = alpha 0) so every
 * visual's Background card behaves like the native Format pane.
 * `_shared/formatting/` is FROZEN to this implementation per D-11.
 */
export function toRgba(hex: string, transparencyPct: number): string {
    const clampedPct = Math.max(0, Math.min(100, transparencyPct ?? 0));
    const alpha = (100 - clampedPct) / 100;
    return hexToRGBString(hex, alpha);
}

// ─── Composited surface + ink tone (NEXUS review 2026-09-11, class 1) ───────
// 9 of 15 visuals chose adaptive ink from the RAW fill hex while painting that
// fill with transparency — the ink was judged against a colour nobody sees.
// The visible surface is the fill composited over whatever sits behind it.
// Use compositeOver() first, then surfaceTone() on the RESULT. Threshold and
// weights match the per-visual choosers already in the suite (Rec.601, 0.55)
// so behaviour only changes where the surface was actually translucent.
import { mix } from "./designTokens";

/** The colour a viewer sees: `fillHex` at PBI transparency `transparencyPct`
 *  (0 = opaque, 100 = invisible) painted over `behindHex`. */
export function compositeOver(fillHex: string, transparencyPct: number, behindHex: string): string {
    const alpha = (100 - Math.max(0, Math.min(100, transparencyPct ?? 0))) / 100;
    return mix(behindHex, fillHex, alpha);
}

/** "light" when ink on this surface should be dark, "dark" when it should be light. */
export function surfaceTone(hex: string): "light" | "dark" {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex ?? "");
    if (!m) return "dark";
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? "light" : "dark";
}

// ─── WCAG contrast-maximising ink (Heatmap Matrix probe, 2026-09-11) ─────────
// surfaceTone()'s Rec.601 bucket reads saturated cyan rgb(1,191,227) as 0.542
// → "dark" and puts WHITE on it (1.8:1); WCAG relative luminance says black
// (9.1:1). Over 184 real heatmap cells, tone-bucketing left 11 cells under
// 3:1; picking the higher-contrast candidate left 0. Use contrastInk() where
// the surface can be any saturated colour (ramps, data-driven fills);
// surfaceTone() remains for neutral card/background surfaces.
function relLuminance(hex: string): number {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex ?? "");
    if (!m) return 0;
    const lin = (c: string) => {
        const v = parseInt(c, 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(m[1]) + 0.7152 * lin(m[2]) + 0.0722 * lin(m[3]);
}

/** WCAG 2.x contrast ratio between two hex colours (1..21). */
export function contrastRatio(aHex: string, bHex: string): number {
    const a = relLuminance(aHex), b = relLuminance(bHex);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Of `darkInk` and `lightInk`, the one with the higher WCAG contrast on
 *  `surfaceHex` (pass the COMPOSITED surface — see compositeOver). */
export function contrastInk(surfaceHex: string, darkInk: string, lightInk: string): string {
    return contrastRatio(surfaceHex, darkInk) >= contrastRatio(surfaceHex, lightInk) ? darkInk : lightInk;
}

/** A de-emphasised ink derived FROM the chosen ink by mixing toward the surface,
 *  backed off until it still clears `minRatio` (WCAG) against that surface. The
 *  fixed muted tokens (#8f8ab8 / #5b5b74) sit near mid-grey by design and read
 *  at 1.2–3.0:1 on mid-grey tiles (Icon Gauge, NEXUS re-review 2026-09-11);
 *  a muted ink must be relative to the surface it sits on, not a constant. */
// Floor is 6:1, not 4.5:1: the status/secondary line is 12px, and at 4.5 the
// derived ink on plain white read visibly weaker than the fixed token it
// replaced (6.6:1 → 4.8:1, Neil 2026-09-11 "fix icon gauge"). Where the
// surface cannot reach 6:1 at all (mid-grey), the headline ink is returned.
export function mutedInk(inkHex: string, surfaceHex: string, minRatio = 6, mixAmount = 0.45): string {
    for (let t = mixAmount; t >= 0; t -= 0.05) {
        const candidate = mix(inkHex, surfaceHex, t);
        if (contrastRatio(candidate, surfaceHex) >= minRatio) return candidate;
    }
    return inkHex;
}
