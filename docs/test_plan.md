# Test Plan – Codex Now vs Then

## 1. Functional Tests
- [ ] Visual loads without errors
- [ ] Visual renders with sample data (all fields bound)
- [ ] Visual handles empty data gracefully (shows empty state)
- [ ] All format pane options apply correctly (comparison, label, style, axis, title)
- [ ] Selection / cross-filter works (when Category bound, clicking a row filters other visuals)
- [ ] Tooltips appear on hover (showing category, now value, then value, change, and variance)
- [ ] Context menu appears on right-click
- [ ] Animation plays on data change or initial load
- [ ] Variance badge shows correctly when enabled
- [ ] Axis titles appear when enabled

## 2. Performance Tests
- [ ] update() completes < 250ms with sample data
- [ ] No memory leaks (test with repeated updates)
- [ ] Bundle size < 2.5 MB

## 3. Accessibility Tests
- [ ] Keyboard navigation works (tab to visual, Enter/Space triggers click/context menu on rows)
- [ ] High contrast mode supported (colors adapt to theme)
- [ ] ARIA labels present (on rows for click and context menu)
- [ ] No flashing content

## 4. Security Tests
- [ ] No external network calls (verify no network traffic in dev tools)
- [ ] No telemetry (no calls to external endpoints)
- [ ] No external scripts or fonts (all resources bundled)
- [ ] No DOM escape or eval (check code for unsafe patterns)

## 5. Packaging Tests
- [ ] pbiviz builds successfully (npm install && pbiviz package)
- [ ] Bundle size < 2.5 MB
- [ ] capabilities.json valid (passes schema validation)

## 6. Sample PBIX Verification
- [ ] Demonstrates all features (now vs then dumbbells, colour coding, tooltips, click-to-filter)
- [ ] Demonstrates formatting options (all format pane sections)
- [ ] Demonstrates interactions (click-to-filter, context menu, tooltips, animation)

## 7. Background Transparency (TRANS-01/02/03/05)
- [ ] Background card (Colour + Transparency) appears in the format pane
- [ ] Old saved report (background properties never set) renders pixel-identical to pre-upgrade — no background painted (transparency defaults to 100 on this visual specifically to preserve its pre-existing "no background" default, D-06)
- [ ] Setting Transparency to 0% with a colour chosen shows a fully opaque painted background over a non-white report canvas
- [ ] Transparency 50% shows true partial transparency (canvas colour blends through)
- [ ] Pre-existing Style > Background Color property (if set on an old report) continues to render exactly as before, layered beneath the new shared Background card
- [ ] Light theme and dark theme both render correctly with transparency applied

## 8. Conditional Formatting / fx (TRANS-04)
- [ ] fx button appears next to Positive Color swatch (Comparison card) in the format pane
- [ ] Binding a rule to Positive Color changes colour per category/row for positive-direction rows
- [ ] Rows without a rule fall back to the static Positive Color swatch value

## 9. Context Menu Regression (CERT-01 — T-04-01, dual listener)
- [ ] Right-click on empty space/padding within the visual still opens the Power BI context menu after the background transparency change
- [ ] Right-click directly on a dumbbell row still opens the context menu
- [ ] Both listeners (this.target AND scrollContainer, constructor lines ~76-90) remain unchanged by this plan

## 10. Visual Title (TITLE-01, D-13/D-14, full build — this visual had no title before)
- [ ] Show Title toggle appears in the format pane under "Visual Title"; default OFF
- [ ] Enabling Show Title + entering Title Text renders a title above the chart, inside the visual's own iframe (a plain HTML div in normal document flow, not an SVG element)
- [ ] Title Font (family/size/bold/italic/underline), Alignment, and Font Color all apply correctly
- [ ] Old saved report (no title properties set) renders with no title — pixel-identical to pre-upgrade (showTitle defaults false)
- [ ] Empty-data state hides the title (matches the visual's own empty-state landing message, no title shown)

## 11. Per-Surface Text Treatment (TEXT-01)
- [ ] Category (period) label Font — family/bold/italic/underline apply to the left-hand row labels
- [ ] Now value Font — family/bold/italic/underline apply to the bold value text below the Now dot
- [ ] Then value Font + Color — family/bold/italic/underline/colour apply to the value text below the Then dot (previously derived from Value Font Size - 1 and the Comparison card's Neutral Color; now has its own dedicated Then Value Font + Color card, defaulting to the same prior look)
- [ ] Variance/delta badge Font — family/bold/italic/underline apply to the badge text
- [ ] Old saved report (no new font properties set): category renders bold (700, closest match to prior 600), Now value renders bold (700, unchanged), Then value renders normal weight at font size 11 in colour #5e5d5a (matches the prior derived look), badge renders bold (700, unchanged)

## 12. Text-Colour fx (TEXT-02)
- [ ] fx button appears next to Value Color swatch (Labels card, "Now" value) in the format pane
- [ ] Binding a measure to a conditional formatting rule on Value Color changes the Now value text colour per category
- [ ] Categories without a rule fall back to the static Value Color swatch value
- [ ] Badge Text Color Override (empty by default) still falls back to the existing direction colour (positive/negative/neutral) when unset — matches the pre-existing Endpoint Label Color override idiom already used elsewhere in this visual

## 13. Context Menu Regression — Post Title/Text Change (T-11-01)
- [ ] Right-click on empty space/padding within the visual (not on a row, not on the title) still opens the Power BI context menu after this plan's title/text DOM additions
- [ ] The new title element does not sit as a pointer-events overlay over empty space (title is an in-flow scrollContainer child, not an absolutely-positioned layer, and sits above — not overlapping — the SVG chart)