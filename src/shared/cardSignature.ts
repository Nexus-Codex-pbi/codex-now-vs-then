"use strict";

// ─── Shared Card Signature (v3) ──────────────────────────────
// The corner-bracket card signature (DESIGN-LANGUAGE §4): a band-or-
// accent-tinted L at the card's top-left, mirrored to bottom-right on
// request, rendered ABOVE any title panel so nothing is chopped. Built
// via the DOM API only (createElement + style + appendChild) — never a
// markup string — so it is cert-safe by construction. Exposes the flat
// flush-bar and glass-tube alternatives as `opts.variant`.
//
// `_shared/formatting/` v3 is additive-only (D-11); this module is
// proven by the Plan 15 pbiKpiCard pilot then frozen for the batch.

import { accentBarGradient } from "./designTokens";

export type CardSignatureVariant = "cornerBracket" | "flatBar" | "glassTube";

export interface CardSignatureOptions {
    variant?: CardSignatureVariant;
    /** Mirror a second bracket to the bottom-right corner (cornerBracket/glassTube only). */
    mirror?: boolean;
    size?: number;
    thickness?: number;
    cardRadius?: number;
    /** 0-100 color-mix glow budget; pass 0 for light theme / high-contrast. */
    glowMix?: number;
    /** Muted/no-data state — dims the signature and disables glow. */
    muted?: boolean;
    mutedColor?: string;
}

export interface CardSignatureHandle {
    elements: HTMLElement[];
    update(bandHex: string, opts?: CardSignatureOptions): void;
    destroy(): void;
}

type ResolvedOptions = Required<Omit<CardSignatureOptions, "mutedColor">> & { mutedColor: string };

const DEFAULTS: ResolvedOptions = {
    variant: "cornerBracket",
    mirror: true,
    size: 52,
    thickness: 4,
    cardRadius: 10,
    glowMix: 55,
    muted: false,
    mutedColor: "#8f8ab8",
};

function resolveOptions(opts: CardSignatureOptions, base: ResolvedOptions = DEFAULTS): ResolvedOptions {
    return {
        variant: opts.variant ?? base.variant,
        mirror: opts.mirror ?? base.mirror,
        size: opts.size ?? base.size,
        thickness: opts.thickness ?? base.thickness,
        cardRadius: opts.cardRadius ?? base.cardRadius,
        glowMix: opts.glowMix ?? base.glowMix,
        muted: opts.muted ?? base.muted,
        mutedColor: opts.mutedColor ?? base.mutedColor,
    };
}

function glowFilter(hex: string, glowMix: number): string {
    return glowMix > 0 ? `drop-shadow(0 0 6px color-mix(in srgb, ${hex} ${glowMix}%, transparent))` : "none";
}

function clearChildren(el: HTMLElement): void {
    while (el.firstChild) el.removeChild(el.firstChild);
}

