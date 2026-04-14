/**
 * Shared utilities for OptiStock PBI Custom Visuals
 * RAA Brand tokens + formatting helpers
 */

export const RAA_TOKENS = {
    primary:    "#130064",
    accent:     "#ffe600",
    black:      "#000000",
    white:      "#ffffff",
    warmGrey:   "#e8e2d3",
    success:    "#007064",
    successBg:  "#e0f5ef",
    warning:    "#d4920a",
    warningBg:  "#fef3d6",
    danger:     "#e60e22",
    dangerBg:   "#fde8ea",
    info:       "#73afd5",
    infoBg:     "#e3f0fa",
    neutral:    "#5e5d5a",
    neutralBg:  "#f0eee6",
    fontFamily: "Segoe UI, Tahoma, Geneva, Verdana, sans-serif"
};

/** Clamp a number between min and max */
export function clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
}

/** Safely convert to number, returning null for NaN/undefined/null */
export function safeNumber(v: any): number | null {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
}

/** Format a number with display units (auto/none/thousands/millions/billions) */
export function formatValue(value: number, units: string = "auto", decimals: number = 1): string {
    if (value === null || value === undefined || isNaN(value)) return "—";

    const abs = Math.abs(value);
    let divisor = 1;
    let suffix = "";

    if (units === "auto") {
        if (abs >= 1e9) { divisor = 1e9; suffix = "B"; }
        else if (abs >= 1e6) { divisor = 1e6; suffix = "M"; }
        else if (abs >= 1e3) { divisor = 1e3; suffix = "K"; }
    } else if (units === "thousands") { divisor = 1e3; suffix = "K"; }
    else if (units === "millions") { divisor = 1e6; suffix = "M"; }
    else if (units === "billions") { divisor = 1e9; suffix = "B"; }

    const scaled = value / divisor;
    return scaled.toFixed(decimals) + suffix;
}

/** Interpolate a colour between two hex colours at position t (0-1) */
export function interpolateColor(color1: string, color2: string, t: number): string {
    const c1 = hexToRgb(color1);
    const c2 = hexToRgb(color2);
    if (!c1 || !c2) return color1;

    const r = Math.round(c1.r + (c2.r - c1.r) * t);
    const g = Math.round(c1.g + (c2.g - c1.g) * t);
    const b = Math.round(c1.b + (c2.b - c1.b) * t);
    return rgbToHex(r, g, b);
}

/** Three-stop colour interpolation: low -> mid -> high based on normalised position */
export function interpolateThreeColor(lowColor: string, midColor: string, highColor: string, t: number): string {
    t = clamp(t, 0, 1);
    if (t <= 0.5) {
        return interpolateColor(lowColor, midColor, t * 2);
    }
    return interpolateColor(midColor, highColor, (t - 0.5) * 2);
}

/** Determine zone colour from thresholds */
export function zoneColor(
    percentage: number,
    zones: { max: number; color: string }[]
): string {
    for (const zone of zones) {
        if (percentage <= zone.max) return zone.color;
    }
    return zones[zones.length - 1]?.color || RAA_TOKENS.neutral;
}

/** Choose readable text colour (dark or light) based on background luminance */
export function contrastText(bgHex: string): string {
    const rgb = hexToRgb(bgHex);
    if (!rgb) return RAA_TOKENS.black;
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.55 ? RAA_TOKENS.black : RAA_TOKENS.white;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function rgbToHex(r: number, g: number, b: number): string {
    return "#" + [r, g, b].map(c => clamp(c, 0, 255).toString(16).padStart(2, "0")).join("");
}
