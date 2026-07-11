"use strict";

// ─── Shared Border formatting card (v3 addition, 2026-07-11) ─────────
// The visual's own premium border — replaces the native host border
// (which CodexTheme turns off): colour + transparency + width + corner
// radius, painted on the visual's outer render root. Radius clips
// content when the root has overflow:hidden, giving true rounded cards.
//
// Pair with the capabilities object:
//   "visualBorder": { properties: show(bool), color(fill),
//                     transparency(numeric), width(numeric), radius(numeric) }
// ("visualBorder", not "border", to stay clear of the host's native
// border object name.)

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { toRgba } from "./colorHelpers";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;

export class BorderSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show",
        value: false
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "Color",
        value: { value: "#8f8ab8" }
    });

    transparency = new formattingSettings.Slider({
        name: "transparency",
        displayName: "Transparency",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 }
        }
    });

    width = new formattingSettings.NumUpDown({
        name: "width",
        displayName: "Width (px)",
        value: 1
    });

    radius = new formattingSettings.NumUpDown({
        name: "radius",
        displayName: "Corner Radius (px)",
        description: "Rounds the visual's corners (content clips to the curve)",
        value: 10
    });

    name: string = "visualBorder";
    displayName: string = "Border";
    topLevelSlice = this.show;
    slices: Array<FormattingSettingsSlice> = [
        this.color,
        this.transparency,
        this.width,
        this.radius
    ];
}

/** Paint (or clear) the border on the visual's outer render root.
 *  Under high contrast the system foreground wins. */
export function applyBorder(
    el: HTMLElement,
    border: BorderSettings | undefined,
    opts: { hcActive?: boolean; hcColor?: string } = {}
): void {
    if (!border || !border.show.value) {
        el.style.border = "";
        el.style.borderRadius = "";
        return;
    }
    const width = Math.max(1, Math.min(8, border.width.value));
    const radius = Math.max(0, Math.min(24, border.radius.value));
    const colorCss = opts.hcActive
        ? (opts.hcColor ?? border.color.value.value)
        : toRgba(border.color.value.value, border.transparency.value ?? 0);
    el.style.border = `${width}px solid ${colorCss}`;
    el.style.borderRadius = radius > 0 ? `${radius}px` : "";
}
