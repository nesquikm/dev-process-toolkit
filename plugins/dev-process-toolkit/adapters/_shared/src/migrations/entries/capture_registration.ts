// M_7bc805 STE-716 — the `capture-registration` migration keeps the user's own
// tool-call capture entry in `.claude/settings.local.json` in step with the
// `tracking.tool_calls.enabled` switch in the working-tree `specs/settings.yaml`.
//
// DETECT. Pure: reads the setting through the loader (a foreign settings file
// reads off) and the registration through `captureStatus`. Applies when the
// setting is on and the registration is `none` or `stale`, or when the setting
// is off and a capture entry exists.
//
// APPLY. Registers (setting on) or unregisters (setting off) through
// `capture_registration.ts`. Never edits, restores or commits the settings file.
// Registered after `settings-file`; `requires_explicit_approval` keeps it out of
// auto-approve runs, because it writes a user's own settings file.

import { captureStatus, LOCAL_SETTINGS_REL, registerCapture, unregisterCapture } from "../../capture_registration";
import type { ApplyResult, DetectResult, MigrationEntry } from "../index";

export const captureRegistration: MigrationEntry = {
  id: "capture-registration",
  introduced_in: "3.1.0",
  title: "the tool-call capture entry in `.claude/settings.local.json` matches `tracking.tool_calls.enabled`",
  kind: "script",
  requires_explicit_approval: true,
  detect(projectRoot: string): DetectResult {
    const s = captureStatus(projectRoot);
    if (s.setting === "on" && s.registration !== "current") {
      return {
        applies: true,
        evidence: [`tracking.tool_calls.enabled is on and ${LOCAL_SETTINGS_REL} holds ${s.registration === "none" ? "no" : "a stale"} capture entry`],
      };
    }
    if (s.setting === "off" && s.registration !== "none") {
      return {
        applies: true,
        evidence: [`tracking.tool_calls.enabled is off and ${LOCAL_SETTINGS_REL} still holds a capture entry`],
      };
    }
    return { applies: false, evidence: [] };
  },
  apply(projectRoot: string): ApplyResult {
    const s = captureStatus(projectRoot);
    if (s.setting === "on") {
      if (s.registration === "current") return { changed: [], summary: "the capture entry is already current" };
      const refusals = registerCapture(projectRoot);
      if (refusals.length > 0) return { changed: [], summary: refusals.join("\n\n") };
      return { changed: [LOCAL_SETTINGS_REL], summary: `registered the tool-call capture hook in ${LOCAL_SETTINGS_REL}` };
    }
    if (s.registration === "none") return { changed: [], summary: "no capture entry to remove" };
    unregisterCapture(projectRoot);
    return { changed: [LOCAL_SETTINGS_REL], summary: `removed the tool-call capture entry from ${LOCAL_SETTINGS_REL}` };
  },
};
