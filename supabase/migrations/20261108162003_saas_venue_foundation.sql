-- DoorFlow SaaS / Venue Foundation. Phase 8.2C staff and invitation contracts remain intact.
-- Nullable columns and their original ON DELETE actions are deliberately preserved.
-- Reconciled against live staging on 2026-11-08; deferred fixture tables are not required.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
LOCK TABLE public.venues,public.service_days,public.groups,public.guests,
  public.check_in_logs,public.shift_notes,public.staff_profiles IN SHARE ROW EXCLUSIVE MODE;

DO $preflight$
DECLARE actual jsonb; helper text;
BEGIN
  SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,column_name) INTO actual
  FROM (SELECT table_name,column_name,data_type,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY(ARRAY['check_in_logs','groups','guests','service_days','shift_notes','staff_profiles','venues'])) c;
  IF actual IS DISTINCT FROM (SELECT jsonb_agg(j ORDER BY j->>'table_name',j->>'column_name') FROM jsonb_array_elements($expected$[{"table_name":"check_in_logs","column_name":"id","data_type":"uuid","is_nullable":"NO","column_default":"gen_random_uuid()"},{"table_name":"check_in_logs","column_name":"guest_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"check_in_logs","column_name":"group_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"check_in_logs","column_name":"action","data_type":"text","is_nullable":"NO","column_default":null},{"table_name":"check_in_logs","column_name":"amount","data_type":"integer","is_nullable":"NO","column_default":"1"},{"table_name":"check_in_logs","column_name":"door_location","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"check_in_logs","column_name":"staff_user_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"check_in_logs","column_name":"staff_name","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"check_in_logs","column_name":"created_at","data_type":"timestamp with time zone","is_nullable":"NO","column_default":"now()"},{"table_name":"check_in_logs","column_name":"venue_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"groups","column_name":"id","data_type":"uuid","is_nullable":"NO","column_default":"gen_random_uuid()"},{"table_name":"groups","column_name":"service_day_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"groups","column_name":"name","data_type":"text","is_nullable":"NO","column_default":null},{"table_name":"groups","column_name":"group_type","data_type":"text","is_nullable":"NO","column_default":"'General Guest List'::text"},{"table_name":"groups","column_name":"host_name","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"groups","column_name":"table_location","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"groups","column_name":"approved_by","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"groups","column_name":"notes","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"groups","column_name":"status","data_type":"text","is_nullable":"NO","column_default":"'Active'::text"},{"table_name":"groups","column_name":"created_at","data_type":"timestamp with time zone","is_nullable":"NO","column_default":"now()"},{"table_name":"groups","column_name":"venue_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"id","data_type":"uuid","is_nullable":"NO","column_default":"gen_random_uuid()"},{"table_name":"guests","column_name":"group_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"first_name","data_type":"text","is_nullable":"NO","column_default":null},{"table_name":"guests","column_name":"last_name","data_type":"text","is_nullable":"NO","column_default":null},{"table_name":"guests","column_name":"guest_type","data_type":"text","is_nullable":"NO","column_default":"'Guest'::text"},{"table_name":"guests","column_name":"total_allowed","data_type":"integer","is_nullable":"NO","column_default":"1"},{"table_name":"guests","column_name":"checked_in_count","data_type":"integer","is_nullable":"NO","column_default":"0"},{"table_name":"guests","column_name":"notes","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"last_checked_in_at","data_type":"timestamp with time zone","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"last_checked_in_by","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"last_door_location","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"created_at","data_type":"timestamp with time zone","is_nullable":"NO","column_default":"now()"},{"table_name":"guests","column_name":"last_checked_in_by_name","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"added_by_user_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"added_by_name","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"added_at","data_type":"timestamp with time zone","is_nullable":"YES","column_default":"now()"},{"table_name":"guests","column_name":"is_late_add","data_type":"boolean","is_nullable":"NO","column_default":"false"},{"table_name":"guests","column_name":"late_add_approved_by","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"late_add_reason","data_type":"text","is_nullable":"YES","column_default":null},{"table_name":"guests","column_name":"venue_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"service_days","column_name":"id","data_type":"uuid","is_nullable":"NO","column_default":"gen_random_uuid()"},{"table_name":"service_days","column_name":"venue_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"service_days","column_name":"service_date","data_type":"date","is_nullable":"NO","column_default":null},{"table_name":"service_days","column_name":"day_name","data_type":"text","is_nullable":"NO","column_default":null},{"table_name":"service_days","column_name":"created_at","data_type":"timestamp with time zone","is_nullable":"NO","column_default":"now()"},{"table_name":"shift_notes","column_name":"id","data_type":"uuid","is_nullable":"NO","column_default":"gen_random_uuid()"},{"table_name":"shift_notes","column_name":"service_day_id","data_type":"uuid","is_nullable":"NO","column_default":null},{"table_name":"shift_notes","column_name":"category","data_type":"text","is_nullable":"NO","column_default":"'General Note'::text"},{"table_name":"shift_notes","column_name":"priority","data_type":"text","is_nullable":"NO","column_default":"'Normal'::text"},{"table_name":"shift_notes","column_name":"note_text","data_type":"text","is_nullable":"NO","column_default":null},{"table_name":"shift_notes","column_name":"created_by_user_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"shift_notes","column_name":"created_by_name","data_type":"text","is_nullable":"NO","column_default":"'Unknown'::text"},{"table_name":"shift_notes","column_name":"created_at","data_type":"timestamp with time zone","is_nullable":"NO","column_default":"now()"},{"table_name":"shift_notes","column_name":"venue_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"staff_profiles","column_name":"id","data_type":"uuid","is_nullable":"NO","column_default":null},{"table_name":"staff_profiles","column_name":"full_name","data_type":"text","is_nullable":"NO","column_default":null},{"table_name":"staff_profiles","column_name":"role","data_type":"text","is_nullable":"NO","column_default":"'door'::text"},{"table_name":"staff_profiles","column_name":"active","data_type":"boolean","is_nullable":"NO","column_default":"true"},{"table_name":"staff_profiles","column_name":"created_at","data_type":"timestamp with time zone","is_nullable":"NO","column_default":"now()"},{"table_name":"staff_profiles","column_name":"venue_id","data_type":"uuid","is_nullable":"YES","column_default":null},{"table_name":"venues","column_name":"id","data_type":"uuid","is_nullable":"NO","column_default":"gen_random_uuid()"},{"table_name":"venues","column_name":"name","data_type":"text","is_nullable":"NO","column_default":null},{"table_name":"venues","column_name":"created_at","data_type":"timestamp with time zone","is_nullable":"NO","column_default":"now()"}]$expected$::jsonb) j) THEN
    RAISE EXCEPTION 'SaaS foundation: operational column drift; stop before mutation';
  END IF;
  SELECT jsonb_agg(to_jsonb(c) ORDER BY table_name,conname) INTO actual FROM
    (SELECT c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
      WHERE c.relnamespace='public'::regnamespace AND c.relname=ANY(ARRAY['check_in_logs','groups','guests','service_days','shift_notes','staff_profiles','venues'])) c;
  IF actual IS DISTINCT FROM (SELECT jsonb_agg(j ORDER BY j->>'table_name',j->>'conname') FROM jsonb_array_elements($expected$[{"table_name":"check_in_logs","conname":"check_in_logs_group_id_fkey","definition":"FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE"},{"table_name":"check_in_logs","conname":"check_in_logs_guest_id_fkey","definition":"FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE"},{"table_name":"check_in_logs","conname":"check_in_logs_pkey","definition":"PRIMARY KEY (id)"},{"table_name":"check_in_logs","conname":"check_in_logs_venue_id_fkey","definition":"FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL"},{"table_name":"groups","conname":"groups_pkey","definition":"PRIMARY KEY (id)"},{"table_name":"groups","conname":"groups_service_day_id_fkey","definition":"FOREIGN KEY (service_day_id) REFERENCES service_days(id) ON DELETE CASCADE"},{"table_name":"groups","conname":"groups_venue_id_fkey","definition":"FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL"},{"table_name":"guests","conname":"guests_added_by_user_id_fkey","definition":"FOREIGN KEY (added_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL"},{"table_name":"guests","conname":"guests_group_id_fkey","definition":"FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE"},{"table_name":"guests","conname":"guests_pkey","definition":"PRIMARY KEY (id)"},{"table_name":"guests","conname":"guests_venue_id_fkey","definition":"FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL"},{"table_name":"service_days","conname":"service_days_pkey","definition":"PRIMARY KEY (id)"},{"table_name":"service_days","conname":"service_days_venue_id_fkey","definition":"FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE"},{"table_name":"service_days","conname":"service_days_venue_id_service_date_key","definition":"UNIQUE (venue_id, service_date)"},{"table_name":"shift_notes","conname":"shift_notes_created_by_user_id_fkey","definition":"FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL"},{"table_name":"shift_notes","conname":"shift_notes_pkey","definition":"PRIMARY KEY (id)"},{"table_name":"shift_notes","conname":"shift_notes_service_day_id_fkey","definition":"FOREIGN KEY (service_day_id) REFERENCES service_days(id) ON DELETE CASCADE"},{"table_name":"shift_notes","conname":"shift_notes_venue_id_fkey","definition":"FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL"},{"table_name":"staff_profiles","conname":"staff_profiles_id_fkey","definition":"FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE"},{"table_name":"staff_profiles","conname":"staff_profiles_pkey","definition":"PRIMARY KEY (id)"},{"table_name":"staff_profiles","conname":"staff_profiles_role_check","definition":"CHECK ((role = ANY (ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])))"},{"table_name":"staff_profiles","conname":"staff_profiles_venue_id_fkey","definition":"FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL"},{"table_name":"venues","conname":"venues_pkey","definition":"PRIMARY KEY (id)"}]$expected$::jsonb) j) THEN
    RAISE EXCEPTION 'SaaS foundation: operational constraint drift; stop before mutation';
  END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY tablename,policyname) INTO actual FROM pg_policies p
    WHERE schemaname='public' AND tablename=ANY(ARRAY['check_in_logs','groups','guests','service_days','shift_notes','staff_profiles','venues']);
  IF actual IS DISTINCT FROM (SELECT jsonb_agg(j ORDER BY j->>'tablename',j->>'policyname') FROM jsonb_array_elements($expected$[{"schemaname":"public","tablename":"check_in_logs","policyname":"doorflow admins managers can delete check in logs","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"DELETE","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])","with_check":null},{"schemaname":"public","tablename":"check_in_logs","policyname":"doorflow admins managers door can insert check in logs","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"INSERT","qual":null,"with_check":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text])"},{"schemaname":"public","tablename":"check_in_logs","policyname":"doorflow staff can read check in logs","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])","with_check":null},{"schemaname":"public","tablename":"groups","policyname":"doorflow admins managers can manage groups","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"ALL","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])","with_check":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])"},{"schemaname":"public","tablename":"groups","policyname":"doorflow staff can read groups","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])","with_check":null},{"schemaname":"public","tablename":"guests","policyname":"doorflow admins managers can delete guests","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"DELETE","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])","with_check":null},{"schemaname":"public","tablename":"guests","policyname":"doorflow admins managers can insert guests","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"INSERT","qual":null,"with_check":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])"},{"schemaname":"public","tablename":"guests","policyname":"doorflow admins managers door can update guests","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"UPDATE","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text])","with_check":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text])"},{"schemaname":"public","tablename":"guests","policyname":"doorflow staff can read guests","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])","with_check":null},{"schemaname":"public","tablename":"service_days","policyname":"doorflow admins managers can manage service days","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"ALL","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])","with_check":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])"},{"schemaname":"public","tablename":"service_days","policyname":"doorflow staff can read service days","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])","with_check":null},{"schemaname":"public","tablename":"shift_notes","policyname":"Authenticated users can delete shift notes","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"DELETE","qual":"true","with_check":null},{"schemaname":"public","tablename":"shift_notes","policyname":"Authenticated users can insert shift notes","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"INSERT","qual":null,"with_check":"true"},{"schemaname":"public","tablename":"shift_notes","policyname":"Authenticated users can read shift notes","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"true","with_check":null},{"schemaname":"public","tablename":"shift_notes","policyname":"Authenticated users can update shift notes","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"UPDATE","qual":"true","with_check":"true"},{"schemaname":"public","tablename":"staff_profiles","policyname":"doorflow same venue admins delete profiles","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"DELETE","qual":"((venue_id IS NOT NULL) AND doorflow_has_venue_role(venue_id, ARRAY['admin'::text]))","with_check":null},{"schemaname":"public","tablename":"staff_profiles","policyname":"doorflow same venue admins insert profiles","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"INSERT","qual":null,"with_check":"((venue_id IS NOT NULL) AND doorflow_has_venue_role(venue_id, ARRAY['admin'::text]))"},{"schemaname":"public","tablename":"staff_profiles","policyname":"doorflow same venue admins select profiles","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"((venue_id IS NOT NULL) AND doorflow_has_venue_role(venue_id, ARRAY['admin'::text]))","with_check":null},{"schemaname":"public","tablename":"staff_profiles","policyname":"doorflow same venue admins update profiles","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"UPDATE","qual":"((venue_id IS NOT NULL) AND doorflow_has_venue_role(venue_id, ARRAY['admin'::text]))","with_check":"((venue_id IS NOT NULL) AND doorflow_has_venue_role(venue_id, ARRAY['admin'::text]))"},{"schemaname":"public","tablename":"staff_profiles","policyname":"doorflow staff can read own profile","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"(id = ( SELECT auth.uid() AS uid))","with_check":null},{"schemaname":"public","tablename":"venues","policyname":"doorflow admins managers can manage venues","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"ALL","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])","with_check":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text])"},{"schemaname":"public","tablename":"venues","policyname":"doorflow staff can read venues","permissive":"PERMISSIVE","roles":["authenticated"],"cmd":"SELECT","qual":"doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text])","with_check":null}]$expected$::jsonb) j) THEN
    RAISE EXCEPTION 'SaaS foundation: authorization policy drift; stop before mutation';
  END IF;
  IF EXISTS(SELECT FROM pg_class WHERE relnamespace='public'::regnamespace
    AND relname=ANY(ARRAY['check_in_logs','groups','guests','service_days','shift_notes','staff_profiles','venues']) AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'SaaS foundation: expected RLS is disabled';
  END IF;
  FOREACH helper IN ARRAY ARRAY['doorflow_current_venue_id()','doorflow_has_venue_role(uuid,text[])'] LOOP
    IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner
      WHERE p.oid=to_regprocedure('public.'||helper) AND p.prosecdef AND (r.rolsuper OR r.rolbypassrls)
      AND p.prosrc LIKE '%auth.uid()%' AND p.prosrc LIKE '%active%' AND p.prosrc LIKE '%venue_id%') THEN
      RAISE EXCEPTION 'SaaS foundation: profile authority helper drift';
    END IF;
  END LOOP;
  IF EXISTS(SELECT FROM jsonb_array_elements($helpers$[{"name":"doorflow_current_role","body":"selectstaff_profile.rolefrompublic.staff_profilesstaff_profilewherestaff_profile.id=auth.uid()andstaff_profile.activeistruelimit1"},{"name":"doorflow_current_staff_profile","body":"selectstaff_profile.*frompublic.staff_profilesstaff_profilewherestaff_profile.id=auth.uid()andstaff_profile.activeistruelimit1"},{"name":"doorflow_current_venue_id","body":"selectstaff_profile.venue_idfrompublic.staff_profilesstaff_profilewherestaff_profile.id=auth.uid()andstaff_profile.activeistruelimit1"},{"name":"doorflow_has_role","body":"selectexists(select1frompublic.staff_profilesspwheresp.id=auth.uid()andsp.active=trueandsp.role=any(allowed_roles));"},{"name":"doorflow_has_venue_access","body":"selectexists(select1frompublic.staff_profilesstaff_profilewherestaff_profile.id=auth.uid()andstaff_profile.activeistrueandstaff_profile.venue_id=target_venue_id)"},{"name":"doorflow_has_venue_role","body":"selectexists(select1frompublic.staff_profilesstaff_profilewherestaff_profile.id=auth.uid()andstaff_profile.activeistrueandstaff_profile.venue_id=target_venue_idandstaff_profile.role=any(allowed_roles))"},{"name":"doorflow_is_active_staff","body":"selectexists(select1frompublic.staff_profilesstaff_profilewherestaff_profile.id=auth.uid()andstaff_profile.activeistrue)"}]$helpers$::jsonb) e
    LEFT JOIN pg_proc p ON p.pronamespace='public'::regnamespace AND p.proname=e->>'name'
    WHERE p.oid IS NULL OR regexp_replace(p.prosrc,'\s','','g') IS DISTINCT FROM e->>'body') THEN
    RAISE EXCEPTION 'SaaS foundation: exact current-profile helper body drift';
  END IF;
  IF (SELECT array_agg(t.tgname::text ORDER BY t.tgname) FROM pg_trigger t
    WHERE NOT t.tgisinternal AND t.tgrelid=ANY(ARRAY['public.service_days'::regclass,'public.groups'::regclass,'public.guests'::regclass,'public.check_in_logs'::regclass,'public.shift_notes'::regclass])) IS DISTINCT FROM
    ARRAY['doorflow_autofill_check_in_log_venue_id_trigger','doorflow_autofill_group_venue_id_trigger','doorflow_autofill_guest_venue_id_trigger','doorflow_autofill_shift_note_venue_id_trigger']::text[] THEN
    RAISE EXCEPTION 'SaaS foundation: operational trigger inventory drift';
  END IF;
  IF to_regnamespace('doorflow_private') IS NOT NULL THEN RAISE EXCEPTION 'SaaS foundation: private schema collision'; END IF;
  IF EXISTS(SELECT FROM public.groups c JOIN public.service_days p ON p.id=c.service_day_id WHERE c.venue_id IS DISTINCT FROM p.venue_id OR p.venue_id IS NULL)
    OR EXISTS(SELECT FROM public.guests c JOIN public.groups p ON p.id=c.group_id WHERE c.venue_id IS DISTINCT FROM p.venue_id OR p.venue_id IS NULL)
    OR EXISTS(SELECT FROM public.check_in_logs c JOIN public.groups p ON p.id=c.group_id WHERE c.venue_id IS DISTINCT FROM p.venue_id OR p.venue_id IS NULL)
    OR EXISTS(SELECT FROM public.check_in_logs c JOIN public.guests p ON p.id=c.guest_id WHERE c.venue_id IS DISTINCT FROM p.venue_id OR c.group_id IS DISTINCT FROM p.group_id OR p.venue_id IS NULL)
    OR EXISTS(SELECT FROM public.shift_notes c JOIN public.service_days p ON p.id=c.service_day_id WHERE c.venue_id IS DISTINCT FROM p.venue_id OR p.venue_id IS NULL) THEN
    RAISE EXCEPTION 'SaaS foundation: inconsistent/null-venue parent graph; no guessed backfill is permitted';
  END IF;
