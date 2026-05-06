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