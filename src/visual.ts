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
import { toRgba } from "./shared/colorHelpers";

// v3 appearance engine (frozen, 01-15) — band engine (direction-law
// tokens + the violet target/accent markers), design tokens (dim-theme
// surfaces + channel-linear mix()), the corner-bracket card signature,
// the capped/reduced-motion-aware settle() helper, and the single HC
// fallback rule. Consumed read-only (D-11).
import { Theme, accentToken, targetToken } from "./shared/bandEngine";
import { mix, surfaceTokens, TABULAR_NUMS } from "./shared/designTokens";
import { makeCornerBrackets, CardSignatureHandle } from "./shared/cardSignature";
import { settle, MOTION_MAX_MS } from "./shared/motion";
import { applyHighContrast } from "./shared/highContrast";

interface MetricRow {
    category: string;
    nowValue: number;
    thenValue: number;
    sortOrder: number | null;
    change: number;
    changePct: number;
    rowFormat: string | null;       // "number" | "currency" | "percent" | null (use global)
    rowDirection: string | null;    // "upIsGood" | "downIsGood" | null (default upIsGood)
    direction: "positive" | "negative" | "neutral";
    selectionId: ISelectionId | null;
    categoryIndex: number;
    targetRangeLow: number | null;
    targetRangeHigh: number | null;
}

/** Luminance-based theme pick (matches the pbiKpiCard/pbiProgressBarCard
 * v3 pilots' own convention) — only trusts bgHex as a real signal when
 * the background layer is actually visible (transparency < 100);
 * otherwise defaults dark (this visual's pre-existing default is fully
 * transparent, D-06). */