END
$preflight$;

CREATE SCHEMA doorflow_private;
REVOKE ALL ON SCHEMA doorflow_private FROM PUBLIC,anon,authenticated,service_role;

-- The composite keys make FK enforcement concurrency-safe: changing a referenced
-- tenant key conflicts with child inserts, even across transactions or RLS bypass.
ALTER TABLE public.service_days ADD CONSTRAINT service_days_id_venue_key UNIQUE(id,venue_id);
ALTER TABLE public.groups ADD CONSTRAINT groups_id_venue_key UNIQUE(id,venue_id);
ALTER TABLE public.guests ADD CONSTRAINT guests_id_venue_key UNIQUE(id,venue_id);
ALTER TABLE public.guests ADD CONSTRAINT guests_id_group_venue_key UNIQUE(id,group_id,venue_id);
ALTER TABLE public.groups ADD CONSTRAINT groups_same_venue_day_fk FOREIGN KEY(service_day_id,venue_id) REFERENCES public.service_days(id,venue_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE public.guests ADD CONSTRAINT guests_same_venue_group_fk FOREIGN KEY(group_id,venue_id) REFERENCES public.groups(id,venue_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE public.check_in_logs ADD CONSTRAINT logs_same_venue_group_fk FOREIGN KEY(group_id,venue_id) REFERENCES public.groups(id,venue_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE public.check_in_logs ADD CONSTRAINT logs_same_venue_guest_fk FOREIGN KEY(guest_id,venue_id) REFERENCES public.guests(id,venue_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE public.check_in_logs ADD CONSTRAINT logs_guest_group_venue_fk FOREIGN KEY(guest_id,group_id,venue_id) REFERENCES public.guests(id,group_id,venue_id) DEFERRABLE INITIALLY IMMEDIATE;
ALTER TABLE public.shift_notes ADD CONSTRAINT notes_same_venue_day_fk FOREIGN KEY(service_day_id,venue_id) REFERENCES public.service_days(id,venue_id) DEFERRABLE INITIALLY IMMEDIATE;

CREATE FUNCTION doorflow_private.enforce_operational_venue() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $body$
DECLARE
  browser boolean := coalesce(current_setting('role',true),'') IN ('authenticated','anon');
  assigned uuid; parent_venue uuid; other_venue uuid; parent_group uuid;
  linked boolean := false;
BEGIN
  -- Only the original venue FK's cascading SET NULL is allowed to clear a venue.
  -- The deleted venue must be absent and this must be a nested RI-trigger action.
  -- Browser callers cannot manufacture this condition while the venue exists.
  IF TG_OP='UPDATE' AND NEW.venue_id IS NULL AND OLD.venue_id IS NOT NULL
    AND pg_trigger_depth()>1 AND NOT EXISTS(SELECT FROM public.venues WHERE id=OLD.venue_id) THEN
    RETURN NEW;
  END IF;
  IF browser THEN
    SELECT sp.venue_id INTO assigned FROM public.staff_profiles sp
      WHERE sp.id=auth.uid() AND sp.active IS TRUE AND sp.role=ANY(ARRAY['admin','manager','door','viewer']);
    IF assigned IS NULL THEN RAISE EXCEPTION 'Authorized venue required' USING ERRCODE='42501'; END IF;
    IF TG_OP='UPDATE' AND NEW.venue_id IS DISTINCT FROM OLD.venue_id THEN
      RAISE EXCEPTION 'Row venue is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  IF TG_TABLE_NAME='groups' AND (to_jsonb(NEW)->>'service_day_id')::uuid IS NOT NULL THEN
    linked:=true;
    SELECT venue_id INTO parent_venue FROM public.service_days WHERE id=(to_jsonb(NEW)->>'service_day_id')::uuid FOR KEY SHARE;
  ELSIF TG_TABLE_NAME='guests' AND (to_jsonb(NEW)->>'group_id')::uuid IS NOT NULL THEN
    linked:=true;
    SELECT venue_id INTO parent_venue FROM public.groups WHERE id=(to_jsonb(NEW)->>'group_id')::uuid FOR KEY SHARE;
  ELSIF TG_TABLE_NAME='shift_notes' THEN
    linked:=true;
    SELECT venue_id INTO parent_venue FROM public.service_days WHERE id=(to_jsonb(NEW)->>'service_day_id')::uuid FOR KEY SHARE;
  ELSIF TG_TABLE_NAME='check_in_logs' THEN
    IF (to_jsonb(NEW)->>'group_id')::uuid IS NOT NULL THEN
      linked:=true;
      SELECT venue_id INTO parent_venue FROM public.groups WHERE id=(to_jsonb(NEW)->>'group_id')::uuid FOR KEY SHARE;
    END IF;
    IF (to_jsonb(NEW)->>'guest_id')::uuid IS NOT NULL THEN
      SELECT venue_id,group_id INTO other_venue,parent_group FROM public.guests WHERE id=(to_jsonb(NEW)->>'guest_id')::uuid FOR KEY SHARE;
      IF other_venue IS NULL OR (to_jsonb(NEW)->>'group_id')::uuid IS DISTINCT FROM parent_group
        OR (linked AND parent_venue IS DISTINCT FROM other_venue) THEN
        RAISE EXCEPTION 'Inconsistent operational parent' USING ERRCODE='23514';
      END IF;
      linked:=true; parent_venue:=other_venue;
    END IF;
  END IF;
  IF linked AND parent_venue IS NULL THEN
    RAISE EXCEPTION 'Operational parent requires a venue' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.venue_id IS NULL THEN NEW.venue_id:=coalesce(parent_venue,assigned); END IF;
  IF linked AND NEW.venue_id IS DISTINCT FROM parent_venue THEN
    RAISE EXCEPTION 'Operational parent venue conflict' USING ERRCODE='23514';
  END IF;
  IF browser AND NEW.venue_id IS DISTINCT FROM assigned THEN
    RAISE EXCEPTION 'Authorized venue conflict' USING ERRCODE='42501';
  END IF;
  -- MATCH SIMPLE FKs intentionally permit legacy unlinked nullable rows. This
  -- check covers the otherwise-skipped NULL group edge when a guest has logs.
  IF TG_TABLE_NAME='guests' AND TG_OP='UPDATE' AND
    ((to_jsonb(NEW)->>'group_id')::uuid IS DISTINCT FROM (to_jsonb(OLD)->>'group_id')::uuid OR NEW.venue_id IS DISTINCT FROM OLD.venue_id) AND
    EXISTS(SELECT FROM public.check_in_logs l WHERE l.guest_id=OLD.id AND
      (l.group_id IS DISTINCT FROM (to_jsonb(NEW)->>'group_id')::uuid OR l.venue_id IS DISTINCT FROM NEW.venue_id)) THEN
    RAISE EXCEPTION 'Existing log parent conflict' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$body$;
REVOKE ALL ON FUNCTION doorflow_private.enforce_operational_venue() FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER doorflow_autofill_group_venue_id_trigger ON public.groups;
DROP TRIGGER doorflow_autofill_guest_venue_id_trigger ON public.guests;
DROP TRIGGER doorflow_autofill_check_in_log_venue_id_trigger ON public.check_in_logs;
DROP TRIGGER doorflow_autofill_shift_note_venue_id_trigger ON public.shift_notes;
CREATE TRIGGER doorflow_operational_venue_guard BEFORE INSERT OR UPDATE ON public.service_days FOR EACH ROW EXECUTE FUNCTION doorflow_private.enforce_operational_venue();
CREATE TRIGGER doorflow_operational_venue_guard BEFORE INSERT OR UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION doorflow_private.enforce_operational_venue();
CREATE TRIGGER doorflow_operational_venue_guard BEFORE INSERT OR UPDATE ON public.guests FOR EACH ROW EXECUTE FUNCTION doorflow_private.enforce_operational_venue();
CREATE TRIGGER doorflow_operational_venue_guard BEFORE INSERT OR UPDATE ON public.check_in_logs FOR EACH ROW EXECUTE FUNCTION doorflow_private.enforce_operational_venue();
CREATE TRIGGER doorflow_operational_venue_guard BEFORE INSERT OR UPDATE ON public.shift_notes FOR EACH ROW EXECUTE FUNCTION doorflow_private.enforce_operational_venue();

-- Replace each existing policy in place. Business role differences are preserved;
-- current staff policies, server-only invitation tables and trusted roles are untouched.
ALTER POLICY "doorflow admins managers can delete check in logs" ON public.check_in_logs USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text]));
ALTER POLICY "doorflow admins managers door can insert check in logs" ON public.check_in_logs WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text]));
ALTER POLICY "doorflow staff can read check in logs" ON public.check_in_logs USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
ALTER POLICY "doorflow admins managers can manage groups" ON public.groups USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])) WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text]));
ALTER POLICY "doorflow staff can read groups" ON public.groups USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
ALTER POLICY "doorflow admins managers can delete guests" ON public.guests USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text]));
ALTER POLICY "doorflow admins managers can insert guests" ON public.guests WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text]));
ALTER POLICY "doorflow admins managers door can update guests" ON public.guests USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text])) WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text]));
ALTER POLICY "doorflow staff can read guests" ON public.guests USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
ALTER POLICY "doorflow admins managers can manage service days" ON public.service_days USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text])) WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text]));
ALTER POLICY "doorflow staff can read service days" ON public.service_days USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
ALTER POLICY "Authenticated users can delete shift notes" ON public.shift_notes USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin','manager','door','viewer']::text[]));
ALTER POLICY "Authenticated users can insert shift notes" ON public.shift_notes WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin','manager','door','viewer']::text[]));
ALTER POLICY "Authenticated users can read shift notes" ON public.shift_notes USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin','manager','door','viewer']::text[]));
ALTER POLICY "Authenticated users can update shift notes" ON public.shift_notes USING (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin','manager','door','viewer']::text[])) WITH CHECK (venue_id IS NOT NULL AND public.doorflow_has_venue_role(venue_id, ARRAY['admin','manager','door','viewer']::text[]));
ALTER POLICY "doorflow admins managers can manage venues" ON public.venues USING (id IS NOT NULL AND public.doorflow_has_venue_role(id, ARRAY['admin'::text, 'manager'::text])) WITH CHECK (id IS NOT NULL AND public.doorflow_has_venue_role(id, ARRAY['admin'::text, 'manager'::text]));
ALTER POLICY "doorflow staff can read venues" ON public.venues USING (id IS NOT NULL AND public.doorflow_has_venue_role(id, ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
COMMIT;
