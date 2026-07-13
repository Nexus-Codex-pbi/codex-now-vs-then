"use strict";

import powerbi from "powerbi-visuals-api";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

import { BackgroundSettings } from "./shared/backgroundSettings";
import { BorderSettings } from "./shared/borderSettings";
import { TitleSettings } from "./shared/titleSettings";
import { alignSelfFor, textAlignFor, makeFontControl } from "./shared/textFormatting";
import { CardSignatureSettings } from "./shared/cardSignatureSettings";

const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

// TitleSettings + alignment helpers now live in _shared/formatting/ (D-13,
// D-14). Re-exported so visual.ts can import them from "./settings".
export { TitleSettings, alignSelfFor, textAlignFor };

class ComparisonSettingsCard extends FormattingSettingsCard {
    positiveColor = new formattingSettings.ColorPicker({
        name: "positiveColor",
        displayName: "Positive Color",
        description: "Color when Now improves over Then",
        value: { value: "#007064" },
        instanceKind: ConstantOrRule
    });

    negativeColor = new formattingSettings.ColorPicker({
        name: "negativeColor",
        displayName: "Negative Color",
        description: "Color when Now declines from Then",
        value: { value: "#e60e22" },
        instanceKind: ConstantOrRule
    });

    neutralColor = new formattingSettings.ColorPicker({
        name: "neutralColor",
        displayName: "Neutral Color",
        description: "Color when no change",
        value: { value: "#5e5d5a" },
        instanceKind: ConstantOrRule
    });

    connectorWidth = new formattingSettings.NumUpDown({
        name: "connectorWidth",
        displayName: "Connector Width",
        description: "Width of the line connecting Then to Now",
        value: 3
    });

    dotRadius = new formattingSettings.NumUpDown({
        name: "dotRadius",
        displayName: "Dot Radius",
        description: "Radius of the Then/Now endpoint dots",
        value: 6
    });

    animationDuration = new formattingSettings.NumUpDown({
        name: "animationDuration",
        displayName: "Animation Duration (ms)",
        description: "Duration of the entrance animation per row",
        value: 600
    });

    staggerDelay = new formattingSettings.NumUpDown({
        name: "staggerDelay",
        displayName: "Stagger Delay (ms)",
        description: "Delay between each row's animation",
        value: 150
    });

    showVarianceBadge = new formattingSettings.ToggleSwitch({
        name: "showVarianceBadge",
        displayName: "Show Variance Badge",
        value: true
    });

    varianceFormat = new formattingSettings.ItemDropdown({
        name: "varianceFormat",
        displayName: "Variance Format",
        items: [
            { displayName: "Percentage", value: "percent" },
            { displayName: "Absolute", value: "absolute" },
            { displayName: "Both", value: "both" }
        ],
        value: { displayName: "Percentage", value: "percent" }
    });

    valueFormat = new formattingSettings.ItemDropdown({
        name: "valueFormat",
        displayName: "Value Format",
        description: "How to format the Now/Then values",
        items: [
            { displayName: "Auto", value: "auto" },
            { displayName: "Number", value: "number" },
            { displayName: "Percent", value: "percent" },
            { displayName: "Currency", value: "currency" }
        ],
        value: { displayName: "Auto", value: "auto" }
    });

    decimalPlaces = new formattingSettings.NumUpDown({
        name: "decimalPlaces",
        displayName: "Decimal Places",
        value: 1
    });

    name: string = "comparisonSettings";
    displayName: string = "Comparison";
    slices: Array<FormattingSettingsSlice> = [
        this.positiveColor,
        this.negativeColor,
        this.neutralColor,
        this.connectorWidth,
        this.dotRadius,
        this.animationDuration,
        this.staggerDelay,
        this.showVarianceBadge,
        this.varianceFormat,
        this.valueFormat,
        this.decimalPlaces
    ];
}

