"use strict";

import powerbi from "powerbi-visuals-api";

import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import LicenseInfoResult = powerbi.extensibility.visual.LicenseInfoResult;
import ServicePlan = powerbi.extensibility.visual.ServicePlan;

/**
 *  Licence gate — PROMPT, NEVER BLOCK.
 *
 *  AppSource never gates the download of a Power BI visual: every visual installs
 *  free for everyone. The ONLY thing that can require a purchase is this runtime
 *  check — and it PROMPTS, it does not block. Viewers always see the report;
 *  authors in Edit mode see Power BI's licence prompt. Creator-seat shaped.
 *
 *  Fails OPEN — renders normally — in the three cases where the platform cannot
 *  give a truthful answer, because a false block breaks a paying customer's
 *  report:
 *    - licence API absent (host older than API 4.7)
 *    - isLicenseInfoAvailable === false (Desktop signed out, or offline)
 *    - isLicenseUnsupportedEnv === true (Publish to Web, PaaS embed, national
 *      clouds, RS Server, PDF/PPT export via REST) — enforcement is impossible
 *      in these environments by Microsoft's own design.
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
 *  Raise Power BI's own licence prompt. The visual must not draw its own licence UX.
 *
 *  `General` — NOT `VisualIsBlocked`. Microsoft enforces `General` only in Power BI
 *  **Edit** scenarios; it returns false in Read mode and on dashboards. So the author
 *  who can actually buy a licence is prompted, and the report *keeps rendering* for
 *  every viewer.
 *
 *  `VisualIsBlocked` was the previous behaviour and it was unshippable: AppSource
 *  visuals auto-update, so publishing it would have blanked every existing install's
 *  live report at once — ~250 tenants, each of which had cleared a deliberate admin
 *  gate to allow SDK visuals at all. See feedback_paywall_configured_not_enforced.
 */
export function notifyLicenseRequired(host: IVisualHost): void {
    const mgr = host && host.licenseManager;
    if (!mgr || typeof mgr.notifyLicenseRequired !== "function") return;
    try {
        mgr.notifyLicenseRequired(powerbi.LicenseNotificationType.General);
    } catch {
        /* notification is best-effort */
    }
}

/** @deprecated Retained so existing imports keep compiling. Prompts, never blocks. */
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
 *  callback so the prompt lands as soon as the async check resolves; then call
 *  `blockedThisFrame()` at the top of update(). It always returns false — the call
 *  sites are retained deliberately so enforcement can never regress to blocking.
 */
export class LicenseGate {
    private state: LicenseState = OPEN;
    private notified = false;

    constructor(private host: IVisualHost, onResolved?: () => void) {
        checkLicense(host).then((s) => {
            this.state = s;
            if (onResolved) onResolved();
        });
    }

    public get blocked(): boolean {
        return this.state.blocked;
    }

    /**
     *  ALWAYS RETURNS FALSE — by design. The name is kept so all 15 visuals'
     *  `if (gate.blockedThisFrame()) return;` call sites keep compiling unchanged.
     *
     *  When the user holds no usable plan this raises Power BI's own licence prompt
     *  once (Edit scenarios only) and then lets the frame render. Nothing this visual
     *  does may ever leave a customer's report blank: a false block breaks a paying
     *  customer's work, and a true block breaks everyone who installed while the
     *  product was free.
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
        return false;
    }

    /** True when the platform gave a definitive "no valid plan" answer. Prompt-only. */
    public get unlicensed(): boolean {
        return this.state.blocked;
    }
}
