"use strict";

/**
 *  Suite licence key — OFFLINE verification only.
 *
 *  The problem this solves: Microsoft's licensing API is scoped per-visual —
 *  "Licenses purchased for any other visuals aren't included in the response" — so a
 *  Microsoft-transactable SUITE licence cannot exist. A customer buying "all 15" has no
 *  way to tell visual #7 that they paid.
 *
 *  The mechanism (Zebra BI proves it, and keeps the Certified badge): the customer buys a
 *  marketplace **SaaS offer** — Microsoft stays merchant of record, handles tax and payout —
 *  our fulfilment endpoint issues a signed key, and the customer pastes that key into the
 *  format pane. Every visual verifies the signature LOCALLY.
 *
 *  ⚠ CERTIFICATION-CRITICAL: this module makes NO network call, ever. Certification forbids
 *  `fetch` / `XMLHttpRequest` / `WebSocket` — it does not forbid `crypto.subtle`. If anyone
 *  is ever tempted to "just check the key with the server", that single line fails cert for
 *  all 15 visuals. Verification is a signature check against a public key baked into the
 *  bundle. The private key never leaves the fulfilment service.
 *
 *  Key format (single line, safe to paste):
 *      NCX1.<base64url(payload JSON)>.<base64url(ECDSA P-256 signature)>
 *  Payload:
 *      { t: "<tenant id or org name>", e: "<ISO expiry>", s: ["kpi-card", ...] | "*" }
 *
 *  Failure posture mirrors licensing.ts: a key that cannot be verified NEVER blanks the
 *  report. It simply does not grant suite entitlement, and the per-visual prompt applies.
 */

/**
 *  SPKI public key (base64) for the fulfilment service's ECDSA P-256 signing pair.
 *  Public by design — it can only VERIFY. The private half lives solely on the fulfilment
 *  host (mission-control, `~/.nexus_suite_signing_key.pem`, 0600) and is never built into a
 *  bundle. Rotating this value invalidates every key already issued to a customer.
 */
const SUITE_PUBLIC_KEY_SPKI_B64 =
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEYoU4utHTrsi+S/D63SjK42iM540jzN3eAj7QQBfV2a8kHhsuD+QzhtjLkIjngnfMpV8qWRqrgE/u2fbeZZdLIg==";

export interface SuiteEntitlement {
    /** A verified, unexpired key granting this visual. */
    granted: boolean;
    /** Why not, for diagnostics only — never surfaced as licence UX. */
    reason: "ok" | "absent" | "malformed" | "bad-signature" | "expired" | "not-in-suite" | "unavailable";
    tenant?: string;
    expires?: string;
}

const DENY = (reason: SuiteEntitlement["reason"]): SuiteEntitlement => ({ granted: false, reason });

function b64urlToBytes(s: string): Uint8Array | null {
    try {
        const pad = s.replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(pad + "===".slice((pad.length + 3) % 4));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
}

/**
 *  Verify a pasted suite key for THIS visual.
 *
 *  @param key      raw string from the format pane (may be empty/whitespace)
 *  @param visualId this visual's slug as it appears in the payload's `s` array
 *  @param now      injectable clock so expiry is testable
 */
export async function verifySuiteKey(
    key: string,
    visualId: string,
    now: Date = new Date()
): Promise<SuiteEntitlement> {
    const raw = (key || "").trim();
    if (!raw) return DENY("absent");

    const parts = raw.split(".");
    if (parts.length !== 3 || parts[0] !== "NCX1") return DENY("malformed");

    const payloadBytes = b64urlToBytes(parts[1]);
    const sigBytes = b64urlToBytes(parts[2]);
    const pubBytes = b64urlToBytes(SUITE_PUBLIC_KEY_SPKI_B64.replace(/\s/g, ""));
    if (!payloadBytes || !sigBytes || !pubBytes || pubBytes.length === 0) return DENY("malformed");

    const subtle = (globalThis.crypto && globalThis.crypto.subtle) || null;
    if (!subtle) return DENY("unavailable");

    let ok = false;
    try {
        const pub = await subtle.importKey(
            "spki",
            pubBytes as BufferSource,
            { name: "ECDSA", namedCurve: "P-256" },
            false,
            ["verify"]
        );
        ok = await subtle.verify(
            { name: "ECDSA", hash: "SHA-256" },
            pub,
            sigBytes as BufferSource,
            payloadBytes as BufferSource
        );
    } catch {
        return DENY("unavailable");
    }
    if (!ok) return DENY("bad-signature");

    let payload: { t?: string; e?: string; s?: string[] | string };
    try {
        payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    } catch {
        return DENY("malformed");
    }

    if (payload.e) {
        const exp = Date.parse(payload.e);
        if (!isNaN(exp) && exp < now.getTime()) {
            return { granted: false, reason: "expired", tenant: payload.t, expires: payload.e };
        }
    }

    const scope = payload.s;
    const covers = scope === "*" || (Array.isArray(scope) && scope.indexOf(visualId) !== -1);
    if (!covers) return { granted: false, reason: "not-in-suite", tenant: payload.t, expires: payload.e };

    return { granted: true, reason: "ok", tenant: payload.t, expires: payload.e };
}
