"use strict";

// ─── Shared Visual Title Card ───────────────────────────────
// Suite-wide canonical Title object (D-14): a custom in-iframe title
// (Policy 1180.2.5 — the PBI auto-title strip is host chrome and absorbs
// right-clicks), consumed by every visual via relative import (D-10).
//
// Extracted verbatim from pbiKpiCard's proven inline exemplar
// (src/settings.ts) during the Plan 10 pilot.
//
// FROZEN once the Plan 10 pilot confirms pbiKpiCard packages clean (D-11).
// Do not fork or duplicate this card per-visual — fix here, once, for all.

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;

import { alignSlice } from "./textFormatting";

const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

// Default OFF (showTitle = false) so existing reports render unchanged
// when upgraded (D-06/D-14 render-nothing default).
export class TitleSettings extends FormattingSettingsCard {
    name = "titleSettings";
    displayName = "Visual Title";

    showTitle = new formattingSettings.ToggleSwitch({ name: "showTitle", displayName: "Show Title", value: false });
    titleText = new formattingSettings.TextInput({ name: "titleText", displayName: "Title Text", placeholder: "Visual title", value: "" });

    titleFontFamily = new formattingSettings.FontPicker({ name: "titleFontFamily", displayName: "Font Family", value: "Segoe UI, sans-serif" });
    titleFontSize = new formattingSettings.NumUpDown({ name: "titleFontSize", displayName: "Font Size", value: 14 });
    titleBold = new formattingSettings.ToggleSwitch({ name: "titleBold", displayName: "Bold", value: true });
    titleItalic = new formattingSettings.ToggleSwitch({ name: "titleItalic", displayName: "Italic", value: false });
    titleUnderline = new formattingSettings.ToggleSwitch({ name: "titleUnderline", displayName: "Underline", value: false });

    titleFont = new formattingSettings.FontControl({
        name: "titleFont", displayName: "Font",
        fontFamily: this.titleFontFamily, fontSize: this.titleFontSize,
        bold: this.titleBold, italic: this.titleItalic, underline: this.titleUnderline,
    });

    titleAlign = alignSlice("titleAlign", "left");

    titleColor = new formattingSettings.ColorPicker({
        name: "titleColor", displayName: "Font Color",
        value: { value: "#1a1a2e" }, instanceKind: ConstantOrRule,
    });

    slices: FormattingSettingsSlice[] = [
        this.showTitle, this.titleText, this.titleFont, this.titleAlign, this.titleColor
    ];
}
