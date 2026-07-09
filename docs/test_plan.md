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