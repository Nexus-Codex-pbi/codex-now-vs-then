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
import { ColorHelper } from "powerbi-visuals-utils-colorutils";
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
        value: { value: "#8f8ab8" },
        instanceKind: powerbi.VisualEnumerationInstanceKinds.ConstantOrRule
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
 *  Under high contrast the system foreground wins. Pass `palette` +
 *  `metadataObjects` to honour an fx rule on the colour (the slice's
 *  selector is wired here too — card-level constant persistence, rules
 *  per the wildcard; see feedback_pbi_fx_altconstant_first_row_trap). */
export interface ResolvedBorder { colorCss: string; width: number; radius: number; }

/** Resolve the Border card to concrete paint values (or null when off).
 *  Wires the fx selector + honours an fx rule; shared by DOM (applyBorder)
 *  and SVG (visuals draw their own stroke-rect) callers. */
export function resolveBorder(
    border: BorderSettings | undefined,
    opts: { hcActive?: boolean; hcColor?: string; palette?: unknown; metadataObjects?: unknown } = {}
): ResolvedBorder | null {
    if (!border || !border.show.value) return null;
    // The border is a WHOLE-VISUAL (card-level) property, not per-datapoint.
    // A dataViewWildcard selector reroutes where the constant swatch
    // persists, so edits never reached the render (Neil 2026-07-13: "border
    // will not change colour"). No selector: the constant persists at card
    // level via border.color.value.value; a conditional-formatting RULE
    // still resolves through metadata.objects (the ColorHelper overlay).
    border.color.altConstantSelector = undefined;
    let hex = border.color.value.value;
    if (opts.palette && opts.metadataObjects !== undefined) {
        const helper = new ColorHelper(
            opts.palette as never,
            { objectName: "visualBorder", propertyName: "color" },
            hex
        );
        // Only a persisted RULE fill overrides the constant; when absent,
        // getColorForMeasure returns the constant we seeded, so this is a
        // safe no-op for the plain-constant case.
        hex = helper.getColorForMeasure(opts.metadataObjects as never, "color") ?? hex;
    }
    const width = Math.max(1, Math.min(8, border.width.value));
    const radius = Math.max(0, Math.min(24, border.radius.value));
    const colorCss = opts.hcActive ? (opts.hcColor ?? hex) : toRgba(hex, border.transparency.value ?? 0);
    return { colorCss, width, radius };
}

export function applyBorder(
    el: HTMLElement,
    border: BorderSettings | undefined,
    opts: { hcActive?: boolean; hcColor?: string; palette?: unknown; metadataObjects?: unknown } = {}
): void {
    const r = resolveBorder(border, opts);
    if (!r) { el.style.border = ""; el.style.borderRadius = ""; return; }
    el.style.border = `${r.width}px solid ${r.colorCss}`;
    el.style.borderRadius = r.radius > 0 ? `${r.radius}px` : "";
}