class LabelSettingsCard extends FormattingSettingsCard {
    // Category (period) label text — FontControl composite reuses the
    // existing "categoryFontSize" property name (D-06/D-07: additive-only,
    // no schema rename). Bold defaults true — closest boolean match to the
    // previously-hardcoded font-weight:600 on this text (render-nothing-
    // default parity; see visual.ts's rendering comment for the full D-06
    // rationale, matching the same design call made on pbiCallbackCard).
    private categoryFontBundle = makeFontControl("category", { fontSize: 13, bold: true });
    categoryFontFamily = this.categoryFontBundle.fontFamily;
    categoryFontSize = this.categoryFontBundle.fontSize;
    categoryBold = this.categoryFontBundle.bold;
    categoryItalic = this.categoryFontBundle.italic;
    categoryUnderline = this.categoryFontBundle.underline;
    categoryFont = this.categoryFontBundle.control;

    categoryColor = new formattingSettings.ColorPicker({
        name: "categoryColor",
        displayName: "Category Color",
        value: { value: "#1a1a1a" },
        instanceKind: ConstantOrRule
    });

    // "Now" value text — reuses existing "valueFontSize"/"valueColor".
    // Bold defaults true (matches the previously-hardcoded font-weight:700).
    private valueFontBundle = makeFontControl("value", { fontSize: 12, bold: true });
    valueFontFamily = this.valueFontBundle.fontFamily;
    valueFontSize = this.valueFontBundle.fontSize;
    valueBold = this.valueFontBundle.bold;
    valueItalic = this.valueFontBundle.italic;
    valueUnderline = this.valueFontBundle.underline;
    valueFont = this.valueFontBundle.control;

    valueColor = new formattingSettings.ColorPicker({
        name: "valueColor",
        displayName: "Value Color",
        value: { value: "#333333" },
        instanceKind: ConstantOrRule
    });

    // "Then" value text (below the Then dot) — brand-new dedicated font +
    // colour (this surface previously derived its look from valueFontSize-1
    // and comparisonCard.neutralColor with no settings of its own). Defaults
    // reproduce that prior derived look exactly: fontSize 11 (= the old
    // valueFontSize default 12, minus 1), color "#5e5d5a" (= neutralColor's
    // own default hex), bold false (the old text had no font-weight set).
    private thenFontBundle = makeFontControl("then", { fontSize: 11, bold: false });
    thenFontFamily = this.thenFontBundle.fontFamily;
    thenFontSize = this.thenFontBundle.fontSize;
    thenBold = this.thenFontBundle.bold;
    thenItalic = this.thenFontBundle.italic;
    thenUnderline = this.thenFontBundle.underline;
    thenFont = this.thenFontBundle.control;

    thenColor = new formattingSettings.ColorPicker({
        name: "thenColor",
        displayName: "Then Value Color",
        description: "Colour of the Then value text below the Then dot",
        value: { value: "#5e5d5a" },
        instanceKind: ConstantOrRule
    });

    // Variance/delta badge text — reuses existing "badgeFontSize". Bold
    // defaults true (matches the previously-hardcoded font-weight:700).
    private badgeFontBundle = makeFontControl("badge", { fontSize: 11, bold: true });
    badgeFontFamily = this.badgeFontBundle.fontFamily;
    badgeFontSize = this.badgeFontBundle.fontSize;
    badgeBold = this.badgeFontBundle.bold;
    badgeItalic = this.badgeFontBundle.italic;
    badgeUnderline = this.badgeFontBundle.underline;
    badgeFont = this.badgeFontBundle.control;

    // Override colour for the badge/delta text — same "empty string = use
    // the derived direction colour" idiom already established by this
    // file's own endpointLabelColor property (line ~199 below), so the
    // default (empty) preserves the existing dirColor-per-row behaviour
    // exactly (D-06).
    badgeColor = new formattingSettings.ColorPicker({
        name: "badgeColor",
        displayName: "Badge Text Color Override",
        description: "Override colour for the variance/delta badge text. Leave empty to keep the direction colour (positive/negative/neutral).",
        value: { value: "" },
        instanceKind: ConstantOrRule
    });

