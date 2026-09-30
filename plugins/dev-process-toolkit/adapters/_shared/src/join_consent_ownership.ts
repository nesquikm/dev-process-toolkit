// join_consent_ownership.ts — STE-650 AC.1: the ONE ownership predicate the
// tracker-write hook (gateJoinedLabels) and the live grader (gatedWrites) both
// call to decide whether a key's ownership route waives a forbidden join's
// consent. Neither caller re-implements it.
//
// Only a key this session CREATED is its own and needs no join consent. A key
// owned through an FR binding or a reuse, binding or import receipt still
// needs the answered consent. Review TWR-4: the exemption waives ONLY the
// consent half — the labels read-merge is checked for every joined Epic.

/** The route by which a session owns a ticket key. */
export type OwnershipRoute = "created" | "fr-binding" | "reuse-receipt" | "binding-receipt" | "import-receipt";

/**
 * True only when ownership by `route` exempts a write from the join consent.
 * Any other string — the hook's `"not-created"`, which is all it can tell
 * apart from `"created"` — is not exempt.
 */
export function exemptsJoinConsent(route: OwnershipRoute | string): boolean {
  return route === "created";
}
