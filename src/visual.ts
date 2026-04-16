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

import { VisualFormattingSettingsModel } from "./settings";
import { formatValue, clamp } from "./utils";

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
}

export class Visual implements IVisual {
    private target: HTMLElement;
    private host: IVisualHost;
    private eventService: IVisualEventService;
    private selectionManager: ISelectionManager;
    private tooltipService: ITooltipService;
    private localizationManager: ILocalizationManager;
    private scrollContainer: Selection<HTMLDivElement, unknown, null, undefined>;
    private svg: Selection<SVGSVGElement, unknown, null, undefined>;
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService: FormattingSettingsService;
    private previousData: string = "";
    private isHighContrast: boolean = false;
    private highContrastForeground: string = "";
    private highContrastBackground: string = "";

    constructor(options: VisualConstructorOptions) {
        this.formattingSettingsService = new FormattingSettingsService();
        this.target = options.element;
        this.host = options.host;
        this.eventService = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.tooltipService = options.host.tooltipService;
        this.localizationManager = options.host.createLocalizationManager();

        // Context menu
        this.target.addEventListener("contextmenu", (e: MouseEvent) => {
            this.selectionManager.showContextMenu({}, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        });

        this.scrollContainer = select(this.target)
            .append("div")
            .classed("now-vs-then-scroll", true)
            .style("width", "100%")
            .style("height", "100%")
            .style("overflow", "auto");

        this.svg = this.scrollContainer
            .append("svg")
            .classed("now-vs-then-svg", true);
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

            // Clear
            this.svg.selectAll("*").remove();

            const rows = this.parseData(dataView);
            if (rows.length === 0) {
                this.renderEmpty(width, height);
                this.eventService.renderingFinished(options);
                return;
            }

            // Check if data actually changed (to decide whether to animate)
            const dataKey = JSON.stringify(rows.map(r => [r.category, r.nowValue, r.thenValue]));
            const shouldAnimate = dataKey !== this.previousData;
            this.previousData = dataKey;

            // Axis title settings
            const axisSettings = this.formattingSettings.axisCard;
            const showAxisTitles = axisSettings.showAxisTitles.value;
            const xAxisTitleText = axisSettings.xAxisTitle.value || "";
            const yAxisTitleText = axisSettings.yAxisTitle.value || "";

            this.renderDumbbell(rows, width, shouldAnimate, showAxisTitles, xAxisTitleText, yAxisTitleText);

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
                selectionId
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

        const labelRowHeight = showLabels ? 16 : 0;
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

        return contentH;
    }

    private renderDumbbell(rows: MetricRow[], width: number, animate: boolean,
        showAxisTitles: boolean = false, xAxisTitleText: string = "", yAxisTitleText: string = ""): void {
        const comp = this.formattingSettings.comparisonCard;
        const lbl = this.formattingSettings.labelCard;
        const style = this.formattingSettings.styleCard;

        let positiveColor = comp.positiveColor.value.value;
        let negativeColor = comp.negativeColor.value.value;
        let neutralColor = comp.neutralColor.value.value;
        const connectorWidth = Math.max(1, comp.connectorWidth.value);
        const dotRadius = Math.max(3, comp.dotRadius.value);
        const animDuration = Math.max(0, comp.animationDuration.value);
        const staggerDelay = Math.max(0, comp.staggerDelay.value);
        const showBadge = comp.showVarianceBadge.value;
        const varianceFmt = (comp.varianceFormat.value?.value as string) || "percent";
        const valueFmt = (comp.valueFormat.value?.value as string) || "auto";
        const decimals = clamp(comp.decimalPlaces.value, 0, 6);

        const catFontSize = clamp(lbl.categoryFontSize.value, 8, 30);
        let catColor = lbl.categoryColor.value.value;
        const valFontSize = clamp(lbl.valueFontSize.value, 8, 24);
        let valColor = lbl.valueColor.value.value;
        const badgeFontSize = clamp(lbl.badgeFontSize.value, 8, 20);
        const nowLabelText = lbl.nowLabel.value || "Now";
        const thenLabelText = lbl.thenLabel.value || "Then";
        const showLabels = lbl.showLabels.value;

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
        }

        // Background
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
        const labelRowHeight = showLabels ? 16 : 0;
        const valueRowHeight = valFontSize + 4;
        const dumbbellHeight = Math.max(dotRadius * 2 + 4, trackHeight + 8);
        const singleRowHeight = catFontSize + 4 + dumbbellHeight + valueRowHeight + labelRowHeight;
        const totalRowHeight = singleRowHeight + rowSpacing;

        // Scale: map all values to chart width
        const allValues = rows.flatMap(r => [r.nowValue, r.thenValue]);
        const minVal = Math.min(...allValues);
        const maxVal = Math.max(...allValues);
        const pad = (maxVal - minVal) * 0.08 || 1;
        const xScale = scaleLinear()
            .domain([minVal - pad, maxVal + pad])
            .range([dotRadius + 2, chartWidth - dotRadius - 2]);

        // Helper for tooltip value formatting
        const fmtRowVal = (v: number, row: MetricRow): string => {
            const effectiveFmt = row.rowFormat || valueFmt;
            if (effectiveFmt === "percent") return v.toFixed(decimals) + "%";
            if (effectiveFmt === "currency") return "$" + formatValue(v, "auto", decimals);
            if (effectiveFmt === "number") return formatValue(v, "none", decimals);
            return formatValue(v, "auto", decimals);
        };

        // Render each row
        rows.forEach((row, idx) => {
            const yBase = margin.top + idx * totalRowHeight;
            const delay = animate ? idx * staggerDelay : 0;
            const dur = animate ? animDuration : 0;

            const dirColor = row.direction === "positive" ? positiveColor
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
                .attr("font-weight", "600")
                .attr("fill", catColor)
                .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                .text(row.category);

            // ── Dumbbell area ──
            const dumbbellY = catFontSize + 8 + dumbbellHeight / 2;

            // Background track
            g.append("rect")
                .attr("x", chartLeft)
                .attr("y", dumbbellY - trackHeight / 2)
                .attr("width", chartWidth)
                .attr("height", trackHeight)
                .attr("rx", trackHeight / 2)
                .attr("fill", trackColor)
                .attr("opacity", 0.5);

            // Positions — enforce minimum separation so dots don't overlap
            const rawThenX = chartLeft + xScale(row.thenValue);
            const rawNowX = chartLeft + xScale(row.nowValue);
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

            // ── Animated connector line ──
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
                    .attr("opacity", 1)
                    .transition()
                    .duration(dur * 0.7)
                    .attr("x1", leftX).attr("x2", rightX);
            } else {
                connector.attr("x1", leftX).attr("x2", rightX);
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

            // ── Then dot ──
            const thenDot = g.append("circle")
                .attr("cx", thenX).attr("cy", dumbbellY)
                .attr("r", dotRadius)
                .attr("fill", "#ffffff")
                .attr("stroke", dirColor)
                .attr("stroke-width", 2.5);

            if (dur > 0) {
                thenDot.attr("r", 0).attr("opacity", 0)
                    .transition().delay(delay).duration(dur * 0.3)
                    .attr("r", dotRadius).attr("opacity", 1);
            }

            // ── Now dot (filled, slightly larger) ──
            const nowDot = g.append("circle")
                .attr("cx", nowX).attr("cy", dumbbellY)
                .attr("r", dotRadius + 1)
                .attr("fill", dirColor)
                .attr("stroke", "#ffffff")
                .attr("stroke-width", 2);

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

                const thenLbl = g.append("text")
                    .attr("x", thenX).attr("y", labelY)
                    .attr("text-anchor", thenLblAnchor)
                    .attr("font-size", "9px")
                    .attr("fill", neutralColor)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                    .text(thenLabelText);

                const nowLbl = g.append("text")
                    .attr("x", nowX).attr("y", labelY)
                    .attr("text-anchor", nowLblAnchor)
                    .attr("font-size", "9px")
                    .attr("font-weight", "600")
                    .attr("fill", dirColor)
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
                .attr("font-size", (valFontSize - 1) + "px")
                .attr("fill", neutralColor)
                .attr("opacity", 0.7)
                .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                .text(fmtVal(row.thenValue));

            // Now value: anchor away from Then
            const nowAnchor = dotsClose ? (nowX > thenX ? "start" : "end") : "middle";
            const nowValText = g.append("text")
                .attr("x", nowX).attr("y", valY)
                .attr("text-anchor", nowAnchor)
                .attr("font-size", valFontSize + "px")
                .attr("font-weight", "700")
                .attr("fill", valColor)
                .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
                .text(fmtVal(row.nowValue));

            if (dur > 0) {
                thenValText.attr("opacity", 0).transition().delay(delay + dur * 0.2).duration(dur * 0.3).attr("opacity", 0.7);
                nowValText.attr("opacity", 0).transition().delay(delay + dur * 0.8).duration(dur * 0.3).attr("opacity", 1);
            }

            // ── Variance badge ──
            if (showBadge) {
                const badgeX = chartRight + 12;
                const badgeY = dumbbellY;

                // Build variance text
                const arrow = row.direction === "positive" ? "\u25B2" : row.direction === "negative" ? "\u25BC" : "";
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

                // Badge text
                const badgeText = g.append("text")
                    .attr("x", badgeX + pillWidth / 2)
                    .attr("y", badgeY)
                    .attr("text-anchor", "middle")
                    .attr("dominant-baseline", "central")
                    .attr("font-size", badgeFontSize + "px")
                    .attr("font-weight", "700")
                    .attr("fill", dirColor)
                    .attr("font-family", "Segoe UI, Tahoma, Geneva, Verdana, sans-serif")
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

    private renderEmpty(width: number, height: number): void {
        const fillColor = this.isHighContrast ? this.highContrastForeground : "#999999";
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
        this.svg = null;
        this.target = null;
    }
}