    nowLabel = new formattingSettings.TextInput({
        name: "nowLabel",
        displayName: "Now Label",
        placeholder: "Now",
        value: "Now"
    });

    thenLabel = new formattingSettings.TextInput({
        name: "thenLabel",
        displayName: "Then Label",
        placeholder: "Then",
        value: "Then"
    });

    showLabels = new formattingSettings.ToggleSwitch({
        name: "showLabels",
        displayName: "Show Now/Then Labels",
        description: "Show small labels above the endpoint dots",
        value: true
    });

    endpointLabelFontSize = new formattingSettings.NumUpDown({
        name: "endpointLabelFontSize",
        displayName: "Endpoint Label Font Size",
        description: "Font size for the Now/Then labels above the endpoint dots",
        value: 9
    });

    endpointLabelBold = new formattingSettings.ToggleSwitch({
        name: "endpointLabelBold",
        displayName: "Bold Endpoint Labels",
        description: "Render the Now/Then endpoint labels in bold",
        value: false
    });

    endpointLabelColor = new formattingSettings.ColorPicker({
        name: "endpointLabelColor",
        displayName: "Endpoint Label Color",
        description: "Override colour for both Now/Then endpoint labels. Leave empty to keep the default (Now uses the variance colour, Then uses neutral).",
        value: { value: "" },
        instanceKind: ConstantOrRule
    });

    name: string = "labelSettings";
    displayName: string = "Labels";
    slices: Array<FormattingSettingsSlice> = [
        this.categoryFont,
        this.categoryColor,
        this.valueFont,
        this.valueColor,
        this.thenFont,
        this.thenColor,
        this.badgeFont,
        this.badgeColor,
        this.nowLabel,
        this.thenLabel,
        this.showLabels,
        this.endpointLabelFontSize,
        this.endpointLabelBold,
        this.endpointLabelColor
    ];
}

class StyleSettingsCard extends FormattingSettingsCard {
    backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Background Color",
        value: { value: "" },
        instanceKind: ConstantOrRule
    });

    // v2 board default (D-16): the frozen v3 engine's own dim-track token
    // (SURFACE_TOKENS.dark.track in designTokens.ts) so a brand-new report
    // lands on the "dim track" language the board specifies; any report
    // that already set this ColorPicker keeps its own saved value untouched.
    trackColor = new formattingSettings.ColorPicker({
        name: "trackColor",
        displayName: "Track Color",
        description: "Background track behind the dumbbell connector",
        value: { value: "#1c1c3a" },
        instanceKind: ConstantOrRule
    });

    trackHeight = new formattingSettings.NumUpDown({
        name: "trackHeight",
        displayName: "Track Height",
        description: "Height of the background track in pixels",
        value: 4
    });

    rowSpacing = new formattingSettings.NumUpDown({
        name: "rowSpacing",
        displayName: "Row Spacing",
        description: "Vertical spacing between metric rows",
        value: 16
    });

    name: string = "styleSettings";
    displayName: string = "Style";
    slices: Array<FormattingSettingsSlice> = [
        this.backgroundColor,
        this.trackColor,
        this.trackHeight,
        this.rowSpacing
    ];
}

class AxisSettingsCard extends FormattingSettingsCard {
    axisMode = new formattingSettings.ItemDropdown({
        name: "axisMode",
        displayName: "Axis Mode",
        description: "Shared: all rows share one min-max scale. Independent: each category scales between its own Now and Then values so small movements remain visible.",
        items: [
            { displayName: "Shared (single scale)", value: "shared" },
            { displayName: "Independent per category", value: "perCategory" }
        ],
        value: { displayName: "Shared (single scale)", value: "shared" }
    });

    perCategoryPadding = new formattingSettings.NumUpDown({
        name: "perCategoryPadding",
        displayName: "Per-Category Padding (%)",
        description: "Padding either side of each row's Now/Then range when Axis Mode is Independent. Higher values shrink the dumbbell within the track.",
        value: 25
    });

