"use strict";

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { select, Selection } from "d3-selection";
import { scaleLinear } from "d3-scale";
import { interpolate } from "d3-interpolate";
import "d3-transition";
import "./../style/visual.less";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import ILocalizationManager = powerbi.extensibility.ILocalizationManager;
import ISelectionManager = powerbi.extensibility.ISelectionManager;
import ISelectionId = powerbi.visuals.ISelectionId;
import ITooltipService = powerbi.extensibility.ITooltipService;
import VisualTooltipDataItem = powerbi.extensibility.VisualTooltipDataItem;
import ISandboxExtendedColorPalette = powerbi.extensibility.ISandboxExtendedColorPalette;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel, alignSelfFor, textAlignFor } from "./settings";
import { formatValue, clamp } from "./utils";

import { dataViewWildcard } from "powerbi-visuals-utils-dataviewutils";
import { ColorHelper } from "powerbi-visuals-utils-colorutils";
import { toRgba, compositeOver, contrastInk, contrastRatio, mutedInk } from "./shared/colorHelpers";

// v3 appearance engine (frozen, 01-15) — band engine (direction-law
// tokens + the violet target/accent markers), design tokens (dim-theme
// surfaces + channel-linear mix()), the corner-bracket card signature,
// the capped/reduced-motion-aware settle() helper, and the single HC
// fallback rule. Consumed read-only (D-11).
import { Theme, accentToken, targetToken, directionColor } from "./shared/bandEngine";
import { mix, surfaceTokens, TABULAR_NUMS } from "./shared/designTokens";
import { applyBorder } from "./shared/borderSettings";
import { makeCornerBrackets, CardSignatureHandle } from "./shared/cardSignature";
import { applyCardSignature } from "./shared/cardSignatureSettings";
import {
    ResolvedCodexTheme, resolveCodexTheme, neonColorFor, neonFilter, flareHexFor } from "./shared/codexThemeSettings";
import { settle, MOTION_MAX_MS } from "./shared/motion";
import { applyHighContrast } from "./shared/highContrast";
import { LicenseGate } from "./shared/licensing";

interface MetricRow {
    category: string;
    nowValue: number;
    thenValue: number;
    sortOrder: number | null;
    change: number;
    /** Relative change, or null for a nonzero reading against a zero baseline. */
    changePct: number | null;
    rowFormat: string | null;       // "number" | "currency" | "percent" | null (use global)
    rowDirection: string | null;    // "upIsGood" | "downIsGood" | null (default upIsGood)
    direction: "positive" | "negative" | "neutral";
    selectionId: ISelectionId | null;
    categoryIndex: number;
    targetRangeLow: number | null;
    targetRangeHigh: number | null;
}

/** Mirrors motion.ts's own `prefers-reduced-motion` gate for this
 * visual's bespoke multi-element stagger choreography (connector +
 * then/now dots + labels + badge), which doesn't map onto a single
 * settle() keyframe call the way a text-only value swap does. The
 * now/then VALUE TEXT settle below does use settle() directly. */
function prefersReducedMotion(): boolean {
    try {
        return typeof window !== "undefined"
            && typeof window.matchMedia === "function"
            && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
        return false;
    }
}


/** The "no value" glyph this visual already renders through utils.formatValue()
 *  for a null/NaN reading. Reused for an undefined relative change so the two
 *  gaps read identically (NEXUS cycle-09 §1). */
const NO_VALUE = "—";

/** #657 — resolve the display unit. "default" reproduces the previous hardcoded per-format
 *  behaviour exactly (currency -> auto, number -> none, otherwise auto). */
