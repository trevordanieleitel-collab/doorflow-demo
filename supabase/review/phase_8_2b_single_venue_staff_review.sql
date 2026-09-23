-- REVIEW ONLY: apply only after separately approved schema/privilege review.
-- Single staff_profiles.venue_id authority; no membership authorization.
-- Reuses the existing active-caller boolean helper. No new definer, grants,
-- tables, role changes, Auth writes or changes to invitation RPC contracts.
BEGIN;
SET LOCAL lock_timeout = '5s';
LOCK TABLE public.staff_profiles IN ACCESS EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.staff_profiles'::regclass)
     OR to_regprocedure('public.doorflow_has_venue_role(uuid,text[])') IS NULL THEN
    RAISE EXCEPTION 'Expected staff RLS/helper prerequisites missing';
  END IF;
  IF (SELECT array_agg(policyname::text ORDER BY policyname) FROM pg_policies
      WHERE schemaname='public' AND tablename='staff_profiles') IS DISTINCT FROM
     ARRAY['doorflow admins can manage profiles','doorflow admins can read all profiles','doorflow staff can read own profile']::text[] THEN
    RAISE EXCEPTION 'Unexpected staff policy inventory; review before applying';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='staff_profiles'
      AND policyname='doorflow staff can read own profile' AND cmd='SELECT'
      AND roles=ARRAY['authenticated']::name[] AND qual='(id = auth.uid())' AND with_check IS NULL) THEN
    RAISE EXCEPTION 'Unexpected self-profile bootstrap policy';
  END IF;
END
$guard$;
DROP POLICY "doorflow admins can manage profiles" ON public.staff_profiles;
DROP POLICY "doorflow admins can read all profiles" ON public.staff_profiles;
CREATE POLICY "doorflow same venue admins select profiles" ON public.staff_profiles
  FOR SELECT TO authenticated
  USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin']::text[]));
CREATE POLICY "doorflow same venue admins insert profiles" ON public.staff_profiles
  FOR INSERT TO authenticated
  WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin']::text[]));
CREATE POLICY "doorflow same venue admins update profiles" ON public.staff_profiles
  FOR UPDATE TO authenticated
  USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin']::text[]))
  WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin']::text[]));
CREATE POLICY "doorflow same venue admins delete profiles" ON public.staff_profiles
  FOR DELETE TO authenticated
  USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin']::text[]));
COMMIT;

-- Verification: four same-venue policies and unchanged self SELECT; grants,
-- helper definitions/owners/ACL, role flags and other table policies unchanged.
SELECT policyname, roles, cmd, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='staff_profiles' ORDER BY policyname;
