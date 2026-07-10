"use strict";

// ─── Shared Background Formatting Card ─────────────────────
// Suite-wide canonical Background object (D-08): a Color + Transparency
// pair, consumed by every visual via relative import (D-10).
//
// FROZEN once the Plan 03 pilot confirms the transparency direction (D-11).
// Do not fork or duplicate this card per-visual — fix here, once, for all.

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;

const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

export class BackgroundSettings extends FormattingSettingsCard {
    name = "background";
    displayName = "Background";

    backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Background Colour",
        value: { value: "#ffffff" },
        instanceKind: ConstantOrRule
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

    slices: FormattingSettingsSlice[] = [
        this.backgroundColor,
        this.transparency
    ];
}
