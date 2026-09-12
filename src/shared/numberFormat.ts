"use strict";

/**
 *  Power BI model format-string → fraction digits.
 *
 *  WHY THIS EXISTS. Six visuals each carried a copy of the same hand-rolled
 *  formatter, and every copy derived ONE decimal count and used it as BOTH
 *  minimumFractionDigits and maximumFractionDigits:
 *
 *      const dm = format.match(/\.([0#]+)/);
 *      const dec = dm ? dm[1].replace(/#/g, "").length : 0;
 *
 *  `#` is an OPTIONAL digit and `0` is a REQUIRED one, so stripping the `#`s
 *  yields the minimum and throws the maximum away. A model format of `0.##`
 *  therefore rendered 12.34 as `12` — the author's optional decimals were
 *  silently truncated (NEXUS cycle-02 F3). The currency branch had the same
 *  defect through `/\.([0]+)/`, which cannot see the `##` in `$#,##0.##`.
 *
 *  The correct reading of a .NET/Power BI custom numeric format's fraction
 *  section is two numbers, not one:
 *      min = count of `0` after the decimal point   (required digits)
 *      max = min + count of `#`                     (plus optional digits)
 *
 *  Deliberately NOT powerbi-visuals-utils-formattingutils: none of the six
 *  visuals depend on it today, and adding a runtime package to the bundle is
 *  a certification-surface change. This is a pure function over a string.
 */

/** Digits after the decimal point that a model format requires / permits. */
export function fractionDigitsFor(format: string | null | undefined): { min: number; max: number } {
    if (!format) return { min: 0, max: 0 };
    // First fraction section only — matches the legacy regex so multi-section
    // formats ("0.00%;-0.00%;0.00%") keep reading their positive section.
    const dm = format.match(/\.([0#]+)/);
    if (!dm) return { min: 0, max: 0 };
    const section = dm[1];
    const min = (section.match(/0/g) || []).length;
    const optional = (section.match(/#/g) || []).length;
    return { min, max: min + optional };
}

function numericSections(format: string): string[] {
    const sections: string[] = [];
    let start = 0;
    let quote = "";
    for (let i = 0; i < format.length; i++) {
        const c = format[i];
        if (c === "\\") { i++; continue; }
        if (quote) {
            if (c === quote) quote = "";
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === ";") {
            sections.push(format.slice(start, i));
            start = i + 1;
        }
    }
    sections.push(format.slice(start));
    return sections;
}

/**
 *  Render a number the way the six visuals' duplicated `formatValue` did, with
 *  the min/max split above applied. Behaviour preserved verbatim otherwise:
 *
 *    - no format          → plain locale string
 *    - contains `%`       → value * 100, fixed to the `0.(0+)%` digit count
 *    - leading $ £ € ¥    → symbol prefix + grouped locale string
 *    - anything else      → grouped locale string
 *
 *  `locale` is passed straight to toLocaleString; undefined means the host
 *  default, which is what four of the six callers used. Callback Card pins
 *  "en-AU" and must keep doing so.
 *
 *  Callers keep their own null/non-finite guard — the five copies disagreed on
 *  it (`n == null || !isFinite(n)` vs `!isFinite(n)`) and that is not this
 *  function's business to unify.
 */
export function formatModelNumber(n: number, format: string | null | undefined, locale?: string): string {
    if (!format) return n.toLocaleString(locale);
    // Multi-section formats (`pos;neg[;zero]`): route a non-negative value to
    // its own section instead of feeding the whole string to the branches below
    // (astra pass three added only the accounting negative). Then unescape .NET
    // backslash literals — Desktop's own default currency format is
    // `\$#,0.00;(\$#,0.00);\$#,0.00` and the visuals printed "\$300K"
    // (Neil 2026-09-12). Sections split BEFORE the unescape so `\;` never splits.
    const sections = numericSections(format);
    if (sections.length > 1) {
        if (n < 0) {
            const negative = sections[1]?.trim();
            if (negative?.startsWith("(") && negative.endsWith(")")) {
                const body = formatModelNumber(Math.abs(n), negative.slice(1, -1), locale);
                // .NET: a negative that rounds to zero in its own section is
                // rendered with the positive section, never as "(0.00)".
                return /[1-9]/.test(body) ? `(${body})` : formatModelNumber(0, sections[0], locale);
            }
        } else if (n === 0 && sections.length >= 3 && sections[2].trim()) {
            return formatModelNumber(0, sections[2], locale);
        } else {
            return formatModelNumber(n, sections[0], locale);
        }
    }
    if (format.indexOf("\\") >= 0) format = format.replace(/\\(.)/g, "$1");

    // Percentage formats: "0.00%;-0.00%;0.00%", "0%", "0.0%". Power BI stores
    // percentages as decimals (0.046 = 4.6%).
    if (format.indexOf("%") >= 0) {
        // Same min/max reading as the decimal branch: "0.##%" permits two optional
        // digits, "0.0#%" requires one and permits two. The old `/0\.(0+)%/` regex
        // saw only required digits and rendered 0.1234 as "12%" for both (NEXUS
        // re-review 2026-09-11, Callback Card and Equaliser Bar). No grouping, so
        // "0.00%" keeps rendering exactly as before for large percentages.
        const { min, max } = fractionDigitsFor(format);
        return `${(n * 100).toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max, useGrouping: false })}%`;
    }

    const { min, max } = fractionDigitsFor(format);

    // Currency formats: "$#,##0", "$#,##0.00", "$#,##0.##", "£#,##0", "$0.00"…
    // The visuals' original regex required the digit run to START with `#`, so
    // "$0.00" — a format Power BI itself emits — matched nothing and rendered
    // 12.34 with no symbol (NEXUS cycle-04 §2, found 2026-09-11 after the
    // min/max fix shipped). The digit run may begin with `0` or `#`.
    const cm = format.match(/^([^#0]*)([#0][,#0]*(?:\.[0#]+)?)/);
    if (cm && cm[1] && /[$£€¥]/.test(cm[1])) {
        const sym = cm[1].trim();
        // Sign OUTSIDE the symbol: "-$10.00", never "$-10.00" (NEXUS cycle-14 §6
        // caught the helper emitting the latter). A value that rounds to zero at
        // `max` digits carries no sign.
        const body = Math.abs(n).toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
        const sign = n < 0 && /[1-9]/.test(body) ? "-" : "";
        return `${sign}${sym}${body}`;
    }

    // Decimal formats: "0.0", "0.00", "#,##0", "#,##0.00", "0.##"…
    return n.toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
}