function themeFor(hex: string, visible: boolean): Theme {
    if (!visible) return "dark";
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})/i.exec(hex || "");
    if (!m) return "dark";
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? "light" : "dark";
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
    private formattingSettings: VisualFormattingSettingsModel;
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

    // Gradient-def bookkeeping so the beveled "now" dot's SVG
    // <radialGradient> defs are only (re)created once per row per
    // update(), not per attribute read.
    private gradientDefs: Selection<SVGDefsElement, unknown, null, undefined>;

    constructor(options: VisualConstructorOptions) {
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
            .style("overflow", "auto")
            .style("position", "relative");

        // Context menu. Listener on target AND on the inner scrollContainer —
        // the scrollContainer's padding/scroll-gutter regions don't bubble
        // contextmenu events reliably in PBI's sandbox, so a direct listener
        // is required to cover right-clicks in empty padding (Policy 1180.2.5).
        const ctxHandler = (e: MouseEvent) => {
            this.selectionManager.showContextMenu({}, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        };
        this.target.addEventListener("contextmenu", ctxHandler);
        (this.scrollContainer.node() as HTMLElement).addEventListener("contextmenu", ctxHandler);

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
        this.eventService.renderingStarted(options);

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

            const width = options.viewport.width;
            const height = options.viewport.height;
            // Set viewport size on scroll container
            this.scrollContainer.style("width", width + "px").style("height", height + "px");

            // Clear (re-creates <defs> below — selectAll("*") also removes it)
            this.svg.selectAll("*").remove();
            this.gradientDefs = this.svg.append("defs") as unknown as
                Selection<SVGDefsElement, unknown, null, undefined>;

            // ─── v3 theme pick + single HC fallback rule, computed once
            // and reused everywhere colour is resolved below (§8, D-16:
            // this visual's own Background card is the source of truth
            // for whether the card reads as a dark or light surface).
            const bgSettingsForTheme = this.formattingSettings.background;
            const bgHexForTheme = bgSettingsForTheme.backgroundColor.value?.value ?? "#ffffff";
            const bgTransparencyForTheme = bgSettingsForTheme.transparency.value ?? 100;
            const theme: Theme = themeFor(bgHexForTheme, bgTransparencyForTheme < 100);
            const hc = applyHighContrast(colorPalette, { fallbackColor: accentToken(theme) });

            // Corner-bracket re-tint each update (created once in the constructor).
            this.cornerSignature?.update(hc.active ? hc.color : accentToken(theme), {
                variant: "cornerBracket",
                mirror: true,
                glowMix: hc.active ? 0 : (theme === "dark" ? 55 : 0),
                muted: false,
            });

            this.categoricalCategories = dataView?.categorical?.categories?.[0];

            const rows = this.parseData(dataView);
            if (rows.length === 0) {
                this.titleEl.style.display = "none";
                this.cornerSignature?.update(hc.active ? hc.color : accentToken(theme), {
                    variant: "cornerBracket", mirror: true, muted: true,
                });
                this.renderEmpty(width, height, theme);
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
            positiveColorSlice.altConstantSelector = rows[0]?.selectionId
                ? rows[0].selectionId.getSelector()
                : undefined;
            this.positiveColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "comparisonSettings", propertyName: "positiveColor" },
                positiveColorSlice.value.value
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
            valueColorSlice.altConstantSelector = rows[0]?.selectionId
                ? rows[0].selectionId.getSelector()
                : undefined;
            this.valueColorHelper = new ColorHelper(
                this.host.colorPalette,
                { objectName: "labelSettings", propertyName: "valueColor" },
                valueColorSlice.value.value
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

            this.renderDumbbell(rows, width, shouldAnimate, showAxisTitles, xAxisTitleText, yAxisTitleText, theme, hc);

            // Size SVG to actual content so scroll container shows scrollbars when needed
            this.svg.attr("width", width).attr("height", this.computeContentHeight(rows));
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
                const n = Number(raw);
                return isNaN(n) ? null : n;
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
            const changePct = thenVal !== 0 ? (change / Math.abs(thenVal)) * 100 : 0;

            // Per-row format and direction from data roles
            const rowFormat = getStr("format");
            const rowDirection = getStr("direction");

            // Determine visual direction based on change sign + downIsGood semantics
            let direction: "positive" | "negative" | "neutral";
            if (Math.abs(change) < 0.001) {
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
        const valueRowHeight = valFontSize + 4;
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

    private renderDumbbell(rows: MetricRow[], width: number, animate: boolean,
        showAxisTitles: boolean = false, xAxisTitleText: string = "", yAxisTitleText: string = "",
        theme: Theme = "dark", hc: ReturnType<typeof applyHighContrast> = applyHighContrast(null)): void {
        const comp = this.formattingSettings.comparisonCard;
        const lbl = this.formattingSettings.labelCard;
        const style = this.formattingSettings.styleCard;

        let positiveColor = comp.positiveColor.value.value;
        let negativeColor = comp.negativeColor.value.value;
        let neutralColor = comp.neutralColor.value.value;
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
        const varianceFmt = (comp.varianceFormat.value?.value as string) || "percent";
        const valueFmt = (comp.valueFormat.value?.value as string) || "auto";
        const decimals = clamp(comp.decimalPlaces.value, 0, 6);

        const catFontSize = clamp(lbl.categoryFontSize.value, 8, 30);
        let catColor = lbl.categoryColor.value.value;
        const valFontSize = clamp(lbl.valueFontSize.value, 8, 24);
        let valColor = lbl.valueColor.value.value;
        const thenFontSize = clamp(lbl.thenFontSize.value, 8, 24);
        let thenValueColor = lbl.thenColor.value.value;
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
        const valueWeight = weightFor(lbl.valueBold.value, "700");
        const valueStyle = lbl.valueItalic.value ? "italic" : "normal";
        const valueDecoration = lbl.valueUnderline.value ? "underline" : "none";

        const thenFontFamily = lbl.thenFontFamily.value || "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
        const thenWeightBase = weightFor(lbl.thenBold.value, "400");
        const thenStyleBase = lbl.thenItalic.value ? "italic" : "normal";
        const thenDecoration = lbl.thenUnderline.value ? "underline" : "none";

        const badgeFontFamily = lbl.badgeFontFamily.value || "Segoe UI, Tahoma, Geneva, Verdana, sans-serif";
        const badgeWeight = weightFor(lbl.badgeBold.value, "700");
        const badgeStyle = lbl.badgeItalic.value ? "italic" : "normal";
        const badgeDecoration = lbl.badgeUnderline.value ? "underline" : "none";

        let bgColor = style.backgroundColor.value.value;
        let trackColor = style.trackColor.value.value;
        const trackHeight = Math.max(1, style.trackHeight.value);
        const rowSpacing = Math.max(4, style.rowSpacing.value);

        // High contrast overrides
        if (this.isHighContrast) {
            bgColor = this.highContrastBackground;
            trackColor = this.highContrastForeground;
            positiveColor = this.highContrastForeground;
            negativeColor = this.highContrastForeground;
            neutralColor = this.highContrastForeground;
            catColor = this.highContrastForeground;
            valColor = this.highContrastForeground;
            thenValueColor = this.highContrastForeground;
        }

        // ─── Dedicated background layer (D-05) ─────────────────────────
        // Suite-wide shared Background card (Colour + Transparency, sourced
        // from _shared/formatting/), painted as the SVG's own first <rect>
        // — never whole-root opacity. This visual's pre-existing
        // styleCard.backgroundColor is left fully intact below (still
        // painted, unchanged) for any old report that set it; the NEW
        // shared card is layered on top of it. Its transparency default is
        // overridden to 100 in settings.ts specifically so an OLD saved
        // report (this property never previously existed) renders alpha 0
        // — pixel-identical to painting nothing (D-06) — while still
        // exposing a real, working Colour + Transparency control.
        const background = this.formattingSettings.background;
        if (!this.isHighContrast) {
            const bgHex = background.backgroundColor.value?.value ?? "#ffffff";
            const bgTransparencyPct = background.transparency.value ?? 100;
            this.svg.append("rect")
                .attr("width", width).attr("height", this.computeContentHeight(rows))
                .attr("fill", toRgba(bgHex, bgTransparencyPct));
        }

        // Pre-existing Style-card background (untouched behaviour, D-06)
        if (bgColor && bgColor.length > 0) {
            this.svg.append("rect")
                .attr("width", width).attr("height", this.computeContentHeight(rows))
                .attr("fill", bgColor);
        }

        // Layout calculations
        const margin = { left: 16, right: 16, top: 12, bottom: 8 };
        const categoryWidth = Math.min(width * 0.25, 160);
        const badgeWidth = showBadge ? Math.min(width * 0.18, 110) : 0;
        const chartLeft = margin.left + categoryWidth;
        const chartRight = width - margin.right - badgeWidth;
        const chartWidth = chartRight - chartLeft;

        // Vertical layout
        const labelRowHeight = showLabels ? Math.max(12, endpointLabelFontSize + 4) : 0;
        const valueRowHeight = valFontSize + 4;
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
            const allValues = rows.flatMap(r => [r.nowValue, r.thenValue]);
            const minVal = Math.min(...allValues);
            const maxVal = Math.max(...allValues);
            const pad = (maxVal - minVal) * 0.08 || 1;
            return scaleLinear().domain([minVal - pad, maxVal + pad]).range(xRange);
        })();

        const scaleForRow = (row: MetricRow) => {
            if (axisMode !== "perCategory") return sharedScale;
            const lo = Math.min(row.nowValue, row.thenValue);
            const hi = Math.max(row.nowValue, row.thenValue);
            const span = hi - lo;
            // Pad either side. When Now == Then, fall back to a magnitude-based pad
            // so the dot still lands centred rather than at a degenerate domain edge.
            const pad = span > 0 ? span * perCatPadPct : (Math.abs(hi) * perCatPadPct || 1);
            return scaleLinear().domain([lo - pad, hi + pad]).range(xRange);
        };

        // Helper for tooltip value formatting
        const fmtRowVal = (v: number, row: MetricRow): string => {
            const effectiveFmt = row.rowFormat || valueFmt;
            if (effectiveFmt === "percent") return v.toFixed(decimals) + "%";
            if (effectiveFmt === "currency") return "$" + formatValue(v, "auto", decimals);
            if (effectiveFmt === "number") return formatValue(v, "none", decimals);
            return formatValue(v, "auto", decimals);
        };

        // ── v2 numeric axis gridlines (Shared axis mode only — Independent
        // per-category has no single scale to tick against; matches the
        // Progress Bar Card precedent of confining new v2 chrome to the
        // layout/mode the design board actually specifies). Rendered
        // BEFORE the row list so tracks/dots paint above the faint lines.
        const gridRowsHeight = rows.length * totalRowHeight;
        const showGridlines = axisCard.showAxisGridlines.value && axisMode === "shared";
        const gridTickValues = showGridlines ? sharedScale.ticks(6) : [];
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

            const g = this.svg.append("g")
                .classed("metric-row", true)
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
                    { displayName: "Change", value: (rowRef.change >= 0 ? "+" : "") + rowRef.changePct.toFixed(1) + "%" }
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

            // ── Category name ──
            g.append("text")
                .attr("x", margin.left)
                .attr("y", catFontSize)
                .attr("font-size", catFontSize + "px")
                .attr("font-weight", categoryWeight)
                .attr("font-style", categoryStyle)
                .attr("text-decoration", categoryDecoration)
                .attr("fill", catColor)
                .attr("font-family", categoryFontFamily)
                .text(row.category);

            // ── Dumbbell area ──
            const dumbbellY = catFontSize + 8 + dumbbellHeight / 2;

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

            // Positions — enforce minimum separation so dots don't overlap
            const rowScale = scaleForRow(row);

            // ── Per-row target range band (violet target token, §2) ──
            // Only when BOTH Target Range Low/High are bound for this row
            // and the toggle is on — absent data renders nothing (matches
            // the design's own norange/no-data-bound behaviour).
            if (axisCard.showTargetRange.value && row.targetRangeLow !== null && row.targetRangeHigh !== null) {
                const rngLo = chartLeft + rowScale(Math.min(row.targetRangeLow, row.targetRangeHigh));
                const rngHi = chartLeft + rowScale(Math.max(row.targetRangeLow, row.targetRangeHigh));
                const tgt = targetToken(theme);
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

            const rawThenX = chartLeft + rowScale(row.thenValue);
            const rawNowX = chartLeft + rowScale(row.nowValue);
            const minSep = dotRadius * 3 + 4; // minimum pixel gap between dot centres
            let thenX = rawThenX;
            let nowX = rawNowX;

            if (Math.abs(nowX - thenX) < minSep && row.direction !== "neutral") {
                const mid = (rawThenX + rawNowX) / 2;
                const half = minSep / 2;
                if (rawNowX >= rawThenX) {
                    thenX = mid - half;
                    nowX = mid + half;
                } else {
                    thenX = mid + half;
                    nowX = mid - half;
                }
            }

            const leftX = Math.min(thenX, nowX);
            const rightX = Math.max(thenX, nowX);
            const dotsClose = Math.abs(nowX - thenX) < 60;

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

            // ── Direction arrow on connector (midpoint) ──
            if (Math.abs(nowX - thenX) > 20) {
                const midX = (thenX + nowX) / 2;
                const arrowDir = nowX > thenX ? 1 : -1;
                const arrowSize = Math.min(8, connectorWidth * 2.5);
                const arrow = g.append("path")
                    .attr("d", `M ${midX - arrowDir * arrowSize} ${dumbbellY - arrowSize}
                                L ${midX + arrowDir * arrowSize} ${dumbbellY}
                                L ${midX - arrowDir * arrowSize} ${dumbbellY + arrowSize}`)
                    .attr("fill", "none")
                    .attr("stroke", dirColor)
                    .attr("stroke-width", Math.max(1.5, connectorWidth * 0.6))
                    .attr("stroke-linecap", "round")
                    .attr("stroke-linejoin", "round");

                if (dur > 0) {
                    arrow.attr("opacity", 0)
                        .transition().delay(delay + dur * 0.6).duration(dur * 0.3)
                        .attr("opacity", 1);
                }
            }

            // ── Then dot: HOLLOW RING (baseline) — a muted/unit-token
            // stroke on the card surface colour, deliberately NOT
            // direction-tinted, so the beveled glow "now" dot always
            // dominates (§2 board language). ──
            const thenRingColor = hc.active ? hc.color : surfaceTokens(theme).muted;
            const thenFillColor = hc.active ? hc.background : surfaceTokens(theme).card;
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
            const glowMix = hc.active ? 0 : (theme === "dark" ? 55 : 0);
            const nowDot = g.append("circle")
                .attr("cx", nowX).attr("cy", dumbbellY)
                .attr("r", dotRadius + 1)
                .attr("fill", nowFill)
                .attr("stroke", hc.active ? hc.color : "#ffffff")
                .attr("stroke-width", hc.active ? hc.borderWidth : 2)
                .style("filter", glowMix > 0
                    ? `drop-shadow(0 0 6px color-mix(in srgb, ${dirColor} ${glowMix}%, transparent))`
                    : "none");

            if (dur > 0) {
                nowDot.attr("r", 0).attr("opacity", 0)
                    .transition().delay(delay + dur * 0.7).duration(dur * 0.3)
                    .attr("r", dotRadius + 1).attr("opacity", 1);
            }

            // ── Value format helper — per-row format overrides global ──
            const effectiveFmt = row.rowFormat || valueFmt;
            const fmtVal = (v: number): string => {
                if (effectiveFmt === "percent") return v.toFixed(decimals) + "%";
                if (effectiveFmt === "currency") return "$" + formatValue(v, "auto", decimals);
                if (effectiveFmt === "number") return formatValue(v, "none", decimals);
                return formatValue(v, "auto", decimals);
            };

            // ── Labels above dots: "Then" label + value, "Now" label + value ──
            const labelY = dumbbellY - dotRadius - 6;

            if (showLabels) {
                // Anchor labels away from each other when dots are close
                const thenLblAnchor = dotsClose ? (thenX < nowX ? "end" : "start") : "middle";
                const nowLblAnchor = dotsClose ? (nowX > thenX ? "start" : "end") : "middle";

                const thenFill = endpointLabelColorOverride || neutralColor;
                const nowFill = endpointLabelColorOverride || dirColor;
                const thenWeight = endpointLabelBold ? "700" : "400";
                const nowWeight = endpointLabelBold ? "700" : "600";

                const thenLbl = g.append("text")
                    .attr("x", thenX).attr("y", labelY)
                    .attr("text-anchor", thenLblAnchor)
                    .attr("font-size", endpointLabelFontSize + "px")
                    .attr("font-weight", thenWeight)
                    .attr("fill", thenFill)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                    .text(thenLabelText);

                const nowLbl = g.append("text")
                    .attr("x", nowX).attr("y", labelY)
                    .attr("text-anchor", nowLblAnchor)
                    .attr("font-size", endpointLabelFontSize + "px")
                    .attr("font-weight", nowWeight)
                    .attr("fill", nowFill)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                    .text(nowLabelText);

                if (dur > 0) {
                    thenLbl.attr("opacity", 0).transition().delay(delay).duration(dur * 0.3).attr("opacity", 1);
                    nowLbl.attr("opacity", 0).transition().delay(delay + dur * 0.7).duration(dur * 0.3).attr("opacity", 1);
                }
            }

            // ── Value labels below dots ──
            const valY = dumbbellY + dotRadius + valFontSize + 4;

            // Then value: anchor away from Now to avoid overlap
            const thenAnchor = dotsClose ? (thenX < nowX ? "end" : "start") : "middle";
            const thenValText = g.append("text")
                .attr("x", thenX).attr("y", valY)
                .attr("text-anchor", thenAnchor)
                .attr("font-size", thenFontSize + "px")
                .attr("font-weight", thenWeightBase)
                .attr("font-style", thenStyleBase)
                .attr("text-decoration", thenDecoration)
                .attr("fill", thenValueColor)
                .attr("opacity", 0.7)
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
            const nowAnchor = dotsClose ? (nowX > thenX ? "start" : "end") : "middle";
            const nowValText = g.append("text")
                .attr("x", nowX).attr("y", valY)
                .attr("text-anchor", nowAnchor)
                .attr("font-size", valFontSize + "px")
                .attr("font-weight", valueWeight)
                .attr("font-style", valueStyle)
                .attr("text-decoration", valueDecoration)
                .attr("fill", resolvedNowValueColor)
                .attr("font-family", valueFontFamily)
                .style("font-feature-settings", TABULAR_NUMS)
                .text(fmtVal(row.nowValue));

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
                    { opacity: 0.7, transform: "translateY(0)" },
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
                const arrow = row.change > 0 ? "\u25B2" : row.change < 0 ? "\u25BC" : "";
                let varText = "";
                if (varianceFmt === "percent" || varianceFmt === "both") {
                    varText += (row.changePct >= 0 ? "+" : "") + row.changePct.toFixed(1) + "%";
                }
                if (varianceFmt === "absolute" || varianceFmt === "both") {
                    if (varText) varText += " ";
                    varText += (row.change >= 0 ? "+" : "") + formatValue(row.change, "auto", decimals);
                }

                // Badge background pill
                const pillWidth = Math.max(60, varText.length * (badgeFontSize * 0.55) + 28);
                const pillHeight = badgeFontSize + 10;

                const pill = g.append("rect")
                    .attr("x", badgeX)
                    .attr("y", badgeY - pillHeight / 2)
                    .attr("width", pillWidth)
                    .attr("height", pillHeight)
                    .attr("rx", pillHeight / 2)
                    .attr("fill", dirColor)
                    .attr("opacity", 0.12);

                // Badge text — badgeColorOverride follows the same "empty =
                // use the derived direction colour" idiom as
                // endpointLabelColorOverride above (D-06 default preserves
                // the existing dirColor-per-row behaviour exactly).
                const badgeFill = this.isHighContrast
                    ? this.highContrastForeground
                    : (badgeColorOverride || dirColor);
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
            const tickColor = this.isHighContrast ? this.highContrastForeground : surfaceTokens(theme).muted;
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
            this.titleEl.style.color = this.isHighContrast
                ? this.highContrastForeground
                : (t.titleColor?.value?.value ?? "#1a1a2e");
            this.titleEl.style.padding = "8px 12px 4px";
            this.titleEl.style.display = "";
        } else {
            this.titleEl.style.display = "none";
        }
    }

    private renderEmpty(width: number, height: number, theme: Theme = "dark"): void {
        // Dedicated background layer (D-05) — same shared card as
        // renderDumbbell(), so the empty state also honours it.
        if (!this.isHighContrast) {
            const background = this.formattingSettings.background;
            const bgHex = background.backgroundColor.value?.value ?? "#ffffff";
            const bgTransparencyPct = background.transparency.value ?? 100;
            this.svg.append("rect")
                .attr("width", width).attr("height", height)
                .attr("fill", toRgba(bgHex, bgTransparencyPct));
        }

        const fillColor = this.isHighContrast ? this.highContrastForeground : surfaceTokens(theme).muted;
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
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    public destroy(): void {
        this.cornerSignature?.destroy();
        this.cornerSignature = null;
        this.svg = null;
        this.target = null;
    }
}
