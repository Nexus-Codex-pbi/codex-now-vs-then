"use strict";

import powerbi from "powerbi-visuals-api";

import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import LicenseInfoResult = powerbi.extensibility.visual.LicenseInfoResult;
import ServicePlan = powerbi.extensibility.visual.ServicePlan;

/**
 *  Licence gate — NO FREE TIER.
 *
 *  AppSource never gates the download of a Power BI visual: every visual installs
 *  free for everyone. The ONLY thing that can require a purchase is this runtime
 *  check, so an unlicensed user gets the whole visual blocked (VisualIsBlocked),
 *  not a degraded version.
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

/** Raise Power BI's own blocking overlay. The visual must not draw its own licence UX. */
export function notifyBlocked(host: IVisualHost): void {
    const mgr = host && host.licenseManager;
    if (!mgr || typeof mgr.notifyLicenseRequired !== "function") return;
    try {
        mgr.notifyLicenseRequired(powerbi.LicenseNotificationType.VisualIsBlocked);
    } catch {
        /* notification is best-effort */
    }
}

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
 *  `blockedThisFrame()` at the top of update() and bail out when it returns true.
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
     *  True when this frame must not render. Raises the platform overlay once.
     *  Caller is responsible for emptying its own container.
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
            notifyBlocked(this.host);
            this.notified = true;
        }
        return true;
    }
}
