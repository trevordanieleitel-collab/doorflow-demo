-- TEST ONLY: schema fixture derived from the reviewed catalog, with zero business or Auth rows.
-- Run only on a fresh disposable PostgreSQL 17+ database named doorflow_phase82c_*,
-- or a new embedded PGlite/WASM instance (which exposes its database as template1).
DO $$ BEGIN IF current_database() NOT LIKE 'doorflow_phase82c_%' AND NOT (current_database()='template1' AND version() LIKE '%emcc%') THEN RAISE EXCEPTION 'Local fixture database name required'; END IF; END $$;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY,email varchar(255),email_confirmed_at timestamptz,invited_at timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;
SET search_path=public,pg_catalog;

CREATE TABLE public."check_in_logs" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "guest_id" pg_catalog."uuid",
  "group_id" pg_catalog."uuid",
  "action" pg_catalog."text" NOT NULL,
  "amount" pg_catalog."int4" DEFAULT 1 NOT NULL,
  "door_location" pg_catalog."text",
  "staff_user_id" pg_catalog."uuid",
  "staff_name" pg_catalog."text",
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "venue_id" pg_catalog."uuid"
);

CREATE TABLE public."groups" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "service_day_id" pg_catalog."uuid",
  "name" pg_catalog."text" NOT NULL,
  "group_type" pg_catalog."text" DEFAULT 'General Guest List'::text NOT NULL,
  "host_name" pg_catalog."text",
  "table_location" pg_catalog."text",
  "approved_by" pg_catalog."text",
  "notes" pg_catalog."text",
  "status" pg_catalog."text" DEFAULT 'Active'::text NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "venue_id" pg_catalog."uuid"
);

CREATE TABLE public."guests" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "group_id" pg_catalog."uuid",
  "first_name" pg_catalog."text" NOT NULL,
  "last_name" pg_catalog."text" NOT NULL,
  "guest_type" pg_catalog."text" DEFAULT 'Guest'::text NOT NULL,
  "total_allowed" pg_catalog."int4" DEFAULT 1 NOT NULL,
  "checked_in_count" pg_catalog."int4" DEFAULT 0 NOT NULL,
  "notes" pg_catalog."text",
  "last_checked_in_at" pg_catalog."timestamptz",
  "last_checked_in_by" pg_catalog."uuid",
  "last_door_location" pg_catalog."text",
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "last_checked_in_by_name" pg_catalog."text",
  "added_by_user_id" pg_catalog."uuid",
  "added_by_name" pg_catalog."text",
  "added_at" pg_catalog."timestamptz" DEFAULT now(),
  "is_late_add" pg_catalog."bool" DEFAULT false NOT NULL,
  "late_add_approved_by" pg_catalog."text",
  "late_add_reason" pg_catalog."text",
  "venue_id" pg_catalog."uuid"
);

CREATE TABLE public."organization_memberships" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" pg_catalog."uuid" NOT NULL,
  "user_id" pg_catalog."uuid" NOT NULL,
  "role" pg_catalog."text" DEFAULT 'member'::text NOT NULL,
  "display_name" pg_catalog."text",
  "status" pg_catalog."text" DEFAULT 'active'::text NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "updated_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL
);

CREATE TABLE public."organizations" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "name" pg_catalog."text" DEFAULT 'DoorFlow Legacy Organization'::text NOT NULL,
  "slug" pg_catalog."text",
  "status" pg_catalog."text" DEFAULT 'active'::text NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "updated_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL
);

CREATE TABLE public."service_days" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" pg_catalog."uuid",
  "service_date" pg_catalog."date" NOT NULL,
  "day_name" pg_catalog."text" NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL
);

CREATE TABLE public."shift_notes" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "service_day_id" pg_catalog."uuid" NOT NULL,
  "category" pg_catalog."text" DEFAULT 'General Note'::text NOT NULL,
  "priority" pg_catalog."text" DEFAULT 'Normal'::text NOT NULL,
  "note_text" pg_catalog."text" NOT NULL,
  "created_by_user_id" pg_catalog."uuid",
  "created_by_name" pg_catalog."text" DEFAULT 'Unknown'::text NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "venue_id" pg_catalog."uuid"
);

CREATE TABLE public."staff_profiles" (
  "id" pg_catalog."uuid" NOT NULL,
  "full_name" pg_catalog."text" NOT NULL,
  "role" pg_catalog."text" DEFAULT 'door'::text NOT NULL,
  "active" pg_catalog."bool" DEFAULT true NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "venue_id" pg_catalog."uuid"
);

