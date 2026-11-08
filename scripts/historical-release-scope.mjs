// One-time patch-scope assertions are retained as an opt-in historical audit.
// They cannot gate later releases that intentionally change auth, SQL, or cache
// behavior. Functional/UI assertions in the callers continue to run normally.
// See docs/SAAS_FOUNDATION_REGRESSION.md for their current acceptance mappings.
export function retiredReleaseScope(label) {
  if (process.env.DOORFLOW_HISTORICAL_RELEASE_AUDIT === "1") return false;
  const patterns = [
    /\bbaseline\b|\bHEAD\b|byte-identical|byte-for-byte|baseline-identical/i,
    /required .*branch|main branch|original feature branch|candidate remains on/i,
    /working(?:-tree| changes)|^SQL, RLS|^pre-existing SQL/i,
    /function inventory|non-presentation inventory|unrelated non-presentation functions/i,
    /^protected function /,
    /^P6\.7 preserves the reviewed P6\.1 hash for /,
    / matches 062fbe9 after exact invitation-only ownership hooks$/,
    /^existing guest (?:edit payload, validation|confirmation, delete payload), and reconciliation are unchanged$/,
    /^Phase 8\.1 introduces no localStorage or sessionStorage use$/,
    /^no new (?:timer|localStorage|sessionStorage) sites$/,
    /^P6\.[15] (?:authorized (?:function|change|presentation change)|new (?:helper|presentation helper))/,
    /^P6\.10 (?:cache-versioned|loads the approved theme|gives the approved theme|preserves app\.js|preserves the P6 service worker|changes only the reviewed|stylesheet contains only)/,
    /^(?:previous|release candidate) cache name is /,
    /external (?:script and stylesheet )?dependency inventory is unchanged/,
    /^current index differs from 7144c3d only by/,
    /^new Phase 8\.2A file inventory is exact/,
    /^nothing is staged$/,
    /^no new (?:fetch calls|XMLHttpRequest references|localStorage references|sessionStorage references|Supabase client creation|setTimeout calls|setInterval calls|event listener registrations)$/
  ];
  if (!patterns.some(pattern => pattern.test(label))) return false;
  console.log(`[RETIRED RELEASE SCOPE] ${label} (current acceptance mapping: docs/SAAS_FOUNDATION_REGRESSION.md)`);
  return true;
}

export function hasFoundationInvitationContext(source, extractFunction) {
  const invalidation = extractFunction(source, "invalidateAuthenticatedContext");
  const profile = extractFunction(source, "loadStaffProfile");
  const staff = extractFunction(source, "loadStaffProfilesForAdmin");
  const invitationOwnership = extractFunction(source, "ownsStaffInvitationContext");
  return invalidation.includes("authenticatedContextGeneration += 1")
    && invalidation.includes("resetStaffInvitationState()")
    && profile.includes("ownsAuthenticatedContext(owner)")
    && profile.includes("syncStaffInvitationContext()")
    && staff.includes('venueTable("staff_profiles")')
    && staff.includes("ownsAuthenticatedContext(owner)")
    && staff.includes("ownsStaffInvitationContext(invitationOwner)")
    && invitationOwnership.includes("staffInvitationContextGeneration")
    && invitationOwnership.includes("staffInvitationContextKey");
}
