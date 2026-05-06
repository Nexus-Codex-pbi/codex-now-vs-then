# Developer Guide – Codex Now vs Then

## 1. Architecture
- File structure: `src/visual.ts`, `src/settings.ts`, `src/utils.ts`, `style/visual.less`, `capabilities.json`, `pbiviz.json`
- Rendering model: SVG-based, built once in constructor; `update()` mutates only existing elements and animates changes.

## 2. Capabilities
- Data roles: 
   - category (Grouping)
   - nowValue (Measure, numeric)
   - thenValue (Measure, numeric)
   - format (Measure, text)
   - direction (Measure, text)
   - sortOrder (Measure, numeric)
- Format pane cards: comparisonSettings, labelSettings, styleSettings, axisSettings, titleSettings
- supportsHighlight, supportsKeyboardFocus, supportsLandingPage, supportsEmptyDataView, supportsMultiVisualSelection: all true.

## 3. APIs Used
- ISelectionManager — cross-filter + context menu
- ITooltipService — hover tooltips
- ILocalizationManager — string resources
- ISandboxExtendedColorPalette — high-contrast detection (via host.colorPalette)

## 4. Performance
- update() target: < 250ms
- No infinite loops or heavy timers
- DOM minimal — element refs cached on construction
- Uses D3 for SVG rendering and transitions.

## 5. Accessibility
- ARIA labels on interactive elements (rows are focusable via selection manager)
- High contrast support via `colorPalette.isHighContrast` (foreground/background colours adapt)
- Keyboard focus on tabbable elements (rows are focusable and handle Enter/Space for click, Shift+F10 for context menu)

## 6. Security
- No external calls
- No telemetry
- No external scripts or fonts
- No eval() or dynamic code

## 7. Build & Packaging
- powerbi-visuals-tools 7.x
- Node 20
- TypeScript 5.5+
- `npm install && pbiviz package`
- Output: `.pbiviz` < 2.5 MB