CREATE TABLE public."subscription_accounts" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" pg_catalog."uuid",
  "status" pg_catalog."text" DEFAULT 'legacy'::text NOT NULL,
  "plan_key" pg_catalog."text" DEFAULT 'legacy'::text NOT NULL,
  "provider" pg_catalog."text" DEFAULT 'manual'::text NOT NULL,
  "provider_customer_id" pg_catalog."text",
  "provider_subscription_id" pg_catalog."text",
  "current_period_end" pg_catalog."timestamptz",
  "metadata" pg_catalog."jsonb" DEFAULT '{}'::jsonb NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "updated_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL
);

CREATE TABLE public."venue_branding" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" pg_catalog."uuid" NOT NULL,
  "app_name" pg_catalog."text" DEFAULT 'DoorFlow'::text NOT NULL,
  "short_name" pg_catalog."text" DEFAULT 'DoorFlow'::text NOT NULL,
  "logo_url" pg_catalog."text",
  "dark_logo_url" pg_catalog."text",
  "icon_192_url" pg_catalog."text",
  "icon_512_url" pg_catalog."text",
  "primary_color" pg_catalog."text",
  "accent_color" pg_catalog."text",
  "branding" pg_catalog."jsonb" DEFAULT '{}'::jsonb NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "updated_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL
);

CREATE TABLE public."venue_memberships" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" pg_catalog."uuid",
  "venue_id" pg_catalog."uuid" NOT NULL,
  "user_id" pg_catalog."uuid" NOT NULL,
  "role" pg_catalog."text" DEFAULT 'viewer'::text NOT NULL,
  "display_name" pg_catalog."text",
  "status" pg_catalog."text" DEFAULT 'active'::text NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "updated_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL
);

CREATE TABLE public."venue_settings" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "venue_id" pg_catalog."uuid" NOT NULL,
  "timezone" pg_catalog."text" DEFAULT 'America/New_York'::text NOT NULL,
  "default_door_location" pg_catalog."text" DEFAULT 'Front Door'::text NOT NULL,
  "service_day_rollover_time" pg_catalog."time" DEFAULT '04:00:00'::time without time zone NOT NULL,
  "settings" pg_catalog."jsonb" DEFAULT '{}'::jsonb NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL,
  "updated_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL
);