function unitFor(setting: string, effectiveFmt: string): string {
    if (setting && setting !== "default") return setting;
    return effectiveFmt === "number" ? "none" : "auto";
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private eventService: IVisualEventService;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;
    private localizationManager: ILocalizationManager;
    private scrollContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private titleEl: HTMLDivElement;
    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel = new VisualFormattingSettingsModel();
    private formattingSettingsService: FormattingSettingsService;
    private previousData: string = "";
    private isHighContrast: boolean = false;
    private highContrastForeground: string = "";
    private highContrastBackground: string = "";

    // Conditional formatting (fx) state — Positive Colour (TRANS-04)
    private categoricalCategories: powerbi.DataViewCategoryColumn | undefined;
    private positiveColorHelper: ColorHelper | null = null;

    // Conditional formatting (fx) state — Now Value Colour (TEXT-02)
    private valueColorHelper: ColorHelper | null = null;

    // v3 card signature — one accent-tinted corner-bracket pair for the
    // whole card (this is a multi-row list visual, like Progress Bar
    // Card — the accent cyan is the card's own identity, distinct from
    // any row's direction colour).
    private cornerSignature: CardSignatureHandle | null = null;

    // v3 theme captured for renderTitle() (D-16 adaptive title default).
    private currentTheme: Theme = "light";
    private currentSurface = "#ffffff";

    // Nexus Codex Theme (#819): the ONE resolved theme object for this
    // update(), resolved once in resolveTheme() and read by every renderer
    // (row list, title, empty state) — never resolved a second time.
    private codex: ResolvedCodexTheme | null = null;
    // The single background paint string that resolveTheme() produced, so
    // the row renderer repaints the container with the SAME answer rather
    // than deriving the surface again.
    private currentBackgroundCss = "";

    // Gradient-def bookkeeping so the beveled "now" dot's SVG
    // <radialGradient> defs are only (re)created once per row per
    // update(), not per attribute read.
    private gradientDefs: Selection<SVGDefsElement, unknown, null, undefined>;
    private borderRect: Selection<SVGRectElement, unknown, null, undefined>;

    private licenseGate: LicenseGate;

    private lastUpdateOptions: VisualUpdateOptions | null = null;
    private destroyed = false;

    private readonly contextMenuHandler = (event: MouseEvent): void => {
        const element = event.target instanceof Element ? event.target.closest(".metric-row") : null;
        const row = element ? select(element).datum() as MetricRow : undefined;
        this.selectionManager.showContextMenu(row?.selectionId || {}, { x: event.clientX, y: event.clientY });
        event.preventDefault();
        event.stopPropagation();
    };

    constructor(options: VisualConstructorOptions) {

        // NO FREE TIER — an unlicensed user gets the whole visual blocked.

        // The check is async, so re-run the last update once it resolves.

        this.licenseGate = new LicenseGate(options.host, () => {

            if (this.lastUpdateOptions) this.update(this.lastUpdateOptions);

        });
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;
        this.host = options.host;
        this.eventService = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.tooltipService = options.host.tooltipService;
        this.localizationManager = options.host.createLocalizationManager();

        this.scrollContainer = select(this.target)
            .append("div")
            .classed("now-vs-then-scroll", true)
            .style("width", "100%")
            .style("height", "100%")
            // overflow-y only. The chart is always sized to fit the container
            // width, so a HORIZONTAL scrollbar is never legitimate here — and
            // with plain `auto` one appeared permanently as soon as content was
            // taller than the viewport: the vertical scrollbar consumed ~15px of
            // inner width while the SVG was still set to the FULL viewport width
            // (Neil, 2026-07-30). The width is also reduced below; this is the
            // backstop.
            .style("overflow-x", "hidden")
            .style("overflow-y", "auto")
            .style("position", "relative");

        // Context menu. Listener on target AND on the inner scrollContainer —
        // the scrollContainer's padding/scroll-gutter regions don't bubble
        // contextmenu events reliably in PBI's sandbox, so a direct listener
        // is required to cover right-clicks in empty padding (Policy 1180.2.5).
        this.target.addEventListener("contextmenu", this.contextMenuHandler);
        (this.scrollContainer.node() as HTMLElement).addEventListener("contextmenu", this.contextMenuHandler);

        // Internal title (rendered inside iframe so right-click on it
        // satisfies Policy 1180.2.5 — same shared-card approach as
        // pbiKpiCard/pbiCallbackCard, D-13/D-14). A persistent HTML div,
        // NOT an SVG child — created before the svg so it stacks above the
        // chart in normal document flow inside scrollContainer (which is
        // in-flow, not the contextmenu-bearing target, so it cannot swallow
        // empty-space right-clicks, T-11-01).
        this.titleEl = this.scrollContainer.append("div")
            .classed("now-vs-then-title", true)
            .style("display", "none")
            .node() as HTMLDivElement;

        this.svg = this.scrollContainer
            .append("svg")
            .classed("now-vs-then-svg", true);

        this.gradientDefs = this.svg.append("defs") as unknown as
            Selection<SVGDefsElement, unknown, null, undefined>;

        this.borderRect = this.svg.append("rect")
            .classed("nvt-border", true)
            .attr("fill", "none")
            .style("pointer-events", "none") as unknown as
            Selection<SVGRectElement, unknown, null, undefined>;

        // Corner-bracket card signature — accent-tinted (the card's own
        // cyan identity, not any single row's direction colour), appended
        // to the scroll container (an HTML overlay above the SVG,
        // pointer-events:none) so it paints above every row.
        this.cornerSignature = makeCornerBrackets(
            this.scrollContainer.node() as HTMLElement,
            accentToken("dark"),
            { variant: "cornerBracket", mirror: true }
        );
    }

    public update(options: VisualUpdateOptions): void {
        if (this.destroyed) return;
        this.eventService.renderingStarted(options);
        this.lastUpdateOptions = options;

        if (this.licenseGate.blockedThisFrame()) {
            this.target.style.display = "none";
            this.eventService.renderingFinished(options);
            return;
        }
        this.target.style.display = "";

        try {
            // High contrast detection
            const colorPalette = this.host.colorPalette as ISandboxExtendedColorPalette;
            this.isHighContrast = colorPalette.isHighContrast;
            if (this.isHighContrast) {
                this.highContrastForeground = colorPalette.foreground.value;
                this.highContrastBackground = colorPalette.background.value;
            }

            const dataView: DataView = options.dataViews && options.dataViews[0];
            this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
                VisualFormattingSettingsModel, dataView
            );

            const width = Math.max(0, options.viewport.width);
            const height = Math.max(0, options.viewport.height);
            // Set viewport size on scroll container
            this.scrollContainer.style("width", width + "px").style("height", height + "px");

            // Clear (re-creates <defs> below — selectAll("*") also removes it)
            this.svg.node()?.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
            this.svg.selectAll("*").interrupt().on("mousemove mouseleave click keydown", null).remove();
            this.svg.attr("width", 0).attr("height", 0);
            this.gradientDefs = this.svg.append("defs") as unknown as
                Selection<SVGDefsElement, unknown, null, undefined>;

            // ─── v3 theme pick + single HC fallback rule, computed once
            // and reused everywhere colour is resolved below (§8, D-16).
            // The ink is judged against the surface that is actually
            // VISIBLE — the Background card composited over the legacy
            // colour and the report theme behind it — not against a raw
            // fill hex that may be painted at any transparency, including
            // one that makes it invisible (NEXUS cycle-09 §4). The old
            // ladder trusted any non-white hex even at 100% transparency.
            // Nexus Codex Theme (#819) sits ABOVE that automatic pick:
            // resolveTheme() returns the auto answer untouched in Auto, and
            // the forced Codex surface/token set in Dark/Light/Neon.
            const background = this.resolveTheme();
            const codex = background.codex;
            this.codex = codex;
            this.currentSurface = background.surfaceHex;
            this.currentBackgroundCss = background.css;
            const theme: Theme = background.theme;
            this.currentTheme = theme;
            // A forced mode OWNS the text inks (category labels, Now/Then
            // values, the visual title, axis titles) against its own
            // composited surface — an ink the user picked for a white card is
            // not a choice about the Codex dark surface. Direction/band/fx
            // colours stay the user's. Auto keeps every pane ink as-is.
            const inkOverride = codex.mode !== "auto";
            const hc = applyHighContrast(colorPalette, { fallbackColor: accentToken(theme) });
            const sc = this.scrollContainer.node() as HTMLElement;
            sc.style.boxSizing = "border-box";
            sc.style.backgroundColor = background.css;
            applyBorder(sc, this.formattingSettings.visualBorder, {
                hcActive: this.isHighContrast,
                hcColor: this.highContrastForeground,
                palette: this.host.colorPalette,
                metadataObjects: dataView?.metadata?.objects,
            });

            // Corner-bracket re-tint each update (created once in the constructor).
            applyCardSignature(this.cornerSignature, this.formattingSettings.cardSignature, {
                autoHex: neonColorFor(accentToken(theme), codex),
                flareHex: flareHexFor(codex),
                hcActive: hc.active,
                hcColor: hc.color,
                mirror: true,
                // Neon hands the card signature the card's glow budget; every
                // other mode keeps the shipped dark-only 55 / light-only 0.
                glowMix: hc.active ? 0 : codex.neon ? codex.glow : (theme === "dark" ? 55 : 0),
                muted: false,
            });

            this.categoricalCategories = dataView?.categorical?.categories?.[0];

            const rows = this.parseData(dataView);
            if (rows.length === 0) {
                this.titleEl.style.display = "none";
                applyCardSignature(this.cornerSignature, this.formattingSettings.cardSignature, {
                    autoHex: neonColorFor(accentToken(theme), codex), hcActive: hc.active, hcColor: hc.color, mirror: true, muted: true,
                    flareHex: flareHexFor(codex),
                });
                this.renderEmpty(sc.clientWidth, sc.clientHeight, theme);
                this.eventService.renderingFinished(options);
                return;
            }

            this.renderTitle();

            // ─── Conditional formatting (fx) wiring — Positive Colour
            // (TRANS-04). A bare `instanceKind: ConstantOrRule` declaration
            // in settings.ts does not make the fx button functional on its
            // own (Pitfall 5) — it also needs a `selector` (dataViewWildcard,
            // so a rule can match this measure's category instances/totals)
            // and an `altConstantSelector` bound to a concrete selectionId
            // for the "set for all" swatch edit path. Resolved per-row at
            // render via ColorHelper.getColorForMeasure against each
            // category's own per-instance object overrides
            // (categoricalCategories.objects[categoryIndex]).
            const positiveColorSlice = this.formattingSettings.comparisonCard.positiveColor;
            positiveColorSlice.selector = dataViewWildcard.createDataViewWildcardSelector(
                dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
            );
            positiveColorSlice.altConstantSelector = undefined; // card-level constant persistence: swatch edits apply to ALL instances + round-trip into the pane (first-instance binding persisted a row-0-only override); fx rules stay per-instance via the wildcard selector;
            // Untouched positive default -> the direction law (lime), so
            // the fx helper (which returns its seed when no rule) resolves
            // to the design colour, not the legacy teal (#007064).
            const posSeed = positiveColorSlice.value.value === "#007064"
                ? directionColor(1, theme) : positiveColorSlice.value.value;
            this.positiveColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "comparisonSettings", propertyName: "positiveColor" },
                posSeed
            );

            // ─── Conditional formatting (fx) wiring — Now Value Colour
            // (TEXT-02). Same wildcard-selector + altConstantSelector +
            // ColorHelper.getColorForMeasure pattern as Positive Colour
            // above, targeting the "nowValue" measure role so a fx rule
            // resolves against the bound Now Value field.
            const valueColorSlice = this.formattingSettings.labelCard.valueColor;
            valueColorSlice.selector = dataViewWildcard.createDataViewWildcardSelector(
                dataViewWildcard.DataViewWildcardMatchingOption.InstancesAndTotals
            );
            valueColorSlice.altConstantSelector = undefined; // card-level constant persistence: swatch edits apply to ALL instances + round-trip into the pane (first-instance binding persisted a row-0-only override); fx rules stay per-instance via the wildcard selector;
            // Seed with the theme-ADAPTED default: the Now value reads
            // getColorForMeasure (returns this seed when no fx rule), so a
            // raw #333333 seed made the value dark-on-dark (Neil 2026-07-13).
            // #819: a forced Codex mode adapts this seed too — otherwise a
            // report whose Now value ink was picked for a white card seeds the
            // fx helper with near-black text on the Codex dark surface.
            const adaptedValueDefault = inkOverride || valueColorSlice.value.value === "#333333"
                ? this.readableInk(theme === "dark" ? surfaceTokens("dark").text : "#333333") : valueColorSlice.value.value;
            this.valueColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "labelSettings", propertyName: "valueColor" },
                adaptedValueDefault
            );

            // Check if data actually changed (to decide whether to animate)
            const dataKey = JSON.stringify(rows.map(r => [r.category, r.nowValue, r.thenValue]));
            const shouldAnimate = dataKey !== this.previousData;
            this.previousData = dataKey;

            // Axis title settings
            const axisSettings = this.formattingSettings.axisCard;
            const showAxisTitles = axisSettings.showAxisTitles.value;
            const xAxisTitleText = axisSettings.xAxisTitle.value || "";
            const yAxisTitleText = axisSettings.yAxisTitle.value || "";

            // Let the browser allocate border and scrollbar space, including
            // the title's actual wrapped height, before measuring the plot.
            const contentH = this.computeContentHeight(rows);
            this.svg.attr("height", contentH);
            const drawWidth = sc.clientWidth;
            this.svg.attr("width", drawWidth);
            const rendered = this.renderDumbbell(rows, drawWidth, shouldAnimate, showAxisTitles, xAxisTitleText, yAxisTitleText, theme, hc);
            if (!rendered) {
                this.svg.attr("height", Math.max(0, sc.clientHeight - this.titleEl.offsetHeight));
                this.svg.attr("width", sc.clientWidth);
            }

            this.eventService.renderingFinished(options);
        } catch (e) {
            this.eventService.renderingFailed(options, String(e));
        }
    }

    private parseData(dataView: DataView): MetricRow[] {
        if (!dataView?.categorical?.categories?.[0]?.values?.length) return [];

        const catColumn = dataView.categorical.categories[0];
        const cats = catColumn.values;
        const vals = dataView.categorical.values || [];

        // Build role → column index map by checking ALL role keys per column
        const roleMap: Record<string, number> = {};
        for (let i = 0; i < vals.length; i++) {
            const roles = vals[i].source.roles;
            if (roles) {
                for (const roleName of Object.keys(roles)) {
                    if (roles[roleName]) {
                        roleMap[roleName] = i;
                    }
                }
            }
        }

        const rows: MetricRow[] = [];
        for (let r = 0; r < cats.length; r++) {
            const getNum = (role: string): number | null => {
                if (roleMap[role] === undefined) return null;
                const raw = vals[roleMap[role]].values[r];
                if (raw === null || raw === undefined) return null;
                if (typeof raw !== "number" && typeof raw !== "string") return null;
                if (typeof raw === "string" && raw.trim() === "") return null;
                const n = Number(raw);
                return Number.isFinite(n) ? n : null;
            };

            const getStr = (role: string): string | null => {
                if (roleMap[role] === undefined) return null;
                const raw = vals[roleMap[role]].values[r];
                if (raw === null || raw === undefined) return null;
                return String(raw);
            };

            const nowVal = getNum("nowValue");
            const thenVal = getNum("thenValue");
            if (nowVal === null || thenVal === null) continue;

            const change = nowVal - thenVal;
            // A zero baseline has no relative change to express. The old
            // fallback reported EVERY rise from zero as "+0.0%" — 0 -> 10 read
            // as no movement at all (NEXUS cycle-09 §1). null means "no
            // baseline": the badge and the tooltip render the same em-dash
            // utils.formatValue() already uses for a missing reading. The raw
            // `change` is untouched and still drives arrow/direction/absolute.
            const changePct = thenVal !== 0 ? (change / Math.abs(thenVal)) * 100 : nowVal === 0 ? 0 : null;

            // Per-row format and direction from data roles
            const rowFormat = getStr("format");
            const rowDirection = getStr("direction");

            // Determine visual direction based on change sign + downIsGood semantics
            let direction: "positive" | "negative" | "neutral";
            if (change === 0) {
                direction = "neutral";
            } else if (rowDirection === "downIsGood") {
                // For metrics like cost/stockouts, a decrease is good (positive)
                direction = change < 0 ? "positive" : "negative";
            } else {
                // Default: upIsGood — an increase is positive
                direction = change > 0 ? "positive" : "negative";
            }

            const selectionId = this.host.createSelectionIdBuilder()
                .withCategory(catColumn, r)
                .createSelectionId();

            rows.push({
                category: String(cats[r] ?? ""),
                nowValue: nowVal,
                thenValue: thenVal,
                sortOrder: getNum("sortOrder"),
                change,
                changePct,
                rowFormat,
                rowDirection,
                direction,
                selectionId,
                categoryIndex: r,
                targetRangeLow: getNum("targetRangeLow"),
                targetRangeHigh: getNum("targetRangeHigh")
            });
        }

        // Sort by sortOrder if available
        rows.sort((a, b) => {
            if (a.sortOrder !== null && b.sortOrder !== null) return a.sortOrder - b.sortOrder;
            if (a.sortOrder !== null) return -1;
            if (b.sortOrder !== null) return 1;
            return 0;
        });

        return rows;
    }

    /** The ONE effective background (NEXUS cycle-09 §4).
     *
     *  Layer order, explicit rather than emergent from paint order: the legacy
     *  Style-card colour is the BASE (opaque when set), the shared Background
     *  card paints on top of it at its own transparency, and whatever is behind
     *  the visual — the report theme's palette background — shows through when
     *  neither is opaque.
     *
     *  `surfaceHex` is that stack composited: the colour a viewer actually
     *  sees, and therefore the only honest thing to judge adaptive ink against.
     *  A fill nobody can see no longer votes on the theme — black at 100%
     *  transparency over a white page chose light-on-white text before.
     *
     *  `css` is painted once, by the scroll container alone. With a legacy
     *  colour underneath the stack is opaque, so the composited hex IS the
     *  surface; without one the card must stay exactly as see-through as the
     *  user asked, so the alpha is preserved instead of being flattened. */
    private resolveBackground(): { css: string; surfaceHex: string } {
        if (this.isHighContrast) {
            return { css: this.highContrastBackground, surfaceHex: this.highContrastBackground };
        }
        const palette = this.host.colorPalette as ISandboxExtendedColorPalette;
        const behindHex = palette?.background?.value || "#ffffff";
        const legacyHex = (this.formattingSettings.styleCard.backgroundColor.value?.value || "").trim();
        const bgHex = this.formattingSettings.background.backgroundColor.value?.value ?? "#ffffff";
        const bgTransparencyPct = this.formattingSettings.background.transparency.value ?? 100;
        return {
            css: legacyHex
                ? compositeOver(bgHex, bgTransparencyPct, legacyHex)
                : toRgba(bgHex, bgTransparencyPct),
            surfaceHex: compositeOver(bgHex, bgTransparencyPct, legacyHex || behindHex),
        };
    }

    /** The ONE theme resolution per update() (#819).
     *
     *  resolveBackground() above is the AUTOMATIC answer — the surface this
     *  visual painted before the Codex Theme card existed, and still the
     *  control: Mode = Automatic returns it byte-for-byte, including its
     *  alpha-preserving `css` and its high-contrast early return.
     *
     *  Dark / Light / Neon swap the fill for the Codex card token at the
     *  card's own Surface Transparency while keeping the SAME layer order as
     *  the auto path: a legacy Style-card colour is still the opaque base
     *  underneath (so a forced mode can never make it vanish and let the page
     *  show through), and only without one is the alpha preserved. High
     *  contrast never reaches here as a forced mode — the shared resolver
     *  collapses to Auto whenever the host is in HC, which is the one HC rule
     *  this file does not restate. */
    private resolveTheme(): { css: string; surfaceHex: string; theme: Theme; codex: ResolvedCodexTheme } {
        const auto = this.resolveBackground();
        const autoTheme: Theme = contrastInk(auto.surfaceHex, "#000000", "#ffffff") === "#000000" ? "light" : "dark";
        const palette = this.host.colorPalette as ISandboxExtendedColorPalette;
        const legacyHex = (this.formattingSettings.styleCard.backgroundColor.value?.value || "").trim();
        const codex = resolveCodexTheme(this.formattingSettings.codexTheme, {
            hcActive: this.isHighContrast,
            autoTheme,
            autoBgHex: this.formattingSettings.background.backgroundColor.value?.value ?? "#ffffff",
            autoTransparencyPct: this.formattingSettings.background.transparency.value ?? 100,
            behindHex: legacyHex || palette?.background?.value || "#ffffff",
        });
        if (codex.mode === "auto") {
            return { css: auto.css, surfaceHex: auto.surfaceHex, theme: autoTheme, codex };
        }
        return {
            css: legacyHex
                ? compositeOver(codex.bgHex, codex.transparencyPct, legacyHex)
                : toRgba(codex.bgHex, codex.transparencyPct),
            surfaceHex: codex.surfaceHex,
            theme: codex.theme,
            codex,
        };
    }

    private readableInk(preferred: string, surface = this.currentSurface): string {
        return contrastRatio(preferred, surface) >= 4.5
            ? preferred : contrastInk(surface, "#000000", "#ffffff");
    }

    private secondaryInk(): string {
        return mutedInk(contrastInk(this.currentSurface, "#000000", "#ffffff"), this.currentSurface);
    }

    private computeContentHeight(rows: MetricRow[]): number {
        const lbl = this.formattingSettings.labelCard;
        const showLabels = lbl.showLabels.value;
        const catFontSize = Math.max(8, Math.min(30, lbl.categoryFontSize.value));
        const valFontSize = Math.max(8, Math.min(24, lbl.valueFontSize.value));
        const comp = this.formattingSettings.comparisonCard;
        const dotRadius = Math.max(3, comp.dotRadius.value);
        const style = this.formattingSettings.styleCard;
        const rowSpacing = Math.max(4, style.rowSpacing.value);
        const trackHeight = Math.max(1, style.trackHeight.value);

        const endpointLabelFontSize = Math.max(6, Math.min(24, lbl.endpointLabelFontSize.value));
        const labelRowHeight = showLabels ? Math.max(12, endpointLabelFontSize + 4) : 0;
        const valueRowHeight = Math.max(valFontSize, clamp(lbl.thenFontSize.value, 8, 24)) + 4;
        const dumbbellHeight = Math.max(dotRadius * 2 + 4, trackHeight + 8);
        const singleRowHeight = catFontSize + 4 + dumbbellHeight + valueRowHeight + labelRowHeight;
        const totalRowHeight = singleRowHeight + rowSpacing;

        let contentH = 12 + rows.length * totalRowHeight; // margin.top + rows

        // Axis titles add extra height
        const axisSettings = this.formattingSettings.axisCard;
        if (axisSettings?.showAxisTitles?.value && axisSettings?.xAxisTitle?.value) {
            contentH += catFontSize + 8;
        }

        // v2 numeric axis tick-label row (Shared axis mode only) — mirrors
        // pbiProgressBarCard's own "axis caption" extra-height convention.
        const axisModeForHeight = (axisSettings?.axisMode?.value?.value as string) || "shared";
        if (axisSettings?.showAxisGridlines?.value && axisModeForHeight === "shared") {
            contentH += 18;
        }

        return contentH;
    }

    private formatRowValue(value: number, row: MetricRow, difference = false): string {
        const comp = this.formattingSettings.comparisonCard;
        const format = row.rowFormat || String(comp.valueFormat.value?.value || "auto");
        const decimals = clamp(comp.decimalPlaces.value, 0, 6);
        if (format === "percent") return value.toFixed(decimals) + (difference ? " pp" : "%");
        const units = unitFor(String(comp.displayUnits.value?.value || "default"), format);
        if (format === "currency") {
            const magnitude = formatValue(Math.abs(value), units, decimals);
            const sign = value < 0 && parseFloat(magnitude) !== 0 ? "-" : "";
            return sign + "$" + magnitude;
        }
        return formatValue(value, units, decimals);
    }

    private formatVariance(row: MetricRow): { varText: string; arrow: string; noBaselineOnly: boolean } {
        const format = String(this.formattingSettings.comparisonCard.varianceFormat.value?.value || "percent");
        const noBaselineOnly = row.changePct === null && format === "percent";
        const parts: string[] = [];
        if (format === "percent" || format === "both") {
            parts.push(row.changePct === null ? NO_VALUE
                : (row.changePct >= 0 ? "+" : "") + row.changePct.toFixed(1) + "%");
        }
        if (format === "absolute" || format === "both") {
            parts.push((row.change >= 0 ? "+" : "") + this.formatRowValue(row.change, row, true));
        }
        return {
            varText: parts.join(" "),
            arrow: noBaselineOnly ? "" : row.change > 0 ? "\u25B2" : row.change < 0 ? "\u25BC" : "",
            noBaselineOnly
        };
    }

    private measureTextWidth(text: string, size: number, family: string, weight: string): number {
        const probe = this.svg.append("text")
            .attr("font-size", size + "px").attr("font-family", family).attr("font-weight", weight)
            .style("font-feature-settings", TABULAR_NUMS).style("visibility", "hidden").text(text);
        const width = probe.node().getBBox().width;
        probe.remove();
        return width;
    }

    private fitCategoryLabel(node: SVGTextElement, width: number): void {
        if (node.getBBox().width <= width) return;
        const full = node.textContent || "";
        node.setAttribute("aria-label", full);
        const chars = Array.from(full);
        let lo = 0, hi = chars.length;
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            node.textContent = chars.slice(0, mid).join("") + "\u2026";
            if (node.getBBox().width <= width) lo = mid;
            else hi = mid - 1;
        }
        node.textContent = chars.slice(0, lo).join("") + "\u2026";
    }

    private fitTextPair(first: SVGTextElement, second: SVGTextElement, firstOnLeft: boolean, min: number, max: number): void {
        const left = firstOnLeft ? first : second;
        const right = firstOnLeft ? second : first;
        const a = left.getBBox(), b = right.getBBox();
        const gap = 8;
        let x = clamp(a.x, min, max - a.width);
        let y = clamp(b.x, min, max - b.width);
        if (x + a.width + gap > y) {
            x = clamp((x + a.width + y) / 2 - gap / 2 - a.width, min, max - a.width - b.width - gap);
            y = Math.max(y, x + a.width + gap);
        }
        left.setAttribute("x", String(Number(left.getAttribute("x")) + x - a.x));
        right.setAttribute("x", String(Number(right.getAttribute("x")) + y - b.x));
    }

    private renderDumbbell(rows: MetricRow[], width: number, animate: boolean,
        showAxisTitles: boolean = false, xAxisTitleText: string = "", yAxisTitleText: string = "",
        theme: Theme = "dark", hc: ReturnType<typeof applyHighContrast> = applyHighContrast(null)): boolean {
        const comp = this.formattingSettings.comparisonCard;
        const lbl = this.formattingSettings.labelCard;
        const style = this.formattingSettings.styleCard;

        // #819: the ONE Codex resolution update() already made for this
        // render — read, never re-resolved. `inkOverride` is the forced-mode
        // flag that widens every "adapt only when the user left the default"
        // ink rule below to "adapt when forced OR default". `flare()` is the
        // Neon accent rule (flare scope tints, "all" scope keeps the hue).
        const codex = this.codex;
        const inkOverride = codex ? codex.mode !== "auto" : false;
        const flare = (hex: string): string => codex ? neonColorFor(hex, codex) : hex;

        // Direction law (v2 design): increases lime, decreases magenta,
        // untouched only — a user pick still wins.
        let positiveColor = comp.positiveColor.value.value === "#007064"
            ? directionColor(1, theme) : comp.positiveColor.value.value;
        let negativeColor = comp.negativeColor.value.value === "#e60e22"
            ? directionColor(-1, theme) : comp.negativeColor.value.value;
        let neutralColor = comp.neutralColor.value.value === "#5e5d5a"
            ? this.secondaryInk() : comp.neutralColor.value.value;
        const connectorWidth = Math.max(1, comp.connectorWidth.value);
        const dotRadius = Math.max(3, comp.dotRadius.value);
        // v3 motion (§6): the now-dot's travel settles ONCE, capped at
        // MOTION_MAX_MS (400ms) regardless of the user's own configured
        // Animation Duration, and skipped entirely under
        // prefers-reduced-motion — mirrors motion.ts's own settle()
        // contract for this visual's bespoke multi-element (connector +
        // both dots + labels + badge) stagger choreography, which doesn't
        // map onto a single settle() keyframe call the way a text-only
        // value swap does (the now/then value TEXT settle below calls
        // settle() directly).
        const reducedMotion = prefersReducedMotion();
        const animDuration = reducedMotion ? 0 : Math.min(Math.max(0, comp.animationDuration.value), MOTION_MAX_MS);
        const staggerDelay = reducedMotion ? 0 : Math.max(0, comp.staggerDelay.value);
        const showBadge = comp.showVarianceBadge.value;

        const catFontSize = clamp(lbl.categoryFontSize.value, 8, 30);
        // #819 ink sites: `inkOverride ||` is what turns each of these from
        // "adapt the untouched default" into "adapt when a Codex mode is
        // forced OR the default is untouched". Body text — these never glow.
        let catColor = inkOverride || lbl.categoryColor.value.value === "#1a1a1a"
            ? this.readableInk(theme === "dark" ? surfaceTokens("dark").text : "#1a1a1a") : lbl.categoryColor.value.value;
        const valFontSize = clamp(lbl.valueFontSize.value, 8, 24);
        let valColor = inkOverride || lbl.valueColor.value.value === "#333333"
            ? this.readableInk(theme === "dark" ? surfaceTokens("dark").text : "#333333") : lbl.valueColor.value.value;
        const thenFontSize = clamp(lbl.thenFontSize.value, 8, 24);
        let thenValueColor = inkOverride || lbl.thenColor.value.value === "#5e5d5a"
            ? this.secondaryInk() : lbl.thenColor.value.value;
        const badgeFontSize = clamp(lbl.badgeFontSize.value, 8, 20);
        const nowLabelText = lbl.nowLabel.value || "Now";
        const thenLabelText = lbl.thenLabel.value || "Then";
        const showLabels = lbl.showLabels.value;
        const endpointLabelFontSize = clamp(lbl.endpointLabelFontSize.value, 6, 24);
        const endpointLabelBold = lbl.endpointLabelBold.value;
        const endpointLabelColorOverride = (lbl.endpointLabelColor.value?.value || "").trim();
        const badgeColorOverride = (lbl.badgeColor.value?.value || "").trim();

        // ─── Text treatment (font family/weight/style/decoration,
        // TEXT-01/TEXT-02) — `?? default` reproduces each surface's
        // PRE-EXISTING hardcoded style exactly when an old saved report has
        // none of these new properties set (D-06):
        //   category: was hardcoded font-weight 600 -> categoryBold defaults true
        //   Now value: was hardcoded font-weight 700 -> valueBold defaults true
        //   Then value: had no font-weight set       -> thenBold defaults false
        //   badge/delta: was hardcoded font-weight 700 -> badgeBold defaults true
        const weightFor = (bold: boolean | undefined, restWeight: string): string => bold ? "700" : restWeight;

        const categoryFontFamily = lbl.categoryFontFamily.value || "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
        const categoryWeight = weightFor(lbl.categoryBold.value, "600");
        const categoryStyle = lbl.categoryItalic.value ? "italic" : "normal";
        const categoryDecoration = lbl.categoryUnderline.value ? "underline" : "none";

        const valueFontFamily = lbl.valueFontFamily.value || "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
        const valueWeight = weightFor(lbl.valueBold.value, "400");
        const valueStyle = lbl.valueItalic.value ? "italic" : "normal";
        const valueDecoration = lbl.valueUnderline.value ? "underline" : "none";

        const thenFontFamily = lbl.thenFontFamily.value || "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
        const thenWeightBase = weightFor(lbl.thenBold.value, "400");
        const thenStyleBase = lbl.thenItalic.value ? "italic" : "normal";
        const thenDecoration = lbl.thenUnderline.value ? "underline" : "none";

        const badgeFontFamily = lbl.badgeFontFamily.value || "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
        const badgeWeight = weightFor(lbl.badgeBold.value, "400");
        const badgeStyle = lbl.badgeItalic.value ? "italic" : "normal";
        const badgeDecoration = lbl.badgeUnderline.value ? "underline" : "none";

        let trackColor = style.trackColor.value.value === "#1c1c3a"
            ? surfaceTokens(theme).track : style.trackColor.value.value;
        const trackHeight = Math.max(1, style.trackHeight.value);
        const rowSpacing = Math.max(4, style.rowSpacing.value);

        // High contrast overrides
        if (this.isHighContrast) {
            trackColor = this.highContrastForeground;
            positiveColor = this.highContrastForeground;
            negativeColor = this.highContrastForeground;
            neutralColor = this.highContrastForeground;
            catColor = this.highContrastForeground;
            valColor = this.highContrastForeground;
            thenValueColor = this.highContrastForeground;
        }

        // ─── Dedicated background layer (D-05), painted ONCE ───────────
        // Was: the shared Background card painted BOTH an SVG rect and the
        // scroll container behind it, so a translucent colour composited over
        // itself — black at 50% measured RGB 63/63/63 inside the chart against
        // 127/127/127 on the same container just below it. And the legacy
        // Style-card rect was painted last, so it covered the shared card on
        // the chart but not behind the title (NEXUS cycle-09 §4).
        //
        // Now resolveBackground() resolves ONE effective surface with the layer
        // order made explicit — legacy base, shared card above it, report theme
        // behind both — and the scroll container is the single element that
        // paints it, which is also what puts it behind the TITLE div (a DOM
        // sibling above the svg — Neil 2026-07-13: "the title didn't get the
        // dark background"). D-06 still holds: an old report that never touched
        // the new card carries transparency 100, which composites to exactly
        // what is behind it and paints alpha 0 — pixel-identical to before.
        // #819: repaint from the ONE answer update() already resolved — a
        // second resolveBackground() here would re-derive the auto surface and
        // silently undo a forced Codex mode.
        this.scrollContainer.style("background-color", this.currentBackgroundCss);

        // Layout calculations
        const margin = { left: 16, right: 16, top: 12, bottom: 8 };
        const categoryWidth = Math.min(width * 0.25, 160);
        const badgeWidths = rows.map(row => {
            const { arrow, varText } = this.formatVariance(row);
            return Math.max(60, Math.ceil(this.measureTextWidth(`${arrow} ${varText}`, badgeFontSize, badgeFontFamily, badgeWeight)) + 20);
        });
        const badgeWidth = showBadge ? Math.max(...badgeWidths) + 12 : 0;
        const chartLeft = margin.left + categoryWidth;
        const chartRight = width - margin.right - badgeWidth;
        const chartWidth = chartRight - chartLeft;
        const captionFamily = "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
        const captionWidth = showLabels
            ? this.measureTextWidth(thenLabelText, endpointLabelFontSize, captionFamily, endpointLabelBold ? "700" : "400")
                + this.measureTextWidth(nowLabelText, endpointLabelFontSize, captionFamily, endpointLabelBold ? "700" : "600") + 12
            : 0;
        const valueWidths = rows.map(row =>
            this.measureTextWidth(this.formatRowValue(row.thenValue, row), thenFontSize, thenFontFamily, thenWeightBase)
            + this.measureTextWidth(this.formatRowValue(row.nowValue, row), valFontSize, valueFontFamily, valueWeight) + 12);
        if (chartWidth < Math.max(dotRadius * 2 + 16, captionWidth, ...valueWidths)) {
            this.svg.append("title").text("Not enough space to show comparison");
            if (width >= 180 && this.scrollContainer.node().clientHeight - this.titleEl.offsetHeight >= 24) {
                this.svg.append("text").attr("x", width / 2).attr("y", 18)
                    .attr("text-anchor", "middle").attr("font-size", "12px")
                    .attr("fill", valColor).text("Not enough space");
            }
            return false;
        }

        // Vertical layout
        const labelRowHeight = showLabels ? Math.max(12, endpointLabelFontSize + 4) : 0;
        const valueRowHeight = Math.max(valFontSize, thenFontSize) + 4;
        const dumbbellHeight = Math.max(dotRadius * 2 + 4, trackHeight + 8);
        const singleRowHeight = catFontSize + 4 + dumbbellHeight + valueRowHeight + labelRowHeight;
        const totalRowHeight = singleRowHeight + rowSpacing;

        // Scale: shared across rows, or independent per category
        const axisCard = this.formattingSettings.axisCard;
        const axisMode = (axisCard.axisMode.value?.value as string) || "shared";
        const perCatPadPct = clamp(axisCard.perCategoryPadding.value, 0, 200) / 100;
        const xRange: [number, number] = [dotRadius + 2, chartWidth - dotRadius - 2];

        // Custom axis min/max (blank = auto, D-06): both must parse to a
        // finite pair with max > min, otherwise falls back to the
        // existing auto-computed domain unchanged.
        const customMinRaw = parseFloat(axisCard.customAxisMin.value || "");
        const customMaxRaw = parseFloat(axisCard.customAxisMax.value || "");
        const hasCustomDomain = Number.isFinite(customMinRaw) && Number.isFinite(customMaxRaw) && customMaxRaw > customMinRaw;

        const sharedScale = (() => {
            if (hasCustomDomain) {
                return scaleLinear().domain([customMinRaw, customMaxRaw]).range(xRange);
            }
            // The target-range band is part of the plotted content, so its
            // bounds MUST enter the domain. They used to be excluded, so a band
            // extending past the now/then extent — the normal case, since a
            // target is usually beyond where you currently are — scaled to an x
            // greater than chartWidth and pushed the SVG wider than the scroll
            // container, giving a permanent horizontal scrollbar (Neil,
            // 2026-07-30, the moment the roles were first bound).
            const allValues = rows.flatMap(r => [
                r.nowValue, r.thenValue,
                ...(r.targetRangeLow !== null ? [r.targetRangeLow] : []),
                ...(r.targetRangeHigh !== null ? [r.targetRangeHigh] : []),
            ]);
            const minVal = Math.min(...allValues);
            const maxVal = Math.max(...allValues);
            const pad = (maxVal - minVal) * 0.08 || 1;
            return scaleLinear().domain([minVal - pad, maxVal + pad]).range(xRange);
        })();

        const scaleForRow = (row: MetricRow) => {
            if (axisMode !== "perCategory") return sharedScale;
            // Per-category mode has the same requirement as the shared scale:
            // include the row's target band or it plots outside its own axis.
            const rowVals = [row.nowValue, row.thenValue,
                ...(row.targetRangeLow !== null ? [row.targetRangeLow] : []),
                ...(row.targetRangeHigh !== null ? [row.targetRangeHigh] : [])];
            const lo = Math.min(...rowVals);
            const hi = Math.max(...rowVals);
            const span = hi - lo;
            // Pad either side. When Now == Then, fall back to a magnitude-based pad
            // so the dot still lands centred rather than at a degenerate domain edge.
            const pad = span > 0 ? span * perCatPadPct : (Math.abs(hi) * perCatPadPct || 1);
            return scaleLinear().domain([lo - pad, hi + pad]).range(xRange);
        };

        // Helper for tooltip value formatting
        const fmtRowVal = (v: number, row: MetricRow): string => this.formatRowValue(v, row);

        // ── v2 numeric axis gridlines (Shared axis mode only — Independent
        // per-category has no single scale to tick against; matches the
        // Progress Bar Card precedent of confining new v2 chrome to the
        // layout/mode the design board actually specifies). Rendered
        // BEFORE the row list so tracks/dots paint above the faint lines.
        const gridRowsHeight = rows.length * totalRowHeight;
        const showGridlines = axisCard.showAxisGridlines.value && axisMode === "shared";
        let lastTickRight = chartLeft - 8;
        const gridTickValues = showGridlines ? sharedScale.ticks(6).filter(value => {
            const x = chartLeft + sharedScale(value);
            const half = this.measureTextWidth(fmtRowVal(value, rows[0]), 10.5, captionFamily, "600") / 2;
            if (x - half < lastTickRight + 8 || x + half > chartRight) return false;
            lastTickRight = x + half;
            return true;
        }) : [];
        if (showGridlines) {
            const gridColor = this.isHighContrast ? this.highContrastForeground : surfaceTokens(theme).border;
            gridTickValues.forEach((v) => {
                this.svg.append("line")
                    .classed("axis-gridline", true)
                    .attr("x1", chartLeft + sharedScale(v)).attr("x2", chartLeft + sharedScale(v))
                    .attr("y1", margin.top).attr("y2", margin.top + gridRowsHeight)
                    .attr("stroke", gridColor)
                    .attr("stroke-width", 1)
                    .attr("opacity", this.isHighContrast ? 1 : 0.7);
            });
        }

        // Render each row
        rows.forEach((row, idx) => {
            const yBase = margin.top + idx * totalRowHeight;
            const delay = animate ? idx * staggerDelay : 0;
            const dur = animate ? animDuration : 0;

            const instanceObjects = this.categoricalCategories?.objects?.[row.categoryIndex];
            const resolvedPositiveColor = this.isHighContrast
                ? this.highContrastForeground
                : (this.positiveColorHelper?.getColorForMeasure(instanceObjects, "nowValue") ?? positiveColor);
            const dirColor = row.direction === "positive" ? resolvedPositiveColor
                : row.direction === "negative" ? negativeColor : neutralColor;
            // #819: a forced Codex mode also arms the readability guard that
            // the automatic direction colour already gets — the guard only
            // ever applies to the TEXT (endpoint caption, badge label); the
            // mark itself keeps whatever colour the user or the fx rule chose.
            const automaticDirection = inkOverride || (row.direction === "positive"
                ? comp.positiveColor.value.value === "#007064" && !instanceObjects?.comparisonSettings?.positiveColor
                : row.direction === "negative" ? comp.negativeColor.value.value === "#e60e22"
                    : comp.neutralColor.value.value === "#5e5d5a");

            const g = this.svg.append("g")
                .datum(row)
                .classed("metric-row", true)
                .attr("tabindex", 0)
                .attr("role", "button")
                .attr("aria-label", `${row.category}; ${thenLabelText} ${fmtRowVal(row.thenValue, row)}; ${nowLabelText} ${fmtRowVal(row.nowValue, row)}; Change ${this.formatVariance(row).varText}`)
                .style("color", catColor)
                .attr("transform", `translate(0, ${yBase})`);

            // Invisible hit rect for tooltip and cross-filter
            g.append("rect")
                .attr("x", 0).attr("y", 0)
                .attr("width", width)
                .attr("height", singleRowHeight)
                .attr("fill", "transparent")
                .style("cursor", "pointer");

            // Tooltip on row hover
            const rowRef = row;
            const tooltipSvc = this.tooltipService;
            g.on("mousemove", function (event: MouseEvent) {
                const items: VisualTooltipDataItem[] = [
                    { displayName: "Category", value: rowRef.category },
                    { displayName: nowLabelText, value: fmtRowVal(rowRef.nowValue, rowRef) },
                    { displayName: thenLabelText, value: fmtRowVal(rowRef.thenValue, rowRef) },
                    { displayName: "Change", value: rowRef.changePct === null
                        ? NO_VALUE
                        : (rowRef.change >= 0 ? "+" : "") + rowRef.changePct.toFixed(1) + "%" }
                ];
                tooltipSvc.show({
                    coordinates: [event.clientX, event.clientY],
                    isTouchEvent: false,
                    dataItems: items,
                    identities: rowRef.selectionId ? [rowRef.selectionId] : []
                });
            });
            g.on("mouseleave", function () {
                tooltipSvc.hide({ isTouchEvent: false, immediately: false });
            });

            // Cross-filter on click
            const selMgr = this.selectionManager;
            g.on("click", function (event: MouseEvent) {
                if (rowRef.selectionId) {
                    selMgr.select(rowRef.selectionId, event.ctrlKey || event.metaKey);
                }
                event.stopPropagation();
            });
            g.on("keydown", function (event: KeyboardEvent) {
                if (event.key === "Enter" || event.key === " ") {
                    if (rowRef.selectionId) selMgr.select(rowRef.selectionId, event.ctrlKey || event.metaKey);
                } else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
                    const bounds = this.getBoundingClientRect();
                    selMgr.showContextMenu(rowRef.selectionId || {}, { x: bounds.x + 8, y: bounds.y + 8 });
                } else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
                    const targets = Array.from(this.parentElement.querySelectorAll<SVGGElement>(".metric-row"));
                    const index = targets.indexOf(this);
                    const next = event.key === "Home" ? 0 : event.key === "End" ? targets.length - 1
                        : clamp(index + (event.key === "ArrowUp" ? -1 : 1), 0, targets.length - 1);
                    targets[next]?.focus();
                } else {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
            });

            // ── Category name ──
            const categoryLabel = g.append("text")
                .attr("x", margin.left)
                .attr("y", catFontSize)
                .attr("font-size", catFontSize + "px")
                .attr("font-weight", categoryWeight)
                .attr("font-style", categoryStyle)
                .attr("text-decoration", categoryDecoration)
                .attr("fill", catColor)
                .attr("font-family", categoryFontFamily)
                .text(row.category);
            this.fitCategoryLabel(categoryLabel.node(), categoryWidth - 8);

            // ── Dumbbell area ──
            const dumbbellY = catFontSize + 8 + labelRowHeight + dumbbellHeight / 2;

            // Background track — the v2 board's own "dim track" default
            // (settings.ts trackColor now ships the v3 dim-surface token)
            // means this no longer needs an extra 0.5 alpha multiply on
            // top; a user-set bright override still reads at full
            // strength (D-16).
            g.append("rect")
                .attr("x", chartLeft)
                .attr("y", dumbbellY - trackHeight / 2)
                .attr("width", chartWidth)
                .attr("height", trackHeight)
                .attr("rx", trackHeight / 2)
                .attr("fill", trackColor)
                .attr("opacity", 1);

            // Mark coordinates always represent the scale; only labels may move.
            const rowScale = scaleForRow(row);

            // ── Per-row target range band (violet target token, §2) ──
            // Only when BOTH Target Range Low/High are bound for this row
            // and the toggle is on — absent data renders nothing (matches
            // the design's own norange/no-data-bound behaviour).
            if (axisCard.showTargetRange.value && row.targetRangeLow !== null && row.targetRangeHigh !== null) {
                // Clamp to the plot box as well as widening the domain above:
                // belt and braces, so no future data shape can push the band
                // past the container and reintroduce the scrollbar.
                const clampX = (x: number) => Math.max(chartLeft, Math.min(chartLeft + chartWidth, x));
                const rngLo = clampX(chartLeft + rowScale(Math.min(row.targetRangeLow, row.targetRangeHigh)));
                const rngHi = clampX(chartLeft + rowScale(Math.max(row.targetRangeLow, row.targetRangeHigh)));
                // The target band is a painted surface too: its violet token is
                // a hue the HC palette never authorised, so in high contrast it
                // routes to the system foreground like every other mark here
                // (NEXUS cycle-09 §5, same class — found by the literal/token
                // sweep, not by the report's own text-colour probes).
                const tgt = hc.active ? hc.color : targetToken(theme);
                g.append("rect")
                    .attr("x", rngLo)
                    .attr("y", dumbbellY - dumbbellHeight / 2 + 2)
                    .attr("width", Math.max(0, rngHi - rngLo))
                    .attr("height", dumbbellHeight - 4)
                    .attr("rx", 3)
                    .attr("fill", tgt)
                    .attr("opacity", 0.15);
                [rngLo, rngHi].forEach((x) => {
                    g.append("line")
                        .attr("x1", x).attr("x2", x)
                        .attr("y1", dumbbellY - dumbbellHeight / 2 + 2)
                        .attr("y2", dumbbellY + dumbbellHeight / 2 - 2)
                        .attr("stroke", tgt)
                        .attr("stroke-width", 1.5);
                });
            }

            const thenX = chartLeft + rowScale(row.thenValue);
            const nowX = chartLeft + rowScale(row.nowValue);

            const leftX = Math.min(thenX, nowX);
            const rightX = Math.max(thenX, nowX);
            const dotsClose = Math.abs(nowX - thenX) < 60;
            const thenOnLeft = thenX <= nowX;
            const thenTextX = thenX + (dotsClose ? (thenOnLeft ? -4 : 4) : 0);
            const nowTextX = nowX + (dotsClose ? (thenOnLeft ? 4 : -4) : 0);

            // ── Animated connector line — opacity settles at 55% (§2 board
            // note: "reads as travel, not a bar") ──
            const connector = g.append("line")
                .attr("y1", dumbbellY).attr("y2", dumbbellY)
                .attr("stroke", dirColor)
                .attr("stroke-width", connectorWidth)
                .attr("stroke-linecap", "round");

            if (dur > 0) {
                connector
                    .attr("x1", thenX).attr("x2", thenX)
                    .attr("opacity", 0)
                    .transition()
                    .delay(delay)
                    .duration(dur * 0.3)
                    .attr("opacity", 0.55)
                    .transition()
                    .duration(dur * 0.7)
                    .attr("x1", leftX).attr("x2", rightX);
            } else {
                connector.attr("x1", leftX).attr("x2", rightX).attr("opacity", 0.55);
            }

            // (v2 design: the 55%-opacity connector IS the "travel" — no
            // chevron arrow; removed 2026-07-13 to match the design board.)

            // ── Then dot: HOLLOW RING (baseline) — a muted/unit-token
            // stroke on the card surface colour, deliberately NOT
            // direction-tinted, so the beveled glow "now" dot always
            // dominates (§2 board language). ──
            const thenRingColor = hc.active ? hc.color : this.secondaryInk();
            const thenFillColor = hc.active ? hc.background : this.currentSurface;
            const thenDot = g.append("circle")
                .attr("cx", thenX).attr("cy", dumbbellY)
                .attr("r", dotRadius)
                .attr("fill", thenFillColor)
                .attr("stroke", thenRingColor)
                .attr("stroke-width", 2.5);

            if (dur > 0) {
                thenDot.attr("r", 0).attr("opacity", 0)
                    .transition().delay(delay).duration(dur * 0.3)
                    .attr("r", dotRadius).attr("opacity", 1);
            }

            // ── Now dot: beveled, band/direction-tinted, glowing —
            // gauge-hub language flattened to a chart (§2/§4). A per-row
            // <radialGradient> def (id keyed by row index — the colour
            // can vary per row via the fx-resolved dirColor) gives the
            // "circle at 35% 30%" bevel highlight. `this.gradientDefs`
            // is torn down and recreated fresh at the top of every
            // update() (svg.selectAll("*").remove() also clears <defs>),
            // so each row's gradient is (re)built here every render — no
            // stale defs to reuse. HC swaps to a flat system-slot fill
            // with no glow (§8).
            const nowGradId = `nvt-now-grad-${idx}`;
            if (!hc.active) {
                const grad = this.gradientDefs.append("radialGradient")
                    .attr("id", nowGradId)
                    .attr("cx", "35%").attr("cy", "30%").attr("r", "75%");
                grad.append("stop").attr("offset", "0%").attr("stop-color", mix(dirColor, "#ffffff", 0.35));
                grad.append("stop").attr("offset", "55%").attr("stop-color", dirColor);
                grad.append("stop").attr("offset", "100%").attr("stop-color", mix(dirColor, "#000000", 0.55));
            }
            const nowFill = hc.active ? hc.color : `url(#${nowGradId})`;
            // #819 glow site: Neon hands this marker the card's glow budget
            // and, in "Flare colour only" scope, the flare hue — the BEVEL
            // fill stays the direction colour either way, because the
            // good/bad reading is data, not decoration. Outside Neon the
            // shipped dark-only 55 / light-only 0 budget is unchanged, and
            // high contrast still gets no glow at all (§8).
            const glowMix = hc.active ? 0 : codex?.neon ? codex.glow : (theme === "dark" ? 55 : 0);
            const glowHex = flare(dirColor);
            const nowDot = g.append("circle")
                .attr("cx", nowX).attr("cy", dumbbellY)
                .attr("r", dotRadius + 1)
                .attr("fill", nowFill)
                // The bevel's white ring is chrome, not data: under Neon with
                // "Flare colour only" it takes the flare hue, because a white
                // ring swallowed a #ac74da flare at glowStrength 55 and the
                // marker read as un-flared. `flare()` returns "#ffffff"
                // unchanged in every other mode and in "All selected colours"
                // scope — white glows in its own hue there.
                .attr("stroke", hc.active ? hc.color : flare("#ffffff"))
                .attr("stroke-width", hc.active ? hc.borderWidth : 2)
                .style("filter", glowMix > 0
                    ? (codex?.neon
                        ? neonFilter(glowHex, glowMix)
                        : `drop-shadow(0 0 6px color-mix(in srgb, ${glowHex} ${glowMix}%, transparent))`)
                    : "none");

            if (dur > 0) {
                nowDot.attr("r", 0).attr("opacity", 0)
                    .transition().delay(delay + dur * 0.7).duration(dur * 0.3)
                    .attr("r", dotRadius + 1).attr("opacity", 1);
            }

            // ── Value format helper — per-row format overrides global ──
            const fmtVal = (v: number): string => fmtRowVal(v, row);

            // ── Labels above dots: "Then" label + value, "Now" label + value ──
            const labelY = dumbbellY - dotRadius - 6;

            if (showLabels) {
                // Anchor labels away from each other when dots are close
                const thenLblAnchor = dotsClose ? (thenOnLeft ? "end" : "start") : "middle";
                const nowLblAnchor = dotsClose ? (thenOnLeft ? "start" : "end") : "middle";

                // High contrast wins over the user's Endpoint Label Color, the
                // same way the badge and the numeric values already yield to it
                // (NEXUS cycle-09 §5): a black override on the black HC canvas
                // painted both captions invisible, because the override was
                // applied AFTER the HC colours had been resolved.
                // #819: an explicit endpoint-label colour is still the user's
                // choice, so a forced Codex mode does not replace it — it only
                // runs it through readableInk(), which returns the colour
                // unchanged whenever it already clears 4.5:1 on the Codex
                // surface and flips it to black/white only when it would
                // otherwise vanish into that surface.
                const endpointOverrideInk = endpointLabelColorOverride && inkOverride
                    ? this.readableInk(endpointLabelColorOverride) : endpointLabelColorOverride;
                const thenFill = this.isHighContrast
                    ? this.highContrastForeground
                    : (endpointOverrideInk || neutralColor);
                const nowFill = this.isHighContrast
                    ? this.highContrastForeground
                    : (endpointOverrideInk || (automaticDirection ? this.readableInk(dirColor) : dirColor));
                const thenWeight = endpointLabelBold ? "700" : "400";
                const nowWeight = endpointLabelBold ? "700" : "600";

                const thenLbl = g.append("text")
                    .attr("x", thenTextX).attr("y", labelY)
                    .attr("text-anchor", thenLblAnchor)
                    .attr("font-size", endpointLabelFontSize + "px")
                    .attr("font-weight", thenWeight)
                    .attr("fill", thenFill)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                    .text(thenLabelText);

                const nowLbl = g.append("text")
                    .attr("x", nowTextX).attr("y", labelY)
                    .attr("text-anchor", nowLblAnchor)
                    .attr("font-size", endpointLabelFontSize + "px")
                    .attr("font-weight", nowWeight)
                    .attr("fill", nowFill)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                    .text(nowLabelText);
                this.fitTextPair(thenLbl.node(), nowLbl.node(), thenOnLeft, chartLeft + 2, chartRight - 2);

                if (dur > 0) {
                    thenLbl.attr("opacity", 0).transition().delay(delay).duration(dur * 0.3).attr("opacity", 1);
                    nowLbl.attr("opacity", 0).transition().delay(delay + dur * 0.7).duration(dur * 0.3).attr("opacity", 1);
                }
            }

            // ── Value labels below dots ──
            const valY = dumbbellY + dotRadius + Math.max(valFontSize, thenFontSize) + 4;

            // Then value: anchor away from Now to avoid overlap
            const thenAnchor = dotsClose ? (thenOnLeft ? "end" : "start") : "middle";
            const thenValText = g.append("text")
                .attr("x", thenTextX).attr("y", valY)
                .attr("text-anchor", thenAnchor)
                .attr("font-size", thenFontSize + "px")
                .attr("font-weight", thenWeightBase)
                .attr("font-style", thenStyleBase)
                .attr("text-decoration", thenDecoration)
                .attr("fill", thenValueColor)
                .attr("opacity", 1)
                .attr("font-family", thenFontFamily)
                .style("font-feature-settings", TABULAR_NUMS)
                .text(fmtVal(row.thenValue));

            // Now value: anchor away from Then. Colour resolves via fx
            // (valueColorHelper, TEXT-02) against this row's own per-
            // instance object overrides, falling back to the static Value
            // Color swatch when no rule is bound.
            const resolvedNowValueColor = this.isHighContrast
                ? this.highContrastForeground
                : (this.valueColorHelper?.getColorForMeasure(instanceObjects, "nowValue") ?? valColor);
            const nowAnchor = dotsClose ? (thenOnLeft ? "start" : "end") : "middle";
            const nowValText = g.append("text")
                .attr("x", nowTextX).attr("y", valY)
                .attr("text-anchor", nowAnchor)
                .attr("font-size", valFontSize + "px")
                .attr("font-weight", valueWeight)
                .attr("font-style", valueStyle)
                .attr("text-decoration", valueDecoration)
                .attr("fill", resolvedNowValueColor)
                .attr("font-family", valueFontFamily)
                .style("font-feature-settings", TABULAR_NUMS)
                .text(fmtVal(row.nowValue));
            this.fitTextPair(thenValText.node(), nowValText.node(), thenOnLeft, chartLeft + 2, chartRight - 2);

            // v3 motion (§6): the Then/Now value text settles via the
            // shared settle() helper (capped at MOTION_MAX_MS, skipped
            // under prefers-reduced-motion internally) rather than the
            // bespoke d3-transition stagger used for the connector/dots/
            // labels above — this is the visual's literal "value settle"
            // moment, matching the KPI/Sparkline/Progress-Bar-Card
            // precedent of calling settle() directly on a value node.
            if (dur > 0) {
                settle(thenValText.node() as unknown as SVGElement, [
                    { opacity: 0, transform: "translateY(3px)" },
                    { opacity: 1, transform: "translateY(0)" },
                ], { duration: Math.min(220, dur) });
                settle(nowValText.node() as unknown as SVGElement, [
                    { opacity: 0, transform: "translateY(3px)" },
                    { opacity: 1, transform: "translateY(0)" },
                ], { duration: Math.min(220, dur) });
            }

            // ── Variance badge ──
            if (showBadge) {
                const badgeX = chartRight + 12;
                const badgeY = dumbbellY;

                // Build variance text
                // Arrow reflects raw numeric movement (Now vs Then), independent of
                // the good/bad colour semantics. e.g. a downIsGood metric trending up
                // shows \u25B2 in red \u2014 value went up, but that's bad for this metric.
                // No baseline (Then is zero) -> no percentage. When the
                // percentage is the ONLY thing this badge carries, the badge
                // has nothing to report: em-dash, no arrow, neutral ink
                // (NEXUS cycle-09 \u00A71). In absolute/both mode the raw change is
                // still a real reading, so it keeps its arrow and direction
                // colour and only the percent slot goes to the em-dash.
                const { varText, arrow, noBaselineOnly } = this.formatVariance(row);
                const badgeDirColor = noBaselineOnly ? neutralColor : dirColor;

                // Badge background pill
                const pillWidth = badgeWidths[idx];
                const pillHeight = badgeFontSize + 10;

                const pill = g.append("rect")
                    .attr("x", badgeX)
                    .attr("y", badgeY - pillHeight / 2)
                    .attr("width", pillWidth)
                    .attr("height", pillHeight)
                    .attr("rx", pillHeight / 2)
                    .attr("fill", badgeDirColor)
                    .attr("opacity", 0.12);
                // #819 glow site (NEW — this chip had no glow before): Neon
                // flares the delta CHIP'S EDGE, not its label and not its
                // 12%-opacity fill. Measured at glowStrength 55: a drop-shadow
                // cast by a 12%-opacity rect is a diffuse haze behind the
                // badge, not a flare — a full-strength hairline outline
                // carrying the same filter reads as a chip at every budget.
                // The badge text is body-sized and this visual has no
                // headline, so nothing here earns a text glow.
                let pillEdge: typeof pill | null = null;
                if (codex?.neon && !hc.active) {
                    const edgeHex = flare(badgeDirColor);
                    pillEdge = g.append("rect")
                        .attr("x", badgeX)
                        .attr("y", badgeY - pillHeight / 2)
                        .attr("width", pillWidth)
                        .attr("height", pillHeight)
                        .attr("rx", pillHeight / 2)
                        .attr("fill", "none")
                        .attr("stroke", edgeHex)
                        .attr("stroke-width", 1.25)
                        .style("filter", neonFilter(edgeHex, codex.glow));
                }

                // Badge text — badgeColorOverride follows the same "empty =
                // use the derived direction colour" idiom as
                // endpointLabelColorOverride above (D-06 default preserves
                // the existing dirColor-per-row behaviour exactly).
                const badgeSurface = compositeOver(badgeDirColor, 88, this.currentSurface);
                const automaticBadge = noBaselineOnly ? comp.neutralColor.value.value === "#5e5d5a" : automaticDirection;
                // #819: same treatment as the endpoint-label override — a
                // forced mode guards an explicit badge ink against the badge's
                // own composited pill surface rather than overwriting it.
                const badgeOverrideInk = badgeColorOverride && inkOverride
                    ? this.readableInk(badgeColorOverride, badgeSurface) : badgeColorOverride;
                const badgeFill = this.isHighContrast
                    ? this.highContrastForeground
                    : (badgeOverrideInk || (automaticBadge ? this.readableInk(badgeDirColor, badgeSurface) : badgeDirColor));
                const badgeText = g.append("text")
                    .attr("x", badgeX + pillWidth / 2)
                    .attr("y", badgeY)
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", "central")
                    .attr("font-size", badgeFontSize + "px")
                    .attr("font-weight", badgeWeight)
                    .attr("font-style", badgeStyle)
                    .attr("text-decoration", badgeDecoration)
                    .attr("fill", badgeFill)
                    .attr("font-family", badgeFontFamily)
                    .style("font-feature-settings", TABULAR_NUMS)
                    .text(`${arrow} ${varText}`);

                if (dur > 0) {
                    pill.attr("opacity", 0)
                        .transition().delay(delay + dur * 0.85).duration(dur * 0.3)
                        .attr("opacity", 0.12);
                    // The Neon edge settles on the same beat as the chip it outlines.
                    if (pillEdge) {
                        pillEdge.attr("opacity", 0)
                            .transition().delay(delay + dur * 0.85).duration(dur * 0.3)
                            .attr("opacity", 1);
                    }
                    badgeText.attr("opacity", 0)
                        .transition().delay(delay + dur * 0.85).duration(dur * 0.3)
                        .attr("opacity", 1);
                }
            }
        });

        // Numeric axis tick labels — one row below the last category row,
        // above any axis-title caption (Shared axis mode only, see the
        // gridlines block above).
        if (showGridlines) {
            const tickColor = this.isHighContrast ? this.highContrastForeground : this.secondaryInk();
            const tickY = margin.top + gridRowsHeight + 12;
            gridTickValues.forEach((v) => {
                this.svg.append("text")
                    .classed("axis-tick-label", true)
                    .attr("x", chartLeft + sharedScale(v))
                    .attr("y", tickY)
                    .attr("text-anchor", "middle")
                    .attr("font-size", "10.5px")
                    .attr("font-weight", "600")
                    .attr("fill", tickColor)
                    .style("font-feature-settings", TABULAR_NUMS)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                    .text(fmtRowVal(v, rows[0]));
            });
        }

        // Axis titles (X = value scale, Y = categories)
        if (showAxisTitles) {
            const axisTitleFontSize = catFontSize;
            const titleColor = this.isHighContrast ? this.highContrastForeground : valColor;
            if (xAxisTitleText) {
                this.svg.append("text")
                    .classed("axis-title x-axis-title", true)
                    .attr("x", chartLeft + chartWidth / 2)
                    .attr("y", this.computeContentHeight(rows) - 2)
                    .attr("text-anchor", "middle")
                    .attr("font-size", axisTitleFontSize + "px")
                    .attr("font-weight", "600")
                    .attr("fill", titleColor)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                    .text(xAxisTitleText);
            }
            if (yAxisTitleText) {
                const chartMidY = margin.top + (rows.length * totalRowHeight) / 2;
                this.svg.append("text")
                    .classed("axis-title y-axis-title", true)
                    .attr("x", -chartMidY)
                    .attr("y", 12)
                    .attr("text-anchor", "middle")
                    .attr("transform", "rotate(-90)")
                    .attr("font-size", axisTitleFontSize + "px")
                    .attr("font-weight", "600")
                    .attr("fill", titleColor)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                    .text(yAxisTitleText);
            }
        }
        return true;
    }

    // ─── Visual Title (TITLE-01, D-13/D-14) — sourced from the shared
    // _shared/formatting/titleSettings.ts card. Rendered as a plain HTML
    // div (this.titleEl, created in the constructor before this.svg) so it
    // sits in normal document flow above the chart, never as an
    // absolutely-positioned overlay that could swallow empty-space
    // right-clicks (T-11-01).
    private renderTitle(): void {
        const t = this.formattingSettings.titleSettings;
        if (t?.showTitle?.value && t?.titleText?.value) {
            const titleAlignVal = String((t as any).titleAlign?.value || "left");
            this.titleEl.textContent = String(t.titleText.value);
            if (t.titleFontFamily?.value) this.titleEl.style.fontFamily = t.titleFontFamily.value;
            if (typeof t.titleFontSize?.value === "number") this.titleEl.style.fontSize = `${t.titleFontSize.value}px`;
            this.titleEl.style.fontWeight = t.titleBold?.value ? "700" : "400";
            this.titleEl.style.fontStyle = t.titleItalic?.value ? "italic" : "normal";
            this.titleEl.style.textDecoration = t.titleUnderline?.value ? "underline" : "none";
            this.titleEl.style.alignSelf = alignSelfFor(titleAlignVal);
            this.titleEl.style.textAlign = textAlignFor(titleAlignVal);
            // Adaptive default (D-16 sentinel): untouched shared-Title navy
            // swaps to the dark text token on dark surfaces.
            const setTitle = t.titleColor?.value?.value ?? "#1a1a2e";
            // #819 ink site: a forced Codex mode owns the title ink against
            // its own surface, exactly as it owns the row inks.
            const adaptiveTitle = (this.codex && this.codex.mode !== "auto") || setTitle === "#1a1a2e"
                ? this.readableInk(this.currentTheme === "dark" ? surfaceTokens("dark").text : setTitle) : setTitle;
            this.titleEl.style.color = this.isHighContrast
                ? this.highContrastForeground
                : adaptiveTitle;
            this.titleEl.style.padding = "8px 12px 4px";
            this.titleEl.style.overflowWrap = "anywhere";
            this.titleEl.style.display = "";
        } else {
            this.titleEl.style.display = "none";
        }
    }

    private renderEmpty(width: number, height: number, theme: Theme = "dark"): void {
        this.svg.attr("width", width).attr("height", height);
        const fillColor = this.isHighContrast ? this.highContrastForeground : this.secondaryInk();
        this.svg.append("text")
            .attr("x", width / 2).attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "central")
            .attr("font-size", "14px")
            .attr("fill", fillColor)
            .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
            .text(this.localizationManager.getDisplayName("Visual_EmptyState"));
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        this.formattingSettings.codexTheme.reveal();
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    public destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        // Drop the in-flight licence check FIRST: its redraw callback replays
        // update() against a torn-down target otherwise (NEXUS lifecycle finding).
        this.licenseGate.dispose();
        this.lastUpdateOptions = null;
        this.previousData = "";
        this.target.removeEventListener("contextmenu", this.contextMenuHandler);
        this.scrollContainer.node()?.removeEventListener("contextmenu", this.contextMenuHandler);
        this.svg.node()?.getAnimations({ subtree: true }).forEach(animation => animation.cancel());
        this.svg.selectAll("*").interrupt().on("mousemove mouseleave click keydown", null).remove();
        this.svg.interrupt();
        this.tooltipService.hide({ isTouchEvent: false, immediately: true });
        this.cornerSignature?.destroy();
        this.cornerSignature = null;
        this.scrollContainer.remove();
        this.scrollContainer = null;
        this.titleEl = null;
        this.gradientDefs = null;
        this.borderRect = null;
        this.categoricalCategories = undefined;
        this.codex = null;
        this.positiveColorHelper = null;
        this.valueColorHelper = null;
        this.svg = null;
        this.target = null;
    }
}
