"use strict";

// ─── Shared Licence formatting card (2026-10-14) ──────────────────────
// One text slice: the Nexus Codex suite key (NCX1.<payload>.<sig>). Read by
// LicenseGate.blockedThisFrame(dataViews) straight off the DataView metadata
// and verified OFFLINE by suiteKey.ts — never sent anywhere.
//
// Pair with the capabilities object:
//   "licence": { properties: key(text) }
//
// Vendored from _shared/licensing/ by scripts/vendor-shared.mjs — edit there.

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

import FormattingSettingsCard = formattingSettings.SimpleCard;
import FormattingSettingsSlice = formattingSettings.Slice;

export class LicenceSettings extends FormattingSettingsCard {
    key = new formattingSettings.TextInput({
        name: "key",
        displayName: "Suite key",
        placeholder: "Paste your Nexus Codex suite key",
        value: ""
    });

    name = "licence";
    displayName = "Licence";
    slices: FormattingSettingsSlice[] = [this.key];
}