CREATE TABLE public."venues" (
  "id" pg_catalog."uuid" DEFAULT gen_random_uuid() NOT NULL,
  "name" pg_catalog."text" NOT NULL,
  "created_at" pg_catalog."timestamptz" DEFAULT now() NOT NULL
);
ALTER TABLE public."check_in_logs" ADD CONSTRAINT "check_in_logs_pkey" PRIMARY KEY (id);
ALTER TABLE public."groups" ADD CONSTRAINT "groups_pkey" PRIMARY KEY (id);
ALTER TABLE public."guests" ADD CONSTRAINT "guests_pkey" PRIMARY KEY (id);
ALTER TABLE public."organization_memberships" ADD CONSTRAINT "organization_memberships_pkey" PRIMARY KEY (id);
ALTER TABLE public."organizations" ADD CONSTRAINT "organizations_pkey" PRIMARY KEY (id);
ALTER TABLE public."service_days" ADD CONSTRAINT "service_days_pkey" PRIMARY KEY (id);
ALTER TABLE public."service_days" ADD CONSTRAINT "service_days_venue_id_service_date_key" UNIQUE (venue_id, service_date);
ALTER TABLE public."shift_notes" ADD CONSTRAINT "shift_notes_pkey" PRIMARY KEY (id);
ALTER TABLE public."staff_profiles" ADD CONSTRAINT "staff_profiles_pkey" PRIMARY KEY (id);
ALTER TABLE public."staff_profiles" ADD CONSTRAINT "staff_profiles_role_check" CHECK (role = ANY (ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
ALTER TABLE public."subscription_accounts" ADD CONSTRAINT "subscription_accounts_pkey" PRIMARY KEY (id);
ALTER TABLE public."venue_branding" ADD CONSTRAINT "venue_branding_pkey" PRIMARY KEY (id);
ALTER TABLE public."venue_memberships" ADD CONSTRAINT "venue_memberships_pkey" PRIMARY KEY (id);
ALTER TABLE public."venue_settings" ADD CONSTRAINT "venue_settings_pkey" PRIMARY KEY (id);
ALTER TABLE public."venues" ADD CONSTRAINT "venues_pkey" PRIMARY KEY (id);
ALTER TABLE public."check_in_logs" ADD CONSTRAINT "check_in_logs_group_id_fkey" FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE public."check_in_logs" ADD CONSTRAINT "check_in_logs_guest_id_fkey" FOREIGN KEY (guest_id) REFERENCES guests(id) ON DELETE CASCADE;
ALTER TABLE public."check_in_logs" ADD CONSTRAINT "check_in_logs_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE public."groups" ADD CONSTRAINT "groups_service_day_id_fkey" FOREIGN KEY (service_day_id) REFERENCES service_days(id) ON DELETE CASCADE;
ALTER TABLE public."groups" ADD CONSTRAINT "groups_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE public."guests" ADD CONSTRAINT "guests_added_by_user_id_fkey" FOREIGN KEY (added_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."guests" ADD CONSTRAINT "guests_group_id_fkey" FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE public."guests" ADD CONSTRAINT "guests_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE public."organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public."service_days" ADD CONSTRAINT "service_days_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE public."shift_notes" ADD CONSTRAINT "shift_notes_created_by_user_id_fkey" FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public."shift_notes" ADD CONSTRAINT "shift_notes_service_day_id_fkey" FOREIGN KEY (service_day_id) REFERENCES service_days(id) ON DELETE CASCADE;
ALTER TABLE public."shift_notes" ADD CONSTRAINT "shift_notes_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE public."staff_profiles" ADD CONSTRAINT "staff_profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public."staff_profiles" ADD CONSTRAINT "staff_profiles_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE SET NULL;
ALTER TABLE public."subscription_accounts" ADD CONSTRAINT "subscription_accounts_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE public."venue_branding" ADD CONSTRAINT "venue_branding_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE public."venue_memberships" ADD CONSTRAINT "venue_memberships_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE public."venue_memberships" ADD CONSTRAINT "venue_memberships_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
ALTER TABLE public."venue_settings" ADD CONSTRAINT "venue_settings_venue_id_fkey" FOREIGN KEY (venue_id) REFERENCES venues(id) ON DELETE CASCADE;
CREATE INDEX check_in_logs_venue_id_idx ON public.check_in_logs USING btree (venue_id);
CREATE INDEX groups_venue_id_idx ON public.groups USING btree (venue_id);
CREATE INDEX guests_added_at_idx ON public.guests USING btree (added_at DESC);
CREATE INDEX guests_is_late_add_idx ON public.guests USING btree (is_late_add);
CREATE INDEX guests_venue_id_idx ON public.guests USING btree (venue_id);
CREATE INDEX organization_memberships_organization_id_idx ON public.organization_memberships USING btree (organization_id);
CREATE UNIQUE INDEX organization_memberships_organization_user_unique ON public.organization_memberships USING btree (organization_id, user_id);
CREATE INDEX organization_memberships_user_id_idx ON public.organization_memberships USING btree (user_id);
CREATE UNIQUE INDEX organizations_slug_unique ON public.organizations USING btree (lower(slug)) WHERE (slug IS NOT NULL);
CREATE INDEX shift_notes_created_at_idx ON public.shift_notes USING btree (created_at DESC);
CREATE INDEX shift_notes_service_day_id_idx ON public.shift_notes USING btree (service_day_id);
CREATE INDEX shift_notes_venue_id_idx ON public.shift_notes USING btree (venue_id);
CREATE INDEX staff_profiles_venue_id_idx ON public.staff_profiles USING btree (venue_id);
CREATE INDEX subscription_accounts_organization_id_idx ON public.subscription_accounts USING btree (organization_id);
CREATE UNIQUE INDEX subscription_accounts_provider_customer_unique ON public.subscription_accounts USING btree (provider, provider_customer_id) WHERE (provider_customer_id IS NOT NULL);
CREATE UNIQUE INDEX subscription_accounts_provider_subscription_unique ON public.subscription_accounts USING btree (provider, provider_subscription_id) WHERE (provider_subscription_id IS NOT NULL);
CREATE INDEX subscription_accounts_status_idx ON public.subscription_accounts USING btree (status);
CREATE UNIQUE INDEX venue_branding_venue_id_unique ON public.venue_branding USING btree (venue_id);
CREATE INDEX venue_memberships_organization_id_idx ON public.venue_memberships USING btree (organization_id);
CREATE INDEX venue_memberships_user_id_idx ON public.venue_memberships USING btree (user_id);
CREATE INDEX venue_memberships_venue_id_idx ON public.venue_memberships USING btree (venue_id);
CREATE UNIQUE INDEX venue_memberships_venue_user_unique ON public.venue_memberships USING btree (venue_id, user_id);
CREATE UNIQUE INDEX venue_settings_venue_id_unique ON public.venue_settings USING btree (venue_id);
CREATE OR REPLACE FUNCTION public.doorflow_autofill_check_in_log_venue_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.venue_id is null and new.guest_id is not null then
    select guest.venue_id
      into new.venue_id
    from public.guests guest
    where guest.id = new.guest_id
    limit 1;
  end if;

  if new.venue_id is null and new.group_id is not null then
    select guest_group.venue_id
      into new.venue_id
    from public.groups guest_group
    where guest_group.id = new.group_id
    limit 1;
  end if;

  return new;
end;
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_autofill_check_in_log_venue_id"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_autofill_check_in_log_venue_id"() TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_autofill_group_venue_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.venue_id is null and new.service_day_id is not null then
    select service_day.venue_id
      into new.venue_id
    from public.service_days service_day
    where service_day.id = new.service_day_id
    limit 1;
  end if;

  return new;
end;
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_autofill_group_venue_id"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_autofill_group_venue_id"() TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_autofill_guest_venue_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.venue_id is null and new.group_id is not null then
    select guest_group.venue_id
      into new.venue_id
    from public.groups guest_group
    where guest_group.id = new.group_id
    limit 1;
  end if;

  return new;
end;
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_autofill_guest_venue_id"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_autofill_guest_venue_id"() TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_autofill_shift_note_venue_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.venue_id is null and new.service_day_id is not null then
    select service_day.venue_id
      into new.venue_id
    from public.service_days service_day
    where service_day.id = new.service_day_id
    limit 1;
  end if;

  return new;
end;
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_autofill_shift_note_venue_id"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_autofill_shift_note_venue_id"() TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_current_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select staff_profile.role
  from public.staff_profiles staff_profile
  where staff_profile.id = auth.uid()
    and staff_profile.active is true
  limit 1
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_current_role"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_current_role"() TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_current_staff_profile()
 RETURNS staff_profiles
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select staff_profile.*
  from public.staff_profiles staff_profile
  where staff_profile.id = auth.uid()
    and staff_profile.active is true
  limit 1
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_current_staff_profile"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_current_staff_profile"() TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_current_venue_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select staff_profile.venue_id
  from public.staff_profiles staff_profile
  where staff_profile.id = auth.uid()
    and staff_profile.active is true
  limit 1
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_current_venue_id"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_current_venue_id"() TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_has_role(allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.staff_profiles sp
    where sp.id = auth.uid()
      and sp.active = true
      and sp.role = any(allowed_roles)
  );
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_has_role"(allowed_roles text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_has_role"(allowed_roles text[]) TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_has_venue_access(target_venue_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.staff_profiles staff_profile
    where staff_profile.id = auth.uid()
      and staff_profile.active is true
      and staff_profile.venue_id = target_venue_id
  )
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_has_venue_access"(target_venue_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_has_venue_access"(target_venue_id uuid) TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_has_venue_role(target_venue_id uuid, allowed_roles text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.staff_profiles staff_profile
    where staff_profile.id = auth.uid()
      and staff_profile.active is true
      and staff_profile.venue_id = target_venue_id
      and staff_profile.role = any(allowed_roles)
  )
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_has_venue_role"(target_venue_id uuid, allowed_roles text[]) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_has_venue_role"(target_venue_id uuid, allowed_roles text[]) TO PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.doorflow_is_active_staff()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.staff_profiles staff_profile
    where staff_profile.id = auth.uid()
      and staff_profile.active is true
  )
$function$
;
REVOKE ALL ON FUNCTION public."doorflow_is_active_staff"() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public."doorflow_is_active_staff"() TO PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER doorflow_autofill_check_in_log_venue_id_trigger BEFORE INSERT OR UPDATE ON check_in_logs FOR EACH ROW EXECUTE FUNCTION doorflow_autofill_check_in_log_venue_id();
CREATE TRIGGER doorflow_autofill_group_venue_id_trigger BEFORE INSERT OR UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION doorflow_autofill_group_venue_id();
CREATE TRIGGER doorflow_autofill_guest_venue_id_trigger BEFORE INSERT OR UPDATE ON guests FOR EACH ROW EXECUTE FUNCTION doorflow_autofill_guest_venue_id();
CREATE TRIGGER doorflow_autofill_shift_note_venue_id_trigger BEFORE INSERT OR UPDATE ON shift_notes FOR EACH ROW EXECUTE FUNCTION doorflow_autofill_shift_note_venue_id();
ALTER TABLE public."check_in_logs" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."check_in_logs" TO anon,authenticated,service_role;
ALTER TABLE public."groups" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."groups" TO anon,authenticated,service_role;
ALTER TABLE public."guests" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."guests" TO anon,authenticated,service_role;
ALTER TABLE public."organization_memberships" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."organization_memberships" TO anon,authenticated,service_role;
ALTER TABLE public."organizations" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."organizations" TO anon,authenticated,service_role;
ALTER TABLE public."service_days" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."service_days" TO anon,authenticated,service_role;
ALTER TABLE public."shift_notes" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."shift_notes" TO anon,authenticated,service_role;
ALTER TABLE public."staff_profiles" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."staff_profiles" TO anon,authenticated,service_role;
ALTER TABLE public."subscription_accounts" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."subscription_accounts" TO anon,authenticated,service_role;
ALTER TABLE public."venue_branding" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."venue_branding" TO anon,authenticated,service_role;
ALTER TABLE public."venue_memberships" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."venue_memberships" TO anon,authenticated,service_role;
ALTER TABLE public."venue_settings" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."venue_settings" TO anon,authenticated,service_role;
ALTER TABLE public."venues" ENABLE ROW LEVEL SECURITY;
GRANT ALL ON TABLE public."venues" TO anon,authenticated,service_role;
CREATE POLICY "doorflow admins managers can delete check in logs" ON public."check_in_logs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
CREATE POLICY "doorflow admins managers door can insert check in logs" ON public."check_in_logs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text]));
CREATE POLICY "doorflow staff can read check in logs" ON public."check_in_logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
CREATE POLICY "doorflow admins managers can manage groups" ON public."groups" AS PERMISSIVE FOR ALL TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text])) WITH CHECK (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
CREATE POLICY "doorflow staff can read groups" ON public."groups" AS PERMISSIVE FOR SELECT TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
CREATE POLICY "doorflow admins managers can delete guests" ON public."guests" AS PERMISSIVE FOR DELETE TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
CREATE POLICY "doorflow admins managers can insert guests" ON public."guests" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
CREATE POLICY "doorflow admins managers door can update guests" ON public."guests" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text])) WITH CHECK (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text]));
CREATE POLICY "doorflow staff can read guests" ON public."guests" AS PERMISSIVE FOR SELECT TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
CREATE POLICY "doorflow admins managers can manage service days" ON public."service_days" AS PERMISSIVE FOR ALL TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text])) WITH CHECK (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
CREATE POLICY "doorflow staff can read service days" ON public."service_days" AS PERMISSIVE FOR SELECT TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));
CREATE POLICY "Authenticated users can delete shift notes" ON public."shift_notes" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
CREATE POLICY "Authenticated users can insert shift notes" ON public."shift_notes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
CREATE POLICY "Authenticated users can read shift notes" ON public."shift_notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
CREATE POLICY "Authenticated users can update shift notes" ON public."shift_notes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
CREATE POLICY "doorflow admins can manage profiles" ON public."staff_profiles" AS PERMISSIVE FOR ALL TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text])) WITH CHECK (doorflow_has_role(ARRAY['admin'::text]));
CREATE POLICY "doorflow admins can read all profiles" ON public."staff_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text]));
CREATE POLICY "doorflow staff can read own profile" ON public."staff_profiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((id = auth.uid()));
CREATE POLICY "doorflow admins managers can manage venues" ON public."venues" AS PERMISSIVE FOR ALL TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text])) WITH CHECK (doorflow_has_role(ARRAY['admin'::text, 'manager'::text]));
CREATE POLICY "doorflow staff can read venues" ON public."venues" AS PERMISSIVE FOR SELECT TO "authenticated" USING (doorflow_has_role(ARRAY['admin'::text, 'manager'::text, 'door'::text, 'viewer'::text]));

-- No publication is created here: these migrations never change Realtime membership.
