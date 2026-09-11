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

    // Percentage formats: "0.00%;-0.00%;0.00%", "0%", "0.0%". Power BI stores
    // percentages as decimals (0.046 = 4.6%).
    if (format.indexOf("%") >= 0) {
        const m = format.match(/0\.(0+)%/);
        const dec = m ? m[1].length : 0;
        return `${(n * 100).toFixed(dec)}%`;
    }

    const { min, max } = fractionDigitsFor(format);

    // Currency formats: "$#,##0", "$#,##0.00", "$#,##0.##", "£#,##0"…
    // Detection regex left exactly as the visuals had it; only the digit
    // derivation changes, because `(?:\.0+)?` is optional and never
    // contributed to the captured symbol.
    const cm = format.match(/^([^#0]*)(#[,#]*0(?:\.0+)?)/);
    if (cm && cm[1] && /[$£€¥]/.test(cm[1])) {
        const sym = cm[1].trim();
        return `${sym}${n.toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max })}`;
    }

    // Decimal formats: "0.0", "0.00", "#,##0", "#,##0.00", "0.##"…
    return n.toLocaleString(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
}
