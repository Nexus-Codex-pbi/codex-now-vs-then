"use strict";

// ─── Shared Motion Helper (v3) ───────────────────────────────
// DESIGN-LANGUAGE §6: values settle ONCE, capped at 400ms, ease-out,
// skippable, and honours `prefers-reduced-motion`. Nothing loops, no
// springs/bounces — glow/dim transitions stay in the 120-200ms band.
//
// `_shared/formatting/` v3 is additive-only (D-11); this module is
// proven by the Plan 15 pbiKpiCard pilot then frozen for the batch.

export const MOTION_MAX_MS = 400;
export const GLOW_TRANSITION_MIN_MS = 120;
export const GLOW_TRANSITION_MAX_MS = 200;

export const EASE_OUT = "ease-out";
/** Slight overshoot — reserved for the "now active" state only (§6). */
export const EASE_OUT_OVERSHOOT = "cubic-bezier(0.34, 1.2, 0.64, 1)";

export interface SettleOptions {
    /** Capped at MOTION_MAX_MS regardless of what is requested. */
    duration?: number;
    easing?: string;
    onFinish?: () => void;
}

function prefersReducedMotion(): boolean {
    try {
        return (
            typeof window !== "undefined" &&
            typeof window.matchMedia === "function" &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
        );
    } catch {
        return false;
    }
}

/**
 * settle(el, keyframes, opts): plays a single, non-looping Web
 * Animations API animation capped at MOTION_MAX_MS. Skips straight to
 * the finished state (calling `onFinish` synchronously, no animation)
 * when the host honours `prefers-reduced-motion`, or when the element
 * has no `animate` method — motion is polish, never load-bearing for
 * correct rendering.
 */
export function settle(
    el: HTMLElement | SVGElement,
    keyframes: Keyframe[] | PropertyIndexedKeyframes,
    opts: SettleOptions = {}
): Animation | null {
    const duration = Math.min(opts.duration ?? MOTION_MAX_MS, MOTION_MAX_MS);
    const easing = opts.easing ?? EASE_OUT;

    const animatable = el as unknown as { animate?: (kf: unknown, o: unknown) => Animation };
    if (prefersReducedMotion() || typeof animatable.animate !== "function") {
        opts.onFinish?.();
        return null;
    }

    const animation = animatable.animate(keyframes, { duration, easing, iterations: 1, fill: "forwards" });
    if (opts.onFinish) {
        animation.onfinish = () => opts.onFinish?.();
    }
    return animation;
}

/** glowTransition(ms): a CSS `transition` value for glow/dim state changes (120-200ms, ease-out). */
export function glowTransition(ms: number = GLOW_TRANSITION_MIN_MS): string {
    const clamped = Math.max(GLOW_TRANSITION_MIN_MS, Math.min(GLOW_TRANSITION_MAX_MS, ms));
    return `filter ${clamped}ms ${EASE_OUT}, box-shadow ${clamped}ms ${EASE_OUT}`;
}
