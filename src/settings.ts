"use strict";

import powerbi from "powerbi-visuals-api";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;
import FormattingSettingsModel = formattingSettings.Model;

const ConstantOrRule = powerbi.VisualEnumerationInstanceKinds.ConstantOrRule;

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
    categoryFontSize = new formattingSettings.NumUpDown({
        name: "categoryFontSize",
        displayName: "Category Font Size",
        value: 13
    });

    categoryColor = new formattingSettings.ColorPicker({
        name: "categoryColor",
        displayName: "Category Color",
        value: { value: "#1a1a1a" },
        instanceKind: ConstantOrRule
    });

    valueFontSize = new formattingSettings.NumUpDown({
        name: "valueFontSize",
        displayName: "Value Font Size",
        value: 12
    });

    valueColor = new formattingSettings.ColorPicker({
        name: "valueColor",
        displayName: "Value Color",
        value: { value: "#333333" },
        instanceKind: ConstantOrRule
    });

    badgeFontSize = new formattingSettings.NumUpDown({
        name: "badgeFontSize",
        displayName: "Badge Font Size",
        value: 11
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

    name: string = "labelSettings";
    displayName: string = "Labels";
    slices: Array<FormattingSettingsSlice> = [
        this.categoryFontSize,
        this.categoryColor,
        this.valueFontSize,
        this.valueColor,
        this.badgeFontSize,
        this.nowLabel,
        this.thenLabel,
        this.showLabels
    ];
}

class StyleSettingsCard extends FormattingSettingsCard {
    backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Background Color",
        value: { value: "" },
        instanceKind: ConstantOrRule
    });

    trackColor = new formattingSettings.ColorPicker({
        name: "trackColor",
        displayName: "Track Color",
        description: "Background track behind the dumbbell connector",
        value: { value: "#eee9dc" },
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

    name: string = "axisSettings";
    displayName: string = "Axis Titles";
    slices: Array<FormattingSettingsSlice> = [
        this.showAxisTitles,
        this.xAxisTitle,
        this.yAxisTitle
    ];
}

export class VisualFormattingSettingsModel extends FormattingSettingsModel {
    comparisonCard = new ComparisonSettingsCard();
    labelCard = new LabelSettingsCard();
    styleCard = new StyleSettingsCard();
    axisCard = new AxisSettingsCard();

    cards = [this.comparisonCard, this.labelCard, this.styleCard, this.axisCard];
}
