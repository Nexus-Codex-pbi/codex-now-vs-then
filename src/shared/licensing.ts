"use strict";

import powerbi from "powerbi-visuals-api";

import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import LicenseInfoResult = powerbi.extensibility.visual.LicenseInfoResult;
import ServicePlan = powerbi.extensibility.visual.ServicePlan;

/**
 *  Licence gate — HARD BLOCK.
 *
 *  DECISION 2026-09-10, Neil. Enforcement is a hard block: a user the platform
 *  definitively reports as holding no usable service plan gets the visual blocked,
 *  not merely prompted.
 *
 *  Blast radius, accepted with full knowledge when the decision was made: AppSource
 *  visuals auto-update, so the next published version blocks every existing install
 *  at once — on the order of 250 tenants, whose live reports go blank where they use
 *  these visuals without a licence. That is the intended outcome. Ten of the fifteen
 *  visuals had been given away for roughly five months because enforcement was
 *  configured but never enforced; the cost of continuing to give them away was judged
 *  higher than the cost of the blank reports.
 *
 *  DO NOT re-litigate this, soften it, or stage it. If you are reading this because a
 *  tenant complained, that complaint is the mechanism working. Route it to a purchase,
 *  not to a code change.
 *
 *  ---------------------------------------------------------------------------
 *  SUPERSEDED — the previous rationale, retained so it is not rediscovered and
 *  re-argued from scratch:
 *
 *    "Licence gate — PROMPT, NEVER BLOCK. AppSource never gates the download of a
 *    Power BI visual: every visual installs free for everyone. The ONLY thing that
 *    can require a purchase is this runtime check — and it PROMPTS, it does not
 *    block. Viewers always see the report; authors in Edit mode see Power BI's
 *    licence prompt. Creator-seat shaped. `General` — NOT `VisualIsBlocked`.
 *    Microsoft enforces `General` only in Power BI Edit scenarios; it returns false
 *    in Read mode and on dashboards. So the author who can actually buy a licence is
 *    prompted, and the report *keeps rendering* for every viewer. `VisualIsBlocked`
 *    was the previous behaviour and it was unshippable: AppSource visuals
 *    auto-update, so publishing it would have blanked every existing install's live
 *    report at once — ~250 tenants, each of which had cleared a deliberate admin
 *    gate to allow SDK visuals at all. See feedback_paywall_configured_not_enforced."
 *
 *  That reasoning was correct about the mechanics and wrong about the trade. The
 *  blank reports it protects against are now the accepted price. Its one enduring
 *  contribution is the fail-open set below, which survives unchanged.
 *  ---------------------------------------------------------------------------
 *
 *  STILL fails OPEN — renders normally — in the three cases where the platform cannot
 *  give a truthful answer, because a false block breaks a PAYING customer's report,
 *  which is strictly worse than a freeloader rendering:
 *    - licence API absent, or getAvailableServicePlans throws (host older than API 4.7)
 *    - isLicenseInfoAvailable === false (Desktop signed out, or offline)
 *    - isLicenseUnsupportedEnv === true (Publish to Web, PaaS embed, national
 *      clouds, RS Server, PDF/PPT export via REST) — enforcement is impossible
 *      in these environments by Microsoft's own design.
 *  These three are NON-NEGOTIABLE. Blocking is only ever driven by a definitive
 *  platform answer of "no usable plan".
 *
 *  It also renders while the asynchronous check is still in flight; the gate starts
 *  OPEN and the redraw callback re-runs update() once the answer lands. A licensed
 *  user therefore never sees a flash of blocked state.
 *
 *  LIFECYCLE: the gate holds an in-flight promise that outlives the visual. Call
 *  `dispose()` as the FIRST line of the visual's destroy() — NEXUS lifecycle finding
 *  (cycle-01 §5, cycle-05 §9) caught the redraw callback replaying update() against a
 *  destroyed target and throwing a live renderingFailed on page change.
 *
 *  NOTE: powerbi.ServicePlanState and powerbi.LicenseNotificationType are
 *  `const enum`s — they must be referenced inline and never aliased to a local,
 *  or `pbiviz package` fails with TS2475.
 */

export interface LicenseState {
    /** True only when the platform gave a definitive "no valid plan" answer. */
    blocked: boolean;
    /** A licence check ran and returned a usable answer. */
    resolved: boolean;
    activePlans: string[];
}

const OPEN: LicenseState = { blocked: false, resolved: false, activePlans: [] };

