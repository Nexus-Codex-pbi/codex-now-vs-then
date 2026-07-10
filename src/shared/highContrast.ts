"use strict";

// ─── Shared High-Contrast Rule (v3) ──────────────────────────
// DESIGN-LANGUAGE §8: ONE fallback rule, not a per-visual reinvention.
// When the host reports high contrast: map colour to a system slot
// (foreground/background/hyperlink), drop all glow, thicken borders to
// 2px, and — for hue-dependent visuals (heatmap) — swap colour for
// density hatching; every band/direction reading is also paired with a
// status glyph so nothing is colour-only.
//
// `_shared/formatting/` v3 is additive-only (D-11); this module is
// proven by the Plan 15 pbiKpiCard pilot then frozen for the batch.

import type { Band } from "./bandEngine";

export type Direction = "up" | "down";

export interface HighContrastPalette {
    isHighContrast?: boolean;
    foreground?: { value?: string };
    background?: { value?: string };
    hyperlink?: { value?: string };
}

export interface HighContrastOptions {
    fallbackColor?: string;
    fallbackBackground?: string;
    defaultBorderWidth?: number;
}

export interface HighContrastResolved {
    /** false when the host is not in high-contrast mode — callers pass through unchanged. */
    active: boolean;
    color: string;
    background: string;
    hyperlink: string;
    borderWidth: number;
    /** always "none" when active; the CSS glow value to use */
    glow: string;
}

/**
 * applyHighContrast(palette, opts): resolves the ONE HC fallback. When
 * `palette.isHighContrast` is falsy this is a no-op pass-through
 * (`active: false`) so callers can unconditionally route colour
 * resolution through this function instead of branching per-visual.
 */
export function applyHighContrast(
    palette: HighContrastPalette | null | undefined,
    opts: HighContrastOptions = {}
): HighContrastResolved {
    const active = !!palette?.isHighContrast;
    const defaultBorderWidth = opts.defaultBorderWidth ?? 1;

    if (!active) {
        return {
            active: false,
            color: opts.fallbackColor ?? "",
            background: opts.fallbackBackground ?? "",
            hyperlink: "",
            borderWidth: defaultBorderWidth,
            glow: "",
        };
    }

    return {
        active: true,
        color: palette?.foreground?.value || opts.fallbackColor || "#ffffff",
        background: palette?.background?.value || opts.fallbackBackground || "#000000",
        hyperlink: palette?.hyperlink?.value || palette?.foreground?.value || opts.fallbackColor || "#ffffff",
        borderWidth: 2,
        glow: "none",
    };
}

/**
 * densityHatching(value, opts): dot-pitch-proportional hatching hook for
 * hue-dependent visuals (heatmap) under HC — replaces colour intensity
 * with pattern spacing so intensity still reads without relying on hue.
 * `value` is expected pre-normalised 0..1 (a ramp position).
 */
export function densityHatching(
    value: number,
    opts: { minPitch?: number; maxPitch?: number } = {}
): { pitch: number; patternId: string } {
    const minPitch = opts.minPitch ?? 3;
    const maxPitch = opts.maxPitch ?? 14;
    const clamped = Math.max(0, Math.min(1, value));
    // Higher value -> denser dots -> smaller pitch.
    const pitch = maxPitch - clamped * (maxPitch - minPitch);
    return { pitch, patternId: `codex-hatch-${Math.round(pitch * 100)}` };
}

/**
 * statusGlyph(kind): the glyph that must always accompany colour so
 * nothing reads by colour alone — checkmark/exclamation/cross for a
 * band, up/down triangle for a direction.
 */
export function statusGlyph(kind: Band | Direction): string {
    switch (kind) {
        case "success":
            return "✓"; // check mark
        case "warning":
            return "!"; // exclamation
        case "danger":
            return "✕"; // multiplication x (cross)
        case "up":
            return "▲"; // up-pointing triangle
        case "down":
            return "▼"; // down-pointing triangle
        default:
            return "";
    }
}
