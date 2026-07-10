"use strict";

// ─── Shared Design Tokens (v3) ───────────────────────────────
// Typography scale, spacing, radii, theme-dual surface/text tokens, and
// the fx-recomputable ramp FORMULAS from DESIGN-LANGUAGE.md §1-2. Ramps
// take colour arguments (surface/accent/theme) and recompute from them —
// no hard-coded stop lists — so a report author's fx colour override
// still resolves through the formula rather than being discarded (D-16).
//
// Sibling of bandEngine.ts; both are additive-only v3 modules (D-11),
// frozen for the batch once the Plan 15 pbiKpiCard pilot proves them.

import { accentToken, bandColor, targetToken } from "./bandEngine";
import type { Theme } from "./bandEngine";

// ─── Typography scale (§1) ───────────────────────────────────
export interface TypeRole {
    size: string;
    weight: number;
    tracking: string;
}

export const TYPE_SCALE: Record<string, TypeRole> = {
    hero: { size: "40-56px", weight: 700, tracking: "-0.01em" },
    secondary: { size: "22-30px", weight: 700, tracking: "-0.01em" },
    row: { size: "14-16px", weight: 700, tracking: "0" },
    title: { size: "13.5px", weight: 600, tracking: "0.02em" },
    label: { size: "12.5px", weight: 600, tracking: "0.03em" },
    eyebrow: { size: "10.5-11px", weight: 700, tracking: "0.10-0.16em" },
    micro: { size: "10-11px", weight: 600, tracking: "0.06em" },
};

export const FONT_STACK = '"Segoe UI", -apple-system, "Helvetica Neue", Arial, sans-serif';

/** CSS `font-feature-settings` value for tabular numerals — apply everywhere numbers align. */
export const TABULAR_NUMS = '"tnum"';

// ─── Spacing / radii (§3) ─────────────────────────────────────
export const SPACING = {
    base: 4,
    cardPaddingMin: 18,
    cardPaddingMax: 26,
    rowGapMin: 15,
    rowGapMax: 18,
};

export const RADII = {
    card: 10,
    input: 10,
    pill: 999,
    terminalMin: 0,
    terminalMax: 2,
};

// ─── Theme-dual surface/text tokens (§2) ─────────────────────
export interface SurfaceTokens {
    canvas: string;
    card: string;
    border: string;
    text: string;
    muted: string;
    track: string;
}

const SURFACE_TOKENS: Record<Theme, SurfaceTokens> = {
    dark: {
        canvas: "#07071a",
        card: "#0d0d24",
        border: "rgba(124,58,237,.24)",
        text: "#e8e6ff",
        muted: "#8f8ab8",
        track: "#1c1c3a",
    },
    light: {
        canvas: "#e9edf6",
        card: "#ffffff",
        border: "rgba(124,58,237,.16)",
        text: "#14141f",
        muted: "#5b5b74",
        track: "#e2e4ef",
    },
};

export function surfaceTokens(theme: Theme = "dark"): SurfaceTokens {
    return SURFACE_TOKENS[theme];
}

// ─── mix(a, b, t): channel-linear hex blend ──────────────────
function parseHex(hex: string): [number, number, number] {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(r: number, g: number, b: number): string {
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    return `#${c(r)}${c(g)}${c(b)}`;
}

/** mix(a, b, t): channel-linear blend of two hex colours, t clamped 0..1. */
export function mix(a: string, b: string, t: number): string {
    const clamped = Math.max(0, Math.min(1, t));
    const [ar, ag, ab] = parseHex(a);
    const [br, bg, bb] = parseHex(b);
    return toHex(ar + (br - ar) * clamped, ag + (bg - ag) * clamped, ab + (bb - ab) * clamped);
}

// ─── heatmapRamp (§2, heatmap single-hue) ────────────────────
export interface HeatmapCell {
    cell: string;
    inkFlip: boolean;
}

/**
 * heatmapRamp(v, lo, hi, surface, accent, theme): cell = mix(surface,
 * accent, 0.08 + t*0.92), t = (v-lo)/(hi-lo) clamped 0..1. inkFlip is
 * true past t>0.55 on a dark canvas / t>0.45 on light — the point at
 * which the cell reads dark enough that text needs the light ink (or
 * vice versa on light theme). Recomputes from whatever `surface`/
 * `accent` are passed — an fx colour override just changes the inputs,
 * no stop list to update.
 */
export function heatmapRamp(
    v: number,
    lo: number,
    hi: number,
    surface: string,
    accent: string,
    theme: Theme = "dark"
): HeatmapCell {
    const span = hi - lo;
    const t = span !== 0 ? Math.max(0, Math.min(1, (v - lo) / span)) : 0;
    const cell = mix(surface, accent, 0.08 + t * 0.92);
    const inkFlip = theme === "dark" ? t > 0.55 : t > 0.45;
    return { cell, inkFlip };
}

// ─── spectrumRamp (§2, equaliser by-category) ────────────────
/**
 * spectrumRamp(index, count, theme): the brand ramp cyan -> violet ->
 * magenta across a category index (0-based), for by-category visuals
 * (equaliser). count<=1 reads as the first stop (cyan).
 */
export function spectrumRamp(index: number, count: number, theme: Theme = "dark"): string {
    const t = count > 1 ? Math.max(0, Math.min(1, index / (count - 1))) : 0;
    const cyan = accentToken(theme);
    const violet = targetToken(theme);
    const magenta = bandColor("danger", theme);
    return t <= 0.5 ? mix(cyan, violet, t * 2) : mix(violet, magenta, (t - 0.5) * 2);
}

// ─── ragScale (§2, the only sanctioned non-single-hue ramp) ──
/**
 * ragScale(t, theme): three band colours as a continuous good->bad
 * ramp, t clamped 0..1 (0 = success, 0.5 = warning, 1 = danger).
 */
export function ragScale(t: number, theme: Theme = "dark"): string {
    const clamped = Math.max(0, Math.min(1, t));
    const good = bandColor("success", theme);
    const warn = bandColor("warning", theme);
    const bad = bandColor("danger", theme);
    return clamped <= 0.5 ? mix(good, warn, clamped * 2) : mix(warn, bad, (clamped - 0.5) * 2);
}

// ─── accentBarGradient (§2, 3D accent-bar gradient) ──────────
/**
 * accentBarGradient(bandHex): the 180deg 3-stop gradient string used by
 * the flat/flush accent-bar variant — recomputes from whatever band
 * colour is passed in (band()/directionColor() output, or an fx
 * override), never a fixed stop list.
 */
export function accentBarGradient(bandHex: string): string {
    const light = mix(bandHex, "#ffffff", 0.55);
    const dark = mix(bandHex, "#000000", 0.7);
    return `linear-gradient(180deg, ${light}, ${bandHex} 45%, ${dark})`;
}