/** Active and Warning (grace period) are the only usable states. */
function isUsable(plan: ServicePlan): boolean {
    return (
        plan.state === powerbi.ServicePlanState.Active ||
        plan.state === powerbi.ServicePlanState.Warning
    );
}

export function checkLicense(host: IVisualHost): Promise<LicenseState> {
    const mgr = host && host.licenseManager;
    if (!mgr || typeof mgr.getAvailableServicePlans !== "function") {
        return Promise.resolve(OPEN);
    }

    let pending: PromiseLike<LicenseInfoResult>;
    try {
        pending = mgr.getAvailableServicePlans();
    } catch {
        return Promise.resolve(OPEN);
    }

    return Promise.resolve(pending).then(
        (info: LicenseInfoResult) => {
            // Cannot enforce truthfully — fail open.
            if (!info || !info.isLicenseInfoAvailable || info.isLicenseUnsupportedEnv) {
                return OPEN;
            }
            const usable = (info.plans || []).filter(isUsable);
            return {
                blocked: usable.length === 0,
                resolved: true,
                activePlans: usable.map((p) => p.spIdentifier),
            };
        },
        () => OPEN
    );
}

/**
 *  Raise Power BI's own blocking licence notification. The visual must not draw its
 *  own licence UX.
 *
 *  `VisualIsBlocked` — NOT `General`. `General` is the corner-icon prompt that Power BI
 *  honours only in Edit scenarios, which is what made the previous build unenforced in
 *  Read mode and on dashboards. `VisualIsBlocked` renders Power BI's own full blocking
 *  overlay with the upgrade button, in every scenario.
 *
 *  Referenced inline: `import X = powerbi.LicenseNotificationType` fails
 *  `pbiviz package` with TS2475 because it is a const enum.
 */
export function notifyLicenseRequired(host: IVisualHost): void {
    const mgr = host && host.licenseManager;
    if (!mgr || typeof mgr.notifyLicenseRequired !== "function") return;
    try {
        mgr.notifyLicenseRequired(powerbi.LicenseNotificationType.VisualIsBlocked);
    } catch {
        /* notification is best-effort */
    }
}

/** @deprecated Retained so existing imports keep compiling. Now blocks. */
export const notifyBlocked = notifyLicenseRequired;

export function clearNotification(host: IVisualHost): void {
    const mgr = host && host.licenseManager;
    if (!mgr || typeof mgr.clearLicenseNotification !== "function") return;
    try {
        mgr.clearLicenseNotification();
    } catch {
        /* best-effort */
    }
}

/**
 *  Drop-in gate. Construct once in the visual's constructor, passing a redraw
 *  callback so the block lands as soon as the async check resolves; then call
 *  `blockedThisFrame()` at the top of update() and return early when it is true.
 */
export class LicenseGate {
    private state: LicenseState = OPEN;
    private notified = false;
    private disposed = false;
    private onResolved?: () => void;

    constructor(private host: IVisualHost, onResolved?: () => void) {
        this.onResolved = onResolved;
        checkLicense(host).then((s) => {
            if (this.disposed) return;
            this.state = s;
            if (this.onResolved) this.onResolved();
        });
    }

    /**
     *  Abandon the in-flight licence check. MUST be the FIRST line of the visual's
     *  destroy(): the constructor's promise resolves long after Power BI tears the
     *  visual down on a page change, and the redraw callback replays update() against
     *  a nulled DOM target — "Cannot read properties of null (reading 'style')", a
     *  live renderingFailed (NEXUS lifecycle finding, cycle-01 §5 / cycle-05 §9).
     *  Idempotent; safe to call when no check is outstanding.
     */
    public dispose(): void {
        this.disposed = true;
        this.onResolved = undefined;
    }

    public get blocked(): boolean {
        return this.state.blocked;
    }

    /**
     *  TRUE when the platform definitively reported no usable service plan — the
     *  caller must hide its content and return without rendering.
     *
     *  Returns FALSE — renders — for a licensed user, for an in-flight check, and for
     *  every one of the three fail-open cases in checkLicense(). Only a definitive
     *  "no usable plan" blocks.
     */
    public blockedThisFrame(): boolean {
        if (!this.state.blocked) {
            if (this.notified) {
                clearNotification(this.host);
                this.notified = false;
            }
            return false;
        }
        if (!this.notified) {
            notifyLicenseRequired(this.host);
            this.notified = true;
        }
        return true;
    }

    /** True when the platform gave a definitive "no valid plan" answer. */
    public get unlicensed(): boolean {
        return this.state.blocked;
    }
}
