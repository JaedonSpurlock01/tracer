/**
 * -------------------------------------------------------------------------
 * @file   workspace-setup-wizard.test.tsx
 * @brief  Checks the words the setup wizard gives an Operator when activation is refused.
 *
 * @description
 *  Maps each activation refusal the Workspace routing route can answer to
 *  the sentence the Review step shows, so a missing Twilio Auth Token or
 *  an unconnected Twilio is named instead of "Workspace could not be
 *  activated".
 *
 * @remarks
 *  Production on 2026-10-25 answered twilio_auth_token_missing twice and
 *  the Operator only saw the generic sentence.
 *
 * @see
 *  components/tracer/workspace-setup-wizard.tsx
 *
 * @author Jaedon Spurlock
 * -------------------------------------------------------------------------
 */
import { describe, expect, it } from "vitest";

import { activationFailureMessage } from "@/components/tracer/workspace-setup-wizard";

describe("activation failure messages", () => {
  it("names the Twilio Auth Token, an unconnected Twilio, and an unreadable credential", () => {
    expect(activationFailureMessage(409, { error: "twilio_auth_token_missing" })).toBe("Add the Twilio Auth Token on Integrations before activating; Tracer needs it to verify Twilio's webhooks.");
    expect(activationFailureMessage(409, { error: "twilio_not_connected" })).toBe("Connect Twilio on Integrations before activating.");
    expect(activationFailureMessage(409, { error: "credential_unreadable" })).toBe("The Twilio credential needs re-entry on Integrations before activating.");
    expect(activationFailureMessage(409, { error: "number_unavailable" })).toBe("This number is no longer available.");
    expect(activationFailureMessage(409, { error: "draft_required" })).toBe("Save a Call Flow before activating.");
    expect(activationFailureMessage(409, { error: "state_unchanged" })).toBe("This Workspace is no longer waiting for activation. Reload to see its current state.");
  });

  it("keeps the Twilio outage sentence for 502 and a generic sentence for anything else", () => {
    expect(activationFailureMessage(502, { error: "provider_unavailable" })).toBe("Twilio could not be updated. The Workspace remains Setup Required.");
    expect(activationFailureMessage(500, { error: "internal_error" })).toBe("Workspace could not be activated.");
    expect(activationFailureMessage(409, {})).toBe("Workspace could not be activated.");
  });
});
