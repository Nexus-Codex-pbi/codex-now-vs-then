# Codex Now vs Then

## Overview
Animated dumbbell comparison — Now vs Then metric tracking. Shows the change between two periods for multiple metrics, with color-coded direction and optional variance badges.

## Features
- Displays each metric as a dumbbell: two dots (Then and Now) connected by a line
- Color indicates change direction: positive (increase good), negative (decrease good), or neutral
- Supports per-row formatting: number, currency, or percent (via Format field)
- Supports per-row direction semantics: upIsGood or downIsGood (via Direction field)
- Optional variance badge showing percent or absolute change
- Animation on data change with configurable duration and stagger delay
- Click to cross-filter other visuals by metric (Category)
- Right-click context menu for cross-filtering
- Tooltip on hover showing metric, Then, Now, and change
- High contrast mode support
- Responsive layout with scrollbars when content exceeds container size
- Optional axis titles and independent or shared axis scaling
- Supports keyboard focus and screen readers

## Data Roles
| Role | Display Name | Kind | Required? | Data Type | Description |
|------|--------------|------|-----------|-----------|-------------|
| category | Category | Grouping | No (max 1) | Text or Grouping | Metric name (e.g. Callback Rate, Lost Revenue) |
| nowValue | Now Value | Measure | No (max 1) | Numeric | Current period value |
| thenValue | Then Value | Measure | No (max 1) | Numeric | Baseline period value |
| format | Format | Measure | No (max 1) | Text | Display format per row: "number", "currency", or "percent" |
| direction | Direction | Measure | No (max 1) | Text | Colour semantics per row: "upIsGood" or "downIsGood" |
| sortOrder | Sort Order | Measure | No (max 1) | Numeric | Optional numeric field to control display order (ascending) |

Note: Each role can have at most one field bound. At least Now Value and Then Value are required for meaningful display.

## Formatting Options
The visual provides the following format pane cards:

### Comparison Settings
- Positive Color: Color for positive change (increase when upIsGood, decrease when downIsGood)
- Negative Color: Color for negative change (decrease when upIsGood, increase when downIsGood)
- Neutral Color: Color when change is negligible
- Connector Width: Thickness of the line connecting the two dots
- Dot Radius: Size of the Then and Now dots
- Animation Duration: Length of the animation in milliseconds (0 to disable)
- Stagger Delay: Delay between animating each row in milliseconds
- Show Variance Badge: Toggle visibility of the variance badge
- Variance Format: How to show variance in the badge — Percentage, Absolute, or Both
- Value Format: Format for the Then/Now values — Auto (uses Format field), Number, Percent, Currency
- Decimal Places: Number of decimal places to display (when Value Format is not Auto)

### Label Settings
- Category Font Size: Font size for metric names
- Category Color: Text color for metric names
- Value Font Size: Font size for Then/Now values
- Value Color: Text color for Then/Now values
- Badge Font Size: Font size for the variance badge
- Now Label: Text label for the Now column (default: "Now")
- Then Label: Text label for the Then column (default: "Then")
- Show Labels: Toggle visibility of the Now/Then column labels
- Endpoint Label Font Size: Font size for the Then/Now value labels
- Endpoint Label Bold: Make the Then/Now value labels bold
- Endpoint Label Color: Text color for the Then/Now value labels

### Style Settings
- Background Color: Background of the visual
- Track Color: Color of the faint track line behind the connector
- Track Height: Height of the track line
- Row Spacing: Vertical space between rows

### Axis Settings
- Axis Mode: Shared (single scale for all rows) or Independent per category (each row has its own axis)
- Per Category Padding: Extra space on the left and right when using independent axes
- Show Axis Titles: Toggle visibility of axis titles
- X Axis Title: Title for the horizontal (value) axis
- Y Axis Title: Title for the vertical (metric) axis

## How to Use
1. Import the `.pbiviz` file into Power BI Desktop (from the Visuals pane -> ... -> Import from file).
2. Locate the visual in the Visualizations pane and add it to the report canvas.
3. Bind data to the data roles:
   - Category: Required for meaningful grouping (text or grouping field)
   - Now Value: Numeric measure for the current period
   - Then Value: Numeric measure for the baseline period
   - Optional: Format (text field with values "number", "currency", or "percent")
   - Optional: Direction (text field with values "upIsGood" or "downIsGood")
   - Optional: Sort Order (numeric field to control row order)
4. Use the format pane to adjust appearance:
   - Set colors, sizes, animation, badge, labels, and axis options
5. Interact:
   - Click a row to cross-filter other visuals by that metric
   - Right-click for the context menu
   - Hover to see a tooltip with metric, Then, Now, and change

## Limitations
- The visual expects numeric values for Now Value and Then Value. Non-numeric values are skipped.
- If Now Value or Then Value is missing for a row, that row is not displayed.
- The Format and Direction roles, if bound, must be text fields with the expected values; invalid values fall back to defaults.
- Each data role accepts only one field.
- The visual uses a scrollbar when the total content height exceeds the container height.
- In Independent axis mode, each row rescales to its own min/max, making visual comparison of magnitude across rows harder.

## Support
For help or questions, visit https://nexuscodex.nexus/support