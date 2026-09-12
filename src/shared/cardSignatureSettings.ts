"use strict";

// ─── Shared Corner Accents formatting card (v3 addition, 2026-07-10) ──
// User-facing controls for the card-signature chrome (cardSignature.ts):
// show toggle, style variant (Corner Brackets / Accent Bar / Glass Tube),
// auto (theme accent) vs custom colour. Born from Neil's live Bullet Chart
// feedback — the chrome must be controllable, not hardcoded.
//
// Pair with the capabilities object:
//   "cardSignature": { properties: show(bool), style(enumeration),
//                      autoColor(bool), color(fill) }
// Under high contrast the system colour always wins (the ONE shared HC
// rule) — resolveCardSignature enforces that; visuals should not add
// their own HC branches around it.

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import type { CardSignatureHandle, CardSignatureVariant } from "./cardSignature";

// fx (conditional formatting) on the accent colour — same wiring as the
// Title and Background colour pickers (Neil 2026-09-12: "we do not have the
// fx function for the accents on any visual").
const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;

export class CardSignatureSettings extends FormattingSettingsCard {
    show = new formattingSettings.ToggleSwitch({
        name: "show",
        displayName: "Show",
        value: true
    });

    style = new formattingSettings.ItemDropdown({
        name: "style",
        displayName: "Style",
        items: [
            { displayName: "Corner Brackets", value: "cornerBracket" },
            { displayName: "Accent Bar", value: "flatBar" },
            { displayName: "Glass Tube", value: "glassTube" }
        ],
        value: { displayName: "Corner Brackets", value: "cornerBracket" }
    });

    autoColor = new formattingSettings.ToggleSwitch({
        name: "autoColor",
        displayName: "Auto Color",
        description: "Tint by the theme accent; turn off to pick a custom color",
        value: true
    });

    color = new formattingSettings.ColorPicker({
        name: "color",
        displayName: "Custom Color",
        value: { value: "#8f8ab8" },
        instanceKind: ConstantOrRule
    });

    mirrorCorners = new formattingSettings.ToggleSwitch({
        name: "mirrorCorners",
        displayName: "Both Corners",
        description: "Mirror the accent to the opposite corner (off = top-left only)",
        value: true
    });

    cornerRadius = new formattingSettings.NumUpDown({
        name: "cornerRadius",
        displayName: "Corner Radius",
        description: "Curve of the corner (px)",
        value: 10
    });

    name: string = "cardSignature";
    displayName: string = "Corner Accents";
    topLevelSlice = this.show;
    slices: Array<FormattingSettingsSlice> = [
        this.style,
        this.mirrorCorners,
        this.autoColor,
        this.color,
        this.cornerRadius
    ];
}

export interface CardSignatureParams {
    /** The colour the visual would use on its own (theme accent / muted). */
    autoHex: string;
    hcActive?: boolean;
    hcColor?: string;
    glowMix?: number;
    muted?: boolean;
    mirror?: boolean;
    cardRadius?: number;
    /** Nexus Codex Theme (#819), Neon with scope "flare": the flare colour
     *  outranks BOTH the visual's auto colour and a custom colour the author
     *  picked — the contract names the user's hex as the thing the flare
     *  replaces. Found by three executors independently (Zone Gauge, Callback
     *  Card, KPI Sparkline): tinting `autoHex` alone never reaches a report
     *  with Auto Color off. Undefined outside Neon-flare; HC still wins. */
    flareHex?: string;
}

export interface ResolvedCardSignature {
    visible: boolean;
    variant: CardSignatureVariant;
    hex: string;
}

/** Resolve the user's Corner Accents settings against the visual's own
 *  derivation. Precedence: HC system colour > user custom colour >
 *  the visual's auto colour. Muted (empty-state) renders keep the
 *  visual's muted colour but still honour show + style. */
export function resolveCardSignature(
    sig: CardSignatureSettings | undefined,
    p: CardSignatureParams
): ResolvedCardSignature {
    const visible = sig ? !!sig.show.value : true;
    const variant = (sig ? sig.style.value.value : "cornerBracket") as CardSignatureVariant;
    let hex = p.autoHex;
    if (p.hcActive) {
        hex = p.hcColor ?? p.autoHex;
    } else if (!p.muted && sig && !sig.autoColor.value) {
        hex = sig.color.value.value;
    }
    if (!p.hcActive && p.flareHex) hex = p.flareHex;
    return { visible, variant, hex };
}

/** Drive an existing CardSignatureHandle from the settings (update-style
 *  call sites). Hides the elements when show is off; styleBracket's
 *  display reset un-hides them on the next visible update. */
export function applyCardSignature(
    handle: CardSignatureHandle | null,
    sig: CardSignatureSettings | undefined,
    p: CardSignatureParams
): void {
    if (!handle) return;
    const r = resolveCardSignature(sig, p);
    if (!r.visible) {
        handle.elements.forEach((el) => { el.style.display = "none"; });
        return;
    }
    handle.update(r.hex, {
        variant: r.variant,
        glowMix: p.glowMix,
        // High contrast outranks the muted (empty-state) treatment: styleBracket
        // paints `mutedColor` at 0.4 opacity when muted, which discarded the
        // resolved HC foreground in every visual's empty state (NEXUS cycle-12
        // §8, measured brand violet rgb(143,138,184) on black).
        muted: p.muted && !p.hcActive,
        // …and the renderer itself drops gradients/shine/glow under HC, so
        // Flat Bar / Glass Tube stay on the system colour (astra pass three).
        highContrast: !!p.hcActive,
        mirror: sig ? sig.mirrorCorners.value : p.mirror,
        cardRadius: (sig && sig.cornerRadius.value !== 10)
            ? Math.max(0, Math.min(24, sig.cornerRadius.value))
            : p.cardRadius,
    });
}
