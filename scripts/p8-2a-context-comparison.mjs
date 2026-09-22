// Exact Step5A invitation-only integration edits, removed solely for historical
// protected-function comparisons. No whole function is exempted. A different
// hook, placement, query, auth decision or other byte still fails comparison.
const replacements = {
    render:[["function render() {\n  syncStaffInvitationContext();", "function render() {"]],
    ensureFreshAuthSession:[
      ["    auth.profile = null;\n    syncStaffInvitationContext(true);\n    stopAutoRefresh();", "    auth.profile = null;\n    stopAutoRefresh();"],
      ["  auth.session = session;\n  syncStaffInvitationContext();", "  auth.session = session;"]
    ],
    initAuth:[["    auth.session = session || null;\n    syncStaffInvitationContext();", "    auth.session = session || null;"]],
    loadStaffProfile:[
      ["async function loadStaffProfile(user, options = {}) {\n  syncStaffInvitationContext();", "async function loadStaffProfile(user, options = {}) {"],
      ["    active:profile.active\n  };\n  syncStaffInvitationContext();", "    active:profile.active\n  };"]
    ],
    logout:[["async function logout() {\n  resetStaffInvitationState();", "async function logout() {"]],
    ensureServiceDay:[["  state.venue = venue;\n  syncStaffInvitationContext();", "  state.venue = venue;"]],
    loadStaffProfilesForAdmin:[
      ["async function loadStaffProfilesForAdmin(invitationOwner = null) {\n  if (invitationOwner && !ownsStaffInvitationContext(invitationOwner)) return;", "async function loadStaffProfilesForAdmin() {"],
      ['    "Loading staff profiles",\n    15000\n  );\n  if (invitationOwner && !ownsStaffInvitationContext(invitationOwner)) return;', '    "Loading staff profiles",\n    15000\n  );']
    ]
};

export function withoutInvitationContextHooks(block) {
  const name = /^(?:async )?function (\w+)\(/.exec(block)?.[1];
  for (const [current, prior] of replacements[name] || []) block = block.replace(current, prior);
  return block;
}

export function hasInvitationContextHooks(source, extractFunction) {
  return Object.entries(replacements).every(([name, edits]) => {
    const block = extractFunction(source, name);
    return edits.every(([current]) => block.split(current).length === 2);
  });
}
