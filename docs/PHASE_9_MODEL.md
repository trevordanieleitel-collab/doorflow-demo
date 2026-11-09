# Phase 9 model decision

Release base: `6593c887e67d431c73d4d93399dd7f70e3fd996f`.

Live audit on November 8, 2026: production contains organizations, subscription_accounts, venue_settings, venue_branding and both membership tables. Staging contains none of those six deferred tables. Existing production has one legacy organization, one legacy manual subscription, one EVE venue, and one settings/branding record. Reuse the four product tables; create their compatible definitions where absent. Membership tables remain unused and closed to browsers.

An organization is a customer, with one venue initially. New customers receive a manual standard subscription. Organizations can exist independently. Only the trusted operator tool creates customers/venues, assigns first Admins, or changes lifecycle/subscription states. No platform account or multi-venue authority is introduced. Staff authority remains the active profile keyed by auth.uid().

Existing legacy subscriptions remain supported without inventing payment history. The sole existing production venue is associated with the sole existing legacy organization only after a uniqueness guard. Other pre-existing unowned staging venues retain legacy compatibility until explicitly adopted. All newly onboarded venues require an organization.

Active venues with active customers and trial/active (or preserved legacy) subscriptions permit operations. Trial dates are informational until billing is implemented; expiry does not silently lock out a venue. Onboarding permits own-venue setup only. Suspended/canceled denies operational data access and writes and invitations, preserves data, and allows the assigned profile to read a status/settings screen. Reactivation is a trusted audited action. Customer/subscription denial overrides active venue status.

First Admin bootstrap is a server-only reservation followed by verified Auth identity binding. Conflicting existing profiles are refused; retries never move or promote employees. Temporary-password confirmed-user creation is permitted only against the exact staging project and fictional example.invalid addresses. Production bootstrap links a verified existing Auth identity; customer email activation remains separately gated.

Settings editing uses a narrow Admin-only RPC; browsers cannot update organization ownership, lifecycle, or arbitrary settings columns. Generic branding/defaults apply to new venues. Existing B.O.B. presentation is retained only for the existing legacy venue. Logo references do not upload files or provision storage.

No billing, SMTP provider purchase, DNS changes, email sending, or membership-based authorization is part of this release.
