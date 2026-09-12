"use strict";

// ─── Nexus Codex Theme card (kanban #819, Neil 2026-09-12) ──────────────────
// One switch above every visual's own theme derivation:
//   Auto  — today's render: composite the Background fill over the page and
//           read its tone (surfaceTone → surfaceTokens). Byte-for-byte the
//           1.x behaviour; the shipped default.
//   Dark / Light — force the token set and paint the mode's own card surface
//           at the card's Surface Transparency, whatever the page behind.
//   Neon  — dark tokens + a glow on the accents (card signature, status dot,
//           LED strip, headline). Flare colour picker with a scope switch:
//           "Flare colour only" tints the accents with the picked colour;
//           "All selected colours" glows every colour in its own hue.
// High contrast outranks every mode (the ONE shared HC rule): the resolver
// returns Auto with no neon whenever the host is in HC.
//
// Additive: a report that never set the card resolves to Auto and renders as
// before. capabilities snippet: codexThemeObject.json.

import powerbi from "powerbi-visuals-api";
import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";
import { compositeOver, contrastRatio } from "./colorHelpers";
import { surfaceTokens } from "./designTokens";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;

type Theme = "dark" | "light";
export type CodexMode = "auto" | "dark" | "light" | "neon";
export type NeonScope = "flare" | "all";

const MODES = [
    { displayName: "Automatic", value: "auto" },
    { displayName: "Dark", value: "dark" },
    { displayName: "Light", value: "light" },
    { displayName: "Neon", value: "neon" },
];
const SCOPES = [
    { displayName: "Flare colour only", value: "flare" },
    { displayName: "All selected colours", value: "all" },
];

export class CodexThemeSettings extends FormattingSettingsCard {
    name = "codexTheme";
    displayName = "Nexus Codex Theme";

    mode = new formattingSettings.ItemDropdown({
        name: "mode",
        displayName: "Mode",
        description: "Automatic follows your Background colour; Dark, Light and Neon force the Codex look",
        items: MODES,
        value: MODES[0],
    });

    surfaceTransparency = new formattingSettings.Slider({
        name: "surfaceTransparency",
        displayName: "Surface Transparency",
        description: "How much of the page shows through the Codex surface (Dark, Light, Neon)",
        value: 0,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 },
        },
    });

    neonColor = new formattingSettings.ColorPicker({
        name: "neonColor",
        displayName: "Flare Colour",
        value: { value: "#ac74da" },
    });

    neonScope = new formattingSettings.ItemDropdown({
        name: "neonScope",
        displayName: "Neon Applies To",
        items: SCOPES,
        value: SCOPES[0],
    });

    glowStrength = new formattingSettings.Slider({
        name: "glowStrength",
        displayName: "Glow Strength",
        value: 55,
        options: {
            minValue: { type: powerbi.visuals.ValidatorType.Min, value: 0 },
            maxValue: { type: powerbi.visuals.ValidatorType.Max, value: 100 },
        },
    });

    slices: FormattingSettingsSlice[] = [
        this.mode,
        this.surfaceTransparency,
        this.neonColor,
        this.neonScope,
        this.glowStrength,
    ];

    /** Show only the slices that matter for the chosen mode. Call from
     *  getFormattingModel() before building the model. */
    reveal(): void {
        const m = this.currentMode();
        this.surfaceTransparency.visible = m !== "auto";
        const neon = m === "neon";
        this.neonColor.visible = neon;
        this.neonScope.visible = neon;
        this.glowStrength.visible = neon;
    }

    currentMode(): CodexMode {
        const v = String(this.mode.value?.value ?? "auto");
        return (["auto", "dark", "light", "neon"].indexOf(v) >= 0 ? v : "auto") as CodexMode;
    }
}

export interface CodexThemeInput {
    hcActive: boolean;
    /** The theme the visual derived on its own (surfaceTone of the composited fill). */
    autoTheme: Theme;
    /** The fill and transparency the visual would paint in Auto. */
    autoBgHex: string;
    autoTransparencyPct: number;
    /** What sits behind the visual (host colorPalette.background). */
    behindHex: string;
}

export interface ResolvedCodexTheme {
    mode: CodexMode;
    theme: Theme;
    /** Fill + transparency to paint; identical to the inputs in Auto. */
    bgHex: string;
    transparencyPct: number;
    /** The surface a viewer sees (composited) — judge ink against THIS. */
    surfaceHex: string;
    neon: boolean;
    neonColor: string;
    neonScope: NeonScope;
    /** 0–100 glow budget; 0 outside Neon. */
    glow: number;
}

export function resolveCodexTheme(card: CodexThemeSettings | undefined, p: CodexThemeInput): ResolvedCodexTheme {
    const mode: CodexMode = !card || p.hcActive ? "auto" : card.currentMode();
    if (mode === "auto") {
        return {
            mode, theme: p.autoTheme, bgHex: p.autoBgHex, transparencyPct: p.autoTransparencyPct,
            surfaceHex: compositeOver(p.autoBgHex, p.autoTransparencyPct, p.behindHex),
            neon: false, neonColor: "#ac74da", neonScope: "flare", glow: 0,
        };
    }
    const theme: Theme = mode === "light" ? "light" : "dark";
    const bgHex = surfaceTokens(theme).card;
    const transparencyPct = Math.max(0, Math.min(100, Number(card!.surfaceTransparency.value ?? 0)));
    const neon = mode === "neon";
    return {
        mode, theme, bgHex, transparencyPct,
        surfaceHex: compositeOver(bgHex, transparencyPct, p.behindHex),
        neon,
        neonColor: String(card!.neonColor.value?.value ?? "#ac74da"),
        neonScope: (String(card!.neonScope.value?.value ?? "flare") === "all" ? "all" : "flare"),
        glow: neon ? Math.max(0, Math.min(100, Number(card!.glowStrength.value ?? 55))) : 0,
    };
}

