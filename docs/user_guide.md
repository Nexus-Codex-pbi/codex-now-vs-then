# User Guide – Codex Now vs Then

## Overview
Animated dumbbell comparison — Now vs Then metric tracking. Shows current and baseline values for multiple metrics with visual indicators of change.

## 1. Adding the Visual
1. Import the `.pbiviz` file into Power BI Desktop
2. Locate the visual in the Visualizations pane
3. Drag it onto the report canvas

## 2. Data Binding
- **Category** (Required): Metric name (e.g. 'Callback Rate', 'Lost Revenue').
- **Now Value** (Required): Current period value (numeric).
- **Then Value** (Required): Baseline period value (numeric).
- **Format** (Optional): Display format per row: 'number', 'currency', or 'percent'. Overrides global value format.
- **Direction** (Optional): Colour semantics per row: 'upIsGood' or 'downIsGood'. Determines whether an increase is positive or negative.
- **Sort Order** (Optional): Numeric field to control display order (ascending).

## 3. Formatting Options
**Comparison Settings**
- Positive Color: Colour for positive change (increase when upIsGood, decrease when downIsGood).
- Negative Color: Colour for negative change.
- Neutral Color: Colour for no change.
- Connector Width: Thickness of the line connecting the two points.
- Dot Radius: Size of the now/then value dots.
- Animation Duration: Length of the entrance animation (ms).
- Stagger Delay: Delay between animating each row (ms).
- Show Variance Badge: Toggle display of the variance badge.
- Variance Format: Variance display: 'Percentage', 'Absolute', or 'Both'.
- Value Format: Global format: 'Auto', 'Number', 'Percent', or 'Currency'.
- Decimal Places: Number of decimal places for values.

**Label Settings**
- Category Font Size: Size of the metric name text.
- Category Color: Colour of the metric name.
- Value Font Size: Size of the now/then value labels.
- Value Color: Colour of the now/then value labels.
- Badge Font Size: Size of the variance badge text.
- Now Label: Text for the now column header (default 'Now').
- Then Label: Text for the then column header (default 'Then').
- Show Labels: Toggle visibility of the column headers.
- Endpoint Label Font Size: Size of the now/then value text.
- Endpoint Label Bold: Bold the now/then value text.
- Endpoint Label Color: Colour of the now/then value text.

**Style Settings**
- Background Color: Background of the visual.
- Track Color: Colour of the connector line.
- Track Height: Thickness of the connector line.
- Row Spacing: Vertical space between rows.

**Axis Settings**
- Axis Mode: 'Shared (single scale)' or 'Independent per category'.
- Per Category Padding: Horizontal padding when axis mode is independent.
- Show Axis Titles: Toggle visibility of axis titles.
- X Axis Title: Title for the value axis.
- Y Axis Title: Title for the metric axis.

## 4. Features
- Animated dumbbell charts showing now vs then values.
- Colour-coded change direction based on per-row direction semantics.
- Tooltips on hover showing category, now value, then value, change, and variance.
- Click a row to cross-filter other visuals by that metric (if Category bound).
- Right-click for context menu.
- Supports high contrast mode and keyboard navigation.
- Configurable animation and styling.
- Optional variance badge showing change as percentage, absolute, or both.
- Independent or shared axis scaling.
- Responsive layout with scrollbar when content exceeds container.

## 5. Limitations
- Only the first 30,000 rows are processed (data reduction limit).
- Requires Now Value and Then Value to be numeric; non-numeric rows are skipped.
- If Format or Direction fields contain invalid values, they fall back to global settings or defaults.
- Sort Order must be numeric; non-numeric values are placed at the end.
- The visual does not support drill-through or hierarchical categories.

## 6. Support
For help or questions, visit https://nexuscodex.nexus/support