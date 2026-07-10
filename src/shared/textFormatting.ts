"use strict";

// ─── Shared Text-Formatting Helpers ─────────────────────────
// Suite-wide alignment + FontControl machinery (D-13), consumed by every
// visual via relative import (D-10) alongside backgroundSettings/toRgba.
//
// Extracted verbatim from pbiKpiCard's proven inline exemplar
// (src/settings.ts) during the Plan 10 pilot.
//
// FROZEN once the Plan 10 pilot confirms pbiKpiCard packages clean (D-11).
// Do not fork or duplicate these helpers per-visual — fix here, once, for all.

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

// ─── Alignment helpers ───────────────────────────────────────
export function alignSlice(name: string, defaultValue: string = "left") {
    return new formattingSettings.AlignmentGroup({
        name,
        displayName: "Alignment",
        mode: powerbi.visuals.AlignmentGroupMode.Horizonal,
        value: defaultValue,
    });
}

export function alignSelfFor(v: string | undefined): string {
    return v === "center" ? "center" : v === "right" ? "flex-end" : "flex-start";
}

export function textAlignFor(v: string | undefined): string {
    return v === "center" || v === "right" ? v : "left";
}

// ─── FontControl composite helper ────────────────────────────
// Builds a FontControl plus its four child slices (family/size/bold/italic/
// underline) under a caller-supplied name prefix, so each batch visual can
// build a per-surface font composite (e.g. "valueFont", "labelFont") with
// distinct property names without copy-paste drift between visuals.
export interface FontControlDefaults {
    fontFamily?: string;
    fontSize?: number;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
}

export interface FontControlBundle {
    fontFamily: formattingSettings.FontPicker;
    fontSize: formattingSettings.NumUpDown;
    bold: formattingSettings.ToggleSwitch;
    italic: formattingSettings.ToggleSwitch;
    underline: formattingSettings.ToggleSwitch;
    control: formattingSettings.FontControl;
}

export function makeFontControl(namePrefix: string, defaults: FontControlDefaults = {}): FontControlBundle {
    const fontFamily = new formattingSettings.FontPicker({
        name: `${namePrefix}FontFamily`,
        displayName: "Font Family",
        value: defaults.fontFamily ?? "Segoe UI, sans-serif",
    });
    const fontSize = new formattingSettings.NumUpDown({
        name: `${namePrefix}FontSize`,
        displayName: "Font Size",
        value: defaults.fontSize ?? 12,
    });
    const bold = new formattingSettings.ToggleSwitch({
        name: `${namePrefix}Bold`,
        displayName: "Bold",
        value: defaults.bold ?? false,
    });
    const italic = new formattingSettings.ToggleSwitch({
        name: `${namePrefix}Italic`,
        displayName: "Italic",
        value: defaults.italic ?? false,
    });
    const underline = new formattingSettings.ToggleSwitch({
        name: `${namePrefix}Underline`,
        displayName: "Underline",
        value: defaults.underline ?? false,
    });

    const control = new formattingSettings.FontControl({
        name: `${namePrefix}Font`,
        displayName: "Font",
        fontFamily,
        fontSize,
        bold,
        italic,
        underline,
    });

    return { fontFamily, fontSize, bold, italic, underline, control };
}