function styleBracket(el: HTMLElement, corner: "tl" | "br", bandHex: string, opts: ResolvedOptions): void {
    clearChildren(el);
    const color = opts.muted ? opts.mutedColor : bandHex;

    el.style.position = "absolute";
    el.style.pointerEvents = "none";
    el.style.background = "none";
    el.style.border = "none";
    el.style.top = el.style.right = el.style.bottom = el.style.left = "";
    el.style.width = `${opts.size}px`;
    el.style.height = `${opts.size}px`;
    el.style.opacity = opts.muted ? "0.4" : "1";
    el.style.filter = opts.muted ? "none" : glowFilter(color, opts.glowMix);
    el.style.borderRadius = "0";

    if (opts.variant === "flatBar") {
        if (corner === "br") {
            // Flat bar has no mirror element — hide the second slot.
            el.style.display = "none";
            return;
        }
        el.style.display = "";
        el.style.top = "0";
        el.style.bottom = "0";
        el.style.left = "0";
        el.style.height = "auto";
        el.style.width = `${opts.thickness}px`;
        el.style.background = accentBarGradient(color);
        el.style.borderRadius = `${opts.cardRadius}px 0 0 ${opts.cardRadius}px`;
        return;
    }

    el.style.display = "";

    if (opts.variant === "glassTube") {
        // A real tube, not a bordered L (the border version was visually
        // identical to cornerBracket — Neil, 2026-07-10). Two rounded
        // translucent arms with a fade-out gradient, neon glow, and a
        // specular highlight running along each arm. DOM API only.
        el.style.top = el.style.right = el.style.bottom = el.style.left = "";
        if (corner === "tl") { el.style.top = "0"; el.style.left = "0"; }
        else { el.style.bottom = "0"; el.style.right = "0"; }
        const tubeW = opts.thickness + 3;
        const glow = opts.muted || opts.glowMix === 0 ? "none" : `0 0 8px color-mix(in srgb, ${color} ${Math.max(opts.glowMix, 35)}%, transparent)`;
        const mkArm = (horizontal: boolean): HTMLElement => {
            const arm = document.createElement("div");
            arm.style.position = "absolute";
            arm.style.pointerEvents = "none";
            // Corner-end cap takes the configurable corner radius; the
            // free end keeps the pill cap.
            const rr = `${Math.max(2, opts.cardRadius)}px`;
            arm.style.borderRadius = horizontal
                ? (corner === "tl" ? `${rr} 99px 99px 99px` : `99px 99px ${rr} 99px`)
                : (corner === "tl" ? `${rr} 99px 99px 99px` : `99px 99px ${rr} 99px`);
            const fadeDir = horizontal
                ? (corner === "tl" ? "90deg" : "270deg")
                : (corner === "tl" ? "180deg" : "0deg");
            arm.style.background = `linear-gradient(${fadeDir}, ${color}, color-mix(in srgb, ${color} 55%, transparent) 70%, transparent)`;
            arm.style.boxShadow = glow;
            if (horizontal) {
                arm.style.height = `${tubeW}px`;
                arm.style.left = "0"; arm.style.right = "0";
                arm.style[corner === "tl" ? "top" : "bottom"] = "0";
            } else {
                arm.style.width = `${tubeW}px`;
                arm.style.top = "0"; arm.style.bottom = "0";
                arm.style[corner === "tl" ? "left" : "right"] = "0";
            }
            // Specular highlight strip along the arm (the "glass").
            const spec = document.createElement("div");
            spec.style.position = "absolute";
            spec.style.pointerEvents = "none";
            spec.style.borderRadius = "99px";
            spec.style.background = horizontal
                ? "linear-gradient(180deg, rgba(255,255,255,0.85), rgba(255,255,255,0) 65%)"
                : "linear-gradient(90deg, rgba(255,255,255,0.85), rgba(255,255,255,0) 65%)";
            if (horizontal) {
                spec.style.left = "8%"; spec.style.right = "35%";
                spec.style.top = "1px"; spec.style.height = `${Math.max(1, Math.floor(tubeW / 3))}px`;
            } else {
                spec.style.top = "8%"; spec.style.bottom = "35%";
                spec.style.left = "1px"; spec.style.width = `${Math.max(1, Math.floor(tubeW / 3))}px`;
            }
            arm.appendChild(spec);
            return arm;
        };
        el.appendChild(mkArm(true));
        el.appendChild(mkArm(false));
        el.style.filter = "none"; // glow lives on the arms' box-shadow
        return;
    }

    if (corner === "tl") {
        el.style.top = "0";
        el.style.left = "0";
        el.style.borderTop = `${opts.thickness}px solid ${color}`;
        el.style.borderLeft = `${opts.thickness}px solid ${color}`;
        el.style.borderRadius = `${opts.cardRadius}px 0 0 0`;
    } else {
        el.style.right = "0";
        el.style.bottom = "0";
        el.style.borderBottom = `${opts.thickness}px solid ${color}`;
        el.style.borderRight = `${opts.thickness}px solid ${color}`;
        el.style.borderRadius = `0 0 ${opts.cardRadius}px 0`;
    }
}

/**
 * makeCornerBrackets(parent, bandHex, opts): inserts the band/accent
 * tinted card-signature elements into `parent` (which should be
 * `position: relative` or `absolute`) and returns a handle whose
 * `update()` re-tints on every visual `update()` and whose `destroy()`
 * tears down on visual `destroy()`. Elements are appended LAST so they
 * paint above a title panel in normal DOM stacking order.
 */
export function makeCornerBrackets(
    parent: HTMLElement,
    bandHex: string,
    opts: CardSignatureOptions = {}
): CardSignatureHandle {
    const resolved = resolveOptions(opts);
    const elements: HTMLElement[] = [];

    const topLeft = document.createElement("div");
    topLeft.className = "codex-card-signature codex-card-signature-tl";
    styleBracket(topLeft, "tl", bandHex, resolved);
    parent.appendChild(topLeft);
    elements.push(topLeft);

    const bottomRight = document.createElement("div");
    bottomRight.className = "codex-card-signature codex-card-signature-br";
    if (resolved.variant === "flatBar" || !resolved.mirror) {
        bottomRight.style.display = "none";
    } else {
        styleBracket(bottomRight, "br", bandHex, resolved);
    }
    parent.appendChild(bottomRight);
    elements.push(bottomRight);

    function update(nextBandHex: string, nextOpts: CardSignatureOptions = {}): void {
        const nextResolved = resolveOptions(nextOpts, resolved);
        Object.assign(resolved, nextResolved);
        styleBracket(topLeft, "tl", nextBandHex, resolved);
        if (resolved.variant === "flatBar" || !resolved.mirror) {
            bottomRight.style.display = "none";
        } else {
            styleBracket(bottomRight, "br", nextBandHex, resolved);
        }
    }

    function destroy(): void {
        elements.forEach((el) => el.parentElement?.removeChild(el));
        elements.length = 0;
    }

    return { elements, update, destroy };
}