    showAxisTitles = new formattingSettings.ToggleSwitch({
        name: "showAxisTitles",
        displayName: "Show Axis Titles",
        description: "Display titles below X axis (values) and beside Y axis (categories)",
        value: false
    });

    xAxisTitle = new formattingSettings.TextInput({
        name: "xAxisTitle",
        displayName: "X Axis Title",
        placeholder: "X axis title",
        value: ""
    });

    yAxisTitle = new formattingSettings.TextInput({
        name: "yAxisTitle",
        displayName: "Y Axis Title",
        placeholder: "Y axis title",
        value: ""
    });

    // v2 board additions (LOOK-03, additive-only, D-16 default-off-behaviour
    // unchanged for old reports since none of these three properties
    // previously existed):
    showTargetRange = new formattingSettings.ToggleSwitch({
        name: "showTargetRange",
        displayName: "Show Target Range",
        description: "Show the per-row target range band (requires Target Range Low/High fields)",
        value: true
    });

    // Numeric axis ticks + faint vertical gridlines (Shared axis mode
    // only — Independent per-category has no single scale to tick).
    // Separate from showAxisTitles (the X/Y caption text) per the design
    // board's own two distinct toggles.
    showAxisGridlines = new formattingSettings.ToggleSwitch({
        name: "showAxisGridlines",
        displayName: "Show Axis Gridlines",
        description: "Show numeric axis tick labels and faint vertical gridlines (Shared axis mode only)",
        value: true
    });

    // Blank = auto (existing shared/perCategory scale computation, D-06
    // render-nothing-default parity) — same "empty string = opt-in override"
    // idiom as labelCard.badgeColor/endpointLabelColor above.
    customAxisMin = new formattingSettings.TextInput({
        name: "customAxisMin",
        displayName: "Custom Axis Min",
        description: "Manual scale minimum. Leave blank to auto-compute from the bound data.",
        placeholder: "auto",
        value: ""
    });

    customAxisMax = new formattingSettings.TextInput({
        name: "customAxisMax",
        displayName: "Custom Axis Max",
        description: "Manual scale maximum. Leave blank to auto-compute from the bound data.",
        placeholder: "auto",
        value: ""
    });

    name: string = "axisSettings";
    displayName: string = "Axis";
    slices: Array<FormattingSettingsSlice> = [
        this.axisMode,
        this.perCategoryPadding,
        this.showAxisTitles,
        this.xAxisTitle,
        this.yAxisTitle,
        this.showTargetRange,
        this.showAxisGridlines,
        this.customAxisMin,
        this.customAxisMax
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    cardSignature = new CardSignatureSettings();
    titleSettings = new TitleSettings();
    comparisonCard = new ComparisonSettingsCard();
    labelCard = new LabelSettingsCard();
    styleCard = new StyleSettingsCard();
    axisCard = new AxisSettingsCard();
    background = new BackgroundSettings();
    visualBorder = new BorderSettings();

    constructor() {
        super();
        // D-06 default-preservation override (per-visual instance only —
        // _shared/formatting/backgroundSettings.ts itself is untouched,
        // D-11): this visual's PRE-EXISTING default was "no background
        // painted" (styleCard.backgroundColor defaulted to "", so no rect
        // was ever drawn — see the old `if (bgColor && bgColor.length > 0)`
        // gate in visual.ts). The frozen shared Background card's own
        // default (opaque white, transparency 0) would regress every old
        // saved report that never touched this brand-new property to a
        // suddenly-opaque white background. Overriding the TRANSPARENCY
        // default to 100 on this instance makes toRgba(...) resolve to
        // alpha 0 regardless of colour, which is visually identical to
        // "no rect painted" — restoring pixel-identical old-report
        // rendering while still exposing a real, working Colour +
        // Transparency control for any report that opts in.
        this.background.transparency.value = 100;
    }

    cards = [this.titleSettings, this.comparisonCard, this.labelCard, this.styleCard, this.axisCard, this.background,
        this.cardSignature,
        this.visualBorder
    ];
}
