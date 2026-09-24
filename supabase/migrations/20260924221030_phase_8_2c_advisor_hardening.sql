-- Phase 8.2C: tested advisor hardening; preserves table data and policy semantics.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- Tested staging-bootstrap privilege delta: keep CRUD only, without replacing tables.
-- PUBLIC receives no table grants; direct CRUD for existing roles is unchanged.
REVOKE ALL ON TABLE public.check_in_logs, public.groups, public.guests, public.service_days, public.shift_notes, public.staff_profiles, public.venues FROM PUBLIC;
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE public.check_in_logs, public.groups, public.guests, public.service_days, public.shift_notes, public.staff_profiles, public.venues FROM anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public."doorflow_autofill_check_in_log_venue_id"() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public."doorflow_autofill_group_venue_id"() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public."doorflow_autofill_guest_venue_id"() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public."doorflow_autofill_shift_note_venue_id"() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public."doorflow_current_role"() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public."doorflow_current_staff_profile"() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public."doorflow_current_venue_id"() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public."doorflow_has_role"(allowed_roles text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public."doorflow_has_venue_access"(target_venue_id uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public."doorflow_has_venue_role"(target_venue_id uuid, allowed_roles text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public."doorflow_is_active_staff"() FROM PUBLIC, anon;
CREATE INDEX check_in_logs_group_id_idx ON public.check_in_logs(group_id);
CREATE INDEX check_in_logs_guest_id_idx ON public.check_in_logs(guest_id);
CREATE INDEX groups_service_day_id_idx ON public.groups(service_day_id);
CREATE INDEX guests_added_by_user_id_idx ON public.guests(added_by_user_id);
CREATE INDEX guests_group_id_idx ON public.guests(group_id);
CREATE INDEX shift_notes_created_by_user_id_idx ON public.shift_notes(created_by_user_id);
CREATE INDEX staff_invitation_attempts_venue_id_idx ON public.staff_invitation_attempts(venue_id);
ALTER POLICY "doorflow staff can read own profile" ON public.staff_profiles USING (id = (SELECT auth.uid()));
COMMIT;