/** The colour an accent takes under Neon: the flare colour when scoped to
 *  "flare", otherwise the colour the user already chose. */
export function neonColorFor(userHex: string, r: ResolvedCodexTheme): string {
    return r.neon && r.neonScope === "flare" ? r.neonColor : userHex;
}

/** The value to hand `applyCardSignature`'s `flareHex` (see
 *  cardSignatureSettings.ts): the flare colour under Neon + scope "flare",
 *  otherwise undefined so the signature keeps its own resolution. */
export function flareHexFor(r: ResolvedCodexTheme): string | undefined {
    return r.neon && r.neonScope === "flare" ? r.neonColor : undefined;
}

/** box-shadow / text-shadow flare: a tight core and a wide halo in the
 *  colour's own hue, scaled by the glow budget (0 → none).
 *  NOTE: an inline box-shadow outranks a stylesheet `:hover` box-shadow on the
 *  same element (Heatmap peak cell) — use neonFilter there instead. */
export function neonShadow(cssColor: string, glow: number): string {
    if (glow <= 0) return "none";
    const core = Math.min(100, Math.round(glow));
    const halo = Math.round(glow * 0.45);
    return `0 0 6px color-mix(in srgb, ${cssColor} ${core}%, transparent), 0 0 16px color-mix(in srgb, ${cssColor} ${halo}%, transparent)`;
}

/** CSS filter form of the same flare, for SVG groups and images. */
export function neonFilter(cssColor: string, glow: number): string {
    if (glow <= 0) return "none";
    return `drop-shadow(0 0 4px color-mix(in srgb, ${cssColor} ${Math.round(glow)}%, transparent)) drop-shadow(0 0 12px color-mix(in srgb, ${cssColor} ${Math.round(glow * 0.45)}%, transparent))`;
}

// ─── Forced-mode contract, decided by Neil 2026-09-12 (#819 contract questions) ──
//   1. Semantic band colours (danger red, warning amber, good green — anything whose
//      hue MEANS something) are NEVER tinted by the flare. Under scope "flare" they
//      keep their hue and only glow in it; pass them through neonColorFor only when
//      the colour is an ACCENT (signature, dots, LED chrome, headline).
//   2. Neutral chrome fills authored for the other tone (a progress track, a bullet
//      background bar, gridlines) re-tone to the forced mode's surface tokens —
//      they are chrome, not data.
//   3. An ink the user set explicitly is KEPT under a forced mode when it is still
//      legible on the mode's surface, and flipped to the mode's default only when it
//      is not (the Now vs Then guard, now the suite rule — the pilot replaced it).

/** Rule 3: the ink to paint under the resolved mode.
 *  Auto → the user's value untouched. Forced → the user's explicit ink if it reads
 *  at ≥ 4.5:1 on the mode's surface, else the mode's own default ink. A pane
 *  value still at its default (`isDefault`) always takes the mode's default.
 *  `surfaceHex` is the surface the ink is actually painted on; it defaults to the
 *  card. An ink on a cell fill (Heatmap, Sparkline Table) must pass the CELL's
 *  composited colour — judged against the card, explicit white on a white
 *  maximum cell read 1.00:1 (NEXUS re-review 2026-09-13 H1). */
export function forcedInk(userHex: string, modeDefaultHex: string, r: ResolvedCodexTheme, isDefault: boolean, surfaceHex: string = r.surfaceHex): string {
    if (r.mode === "auto") return isDefault ? modeDefaultHex : userHex;
    if (isDefault) return modeDefaultHex;
    return contrastRatio(userHex, surfaceHex) >= 4.5 ? userHex : modeDefaultHex;
}

/** Rule 2, guarded (Neil 2026-09-12, second decision): the chrome fill to paint
 *  under the resolved mode. Auto → the user's value. Forced + default → the mode's
 *  token. Forced + explicit → the user's fill if it still SEPARATES from the mode's
 *  surface (≥ 1.3:1 — a track only has to be visible, not readable), else the token.
 *  Keeps an author's deliberate track / border / gridline colour alive under a
 *  forced mode instead of making its picker inert. */
export function forcedChrome(userHex: string, modeTokenHex: string, r: ResolvedCodexTheme, isDefault: boolean): string {
    if (r.mode === "auto") return userHex;
    if (isDefault) return modeTokenHex;
    return contrastRatio(userHex, r.surfaceHex) >= 1.3 ? userHex : modeTokenHex;
}

/** Rule 3's fx exemption, one suite-wide test (Neil 2026-09-12, third decision):
 *  a host-evaluated conditional-formatting rule and a pane swatch arrive on the
 *  same field, so the only signal is that the RESOLVED colour differs from the
 *  pane's static value. True → the colour is data: paint it verbatim under every
 *  mode (never forcedInk / forcedChrome it). Known, benign false negative: a rule
 *  that resolves to exactly the static value is treated as a pane ink and guarded.
 *  (The Time Breakdown `!totalIsFx` / Slicer Bar `chipColorIsFx` idiom, shared.) */
export function isFxResolved(resolvedHex: string | null | undefined, paneHex: string | null | undefined): boolean {
    if (!resolvedHex || !paneHex) return false;
    return resolvedHex.toLowerCase() !== paneHex.toLowerCase();
}
