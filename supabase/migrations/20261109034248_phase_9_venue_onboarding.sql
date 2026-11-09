-- Phase 9. Additive, data-preserving; no Auth creation or email delivery.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='60s';
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'DoorFlow Legacy Organization',
  slug text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.venue_settings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  timezone text not null default 'America/New_York',
  default_door_location text not null default 'Front Door',
  service_day_rollover_time time not null default '04:00',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.venue_branding (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  app_name text not null default 'DoorFlow',
  short_name text not null default 'DoorFlow',
  logo_url text,
  dark_logo_url text,
  icon_192_url text,
  icon_512_url text,
  primary_color text,
  accent_color text,
  branding jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.subscription_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  status text not null default 'legacy',
  plan_key text not null default 'legacy',
  provider text not null default 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

CREATE UNIQUE INDEX IF NOT EXISTS venue_settings_venue_id_unique ON public.venue_settings(venue_id);
CREATE UNIQUE INDEX IF NOT EXISTS venue_branding_venue_id_unique ON public.venue_branding(venue_id);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_accounts_one_customer ON public.subscription_accounts(organization_id);
ALTER TABLE public.venues ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE RESTRICT;
ALTER TABLE public.venues ADD COLUMN lifecycle_status text NOT NULL DEFAULT 'active' CHECK(lifecycle_status IN ('onboarding','active','suspended','canceled'));
ALTER TABLE public.venues ADD COLUMN address jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(address)='object');
ALTER TABLE public.venues ADD COLUMN legacy_presentation boolean NOT NULL DEFAULT false;
ALTER TABLE public.subscription_accounts ADD COLUMN trial_start timestamptz;
ALTER TABLE public.subscription_accounts ADD COLUMN trial_end timestamptz;
ALTER TABLE public.subscription_accounts ADD CONSTRAINT subscription_status_contract CHECK(status IN ('legacy','trial','active','suspended','canceled'));
ALTER TABLE public.organizations ADD CONSTRAINT organization_status_contract CHECK(status IN ('active','suspended','canceled'));
CREATE INDEX venues_organization_id_idx ON public.venues(organization_id);
-- Only the unique existing legacy customer/venue pair is adopted automatically.
DO $adopt$ BEGIN
 IF (SELECT count(*) FROM public.venues)=1 AND (SELECT count(*) FROM public.organizations)=1
 AND EXISTS(SELECT FROM public.organizations WHERE slug='doorflow-legacy') THEN
 UPDATE public.venues SET organization_id=(SELECT id FROM public.organizations WHERE slug='doorflow-legacy'), legacy_presentation=true;
 END IF;
END $adopt$;
INSERT INTO public.venue_settings(venue_id) SELECT id FROM public.venues ON CONFLICT(venue_id) DO NOTHING;
INSERT INTO public.venue_branding(venue_id) SELECT id FROM public.venues ON CONFLICT(venue_id) DO NOTHING;

CREATE TABLE public.venue_onboarding (
 request_id uuid PRIMARY KEY,
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 venue_id uuid NOT NULL UNIQUE REFERENCES public.venues(id),
 intended_email text NOT NULL UNIQUE CHECK(intended_email=lower(btrim(intended_email))),
 full_name text NOT NULL,
 request_payload jsonb NOT NULL,
 auth_user_id uuid UNIQUE REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE public.venue_administration_audit (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 venue_id uuid REFERENCES public.venues(id),
 action text NOT NULL, actor_user_id uuid, operator_label text NOT NULL,
 details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
DO $lockdown$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['organizations','subscription_accounts','venue_settings','venue_branding','venue_onboarding','venue_administration_audit'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $lockdown$;
GRANT SELECT ON public.venue_settings,public.venue_branding TO authenticated;
REVOKE INSERT,UPDATE,DELETE ON public.venues FROM authenticated;

CREATE FUNCTION public.doorflow_venue_operational(p_venue uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM public.venues v LEFT JOIN public.organizations o ON o.id=v.organization_id
 LEFT JOIN public.subscription_accounts s ON s.organization_id=o.id
 WHERE v.id=p_venue AND v.lifecycle_status='active'
 AND (v.organization_id IS NULL OR (o.status='active' AND s.status IN ('legacy','trial','active'))))
$f$;
REVOKE ALL ON FUNCTION public.doorflow_venue_operational(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.doorflow_venue_operational(uuid) TO authenticated,service_role;
CREATE POLICY venue_settings_read ON public.venue_settings FOR SELECT TO authenticated USING(public.doorflow_has_venue_access(venue_id));
CREATE POLICY venue_branding_read ON public.venue_branding FOR SELECT TO authenticated USING(public.doorflow_has_venue_access(venue_id));
DO $gates$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['service_days','groups','guests','check_in_logs','shift_notes'] LOOP
 EXECUTE format('CREATE POLICY phase9_lifecycle ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING(public.doorflow_venue_operational(venue_id)) WITH CHECK(public.doorflow_venue_operational(venue_id))',t);
 END LOOP;
END $gates$;
CREATE POLICY phase9_staff_insert ON public.staff_profiles AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK(public.doorflow_venue_operational(venue_id));
CREATE POLICY phase9_staff_update ON public.staff_profiles AS RESTRICTIVE FOR UPDATE TO authenticated USING(public.doorflow_venue_operational(venue_id)) WITH CHECK(public.doorflow_venue_operational(venue_id));
CREATE POLICY phase9_staff_delete ON public.staff_profiles AS RESTRICTIVE FOR DELETE TO authenticated USING(public.doorflow_venue_operational(venue_id));

CREATE FUNCTION public.doorflow_create_customer(p_name text,p_request_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
DECLARE result uuid; BEGIN
 IF p_request_id IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'Invalid customer'; END IF;
 INSERT INTO public.organizations(id,name,status) VALUES(p_request_id,btrim(p_name),'active') ON CONFLICT(id) DO NOTHING;
 SELECT id INTO result FROM public.organizations WHERE id=p_request_id AND name=btrim(p_name);
 IF result IS NULL THEN RAISE EXCEPTION 'Customer idempotency conflict'; END IF;
 INSERT INTO public.subscription_accounts(organization_id,status,plan_key,provider,trial_start,trial_end)
 VALUES(result,'trial','standard','manual',now(),now()+interval '30 days') ON CONFLICT(organization_id) DO NOTHING;
 RETURN result;
END $f$;
CREATE FUNCTION public.doorflow_onboard_venue(p_request_id uuid,p_organization_id uuid,p_name text,p_timezone text,p_email text,p_full_name text,p_address jsonb DEFAULT '{}') RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE row public.venue_onboarding; payload jsonb; vid uuid;
BEGIN
 IF p_request_id IS NULL OR p_organization_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 160
 OR p_full_name IS NULL OR length(btrim(p_full_name)) NOT BETWEEN 1 AND 160
 OR p_email IS NULL OR lower(btrim(p_email)) !~ '^[^ @]+@[^ @]+\.[^ @]+$'
 OR p_timezone IS NULL OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=p_timezone)
 OR p_address IS NULL OR jsonb_typeof(p_address)<>'object' THEN RAISE EXCEPTION 'Invalid onboarding input'; END IF;
 payload:=jsonb_build_object('organization',p_organization_id,'name',btrim(p_name),'timezone',p_timezone,'email',lower(btrim(p_email)),'full_name',btrim(p_full_name),'address',p_address);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO row FROM public.venue_onboarding WHERE request_id=p_request_id;
 IF FOUND THEN
 IF row.request_payload<>payload THEN RAISE EXCEPTION 'Onboarding idempotency conflict'; END IF;
 RETURN to_jsonb(row); END IF;
 PERFORM 1 FROM public.organizations WHERE id=p_organization_id AND status='active' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Active customer required'; END IF;
 IF EXISTS(SELECT FROM public.venues WHERE organization_id=p_organization_id) THEN RAISE EXCEPTION 'Additional venues deferred'; END IF;
 IF EXISTS(SELECT FROM auth.users u JOIN public.staff_profiles sp ON sp.id=u.id WHERE lower(u.email)=lower(btrim(p_email))) THEN RAISE EXCEPTION 'Existing staff identity cannot be bootstrapped'; END IF;
 INSERT INTO public.venues(name,organization_id,lifecycle_status,address) VALUES(btrim(p_name),p_organization_id,'onboarding',p_address) RETURNING id INTO vid;
 INSERT INTO public.venue_settings(venue_id,timezone,default_door_location,service_day_rollover_time) VALUES(vid,p_timezone,'Front Door','04:00');
 INSERT INTO public.venue_branding(venue_id,app_name,short_name) VALUES(vid,btrim(p_name),'DoorFlow');
 INSERT INTO public.venue_onboarding(request_id,organization_id,venue_id,intended_email,full_name,request_payload)
 VALUES(p_request_id,p_organization_id,vid,lower(btrim(p_email)),btrim(p_full_name),payload) RETURNING * INTO row;
 INSERT INTO public.venue_administration_audit(venue_id,action,operator_label,details) VALUES(vid,'venue_created','trusted_server',jsonb_build_object('request_id',p_request_id));
 RETURN to_jsonb(row);
END $f$;
CREATE FUNCTION public.doorflow_bootstrap_admin(p_request_id uuid,p_auth_user_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE r public.venue_onboarding; sp public.staff_profiles; email text; confirmed timestamptz;
BEGIN
 SELECT * INTO r FROM public.venue_onboarding WHERE request_id=p_request_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Onboarding request required'; END IF;
 -- Serialize identity binding across requests. No updates to existing employees.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_auth_user_id::text,0));
 SELECT lower(u.email),u.email_confirmed_at INTO email,confirmed FROM auth.users u WHERE id=p_auth_user_id FOR UPDATE;
 IF email IS DISTINCT FROM r.intended_email OR confirmed IS NULL THEN RAISE EXCEPTION 'Confirmed intended Auth identity required'; END IF;
 SELECT * INTO sp FROM public.staff_profiles WHERE id=p_auth_user_id FOR UPDATE;
 IF FOUND THEN
 IF r.auth_user_id=p_auth_user_id AND sp.venue_id=r.venue_id AND sp.role='admin' AND sp.active THEN RETURN to_jsonb(r); END IF;
 RAISE EXCEPTION 'Existing staff profile cannot be moved or promoted'; END IF;
 IF r.auth_user_id IS NOT NULL THEN RAISE EXCEPTION 'Bootstrap already bound'; END IF;
 IF EXISTS(SELECT FROM public.staff_profiles WHERE venue_id=r.venue_id AND role='admin') THEN RAISE EXCEPTION 'Venue already has an Admin'; END IF;
 INSERT INTO public.staff_profiles(id,full_name,role,active,venue_id) VALUES(p_auth_user_id,r.full_name,'admin',true,r.venue_id);
 UPDATE public.venue_onboarding SET auth_user_id=p_auth_user_id,completed_at=now() WHERE request_id=p_request_id RETURNING * INTO r;
 INSERT INTO public.venue_administration_audit(venue_id,action,operator_label,details) VALUES(r.venue_id,'first_admin_bound','trusted_server',jsonb_build_object('request_id',p_request_id,'auth_user_id',p_auth_user_id));
 RETURN to_jsonb(r);
END $f$;
CREATE FUNCTION public.doorflow_set_venue_lifecycle(p_venue_id uuid,p_status text,p_subscription_status text DEFAULT NULL,p_reason text DEFAULT '') RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
DECLARE org uuid; BEGIN
 IF p_status IS NULL OR p_status NOT IN ('onboarding','active','suspended','canceled') OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'Valid status and reason required'; END IF;
 SELECT organization_id INTO org FROM public.venues WHERE id=p_venue_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Venue missing'; END IF;
 IF p_status='active' AND NOT EXISTS(SELECT FROM public.staff_profiles WHERE venue_id=p_venue_id AND role='admin' AND active) THEN RAISE EXCEPTION 'First Admin required'; END IF;
 IF p_subscription_status IS NOT NULL THEN
 IF p_subscription_status NOT IN ('trial','active','suspended','canceled') OR org IS NULL THEN RAISE EXCEPTION 'Invalid subscription transition'; END IF;
 UPDATE public.subscription_accounts SET status=p_subscription_status,updated_at=now() WHERE organization_id=org;
 IF NOT FOUND THEN RAISE EXCEPTION 'Subscription missing'; END IF; END IF;
 UPDATE public.venues SET lifecycle_status=p_status WHERE id=p_venue_id;
 INSERT INTO public.venue_administration_audit(venue_id,action,operator_label,details) VALUES(p_venue_id,'lifecycle_changed','trusted_server',jsonb_build_object('status',p_status,'subscription_status',p_subscription_status,'reason',p_reason));
END $f$;
CREATE FUNCTION public.doorflow_update_venue_settings(p_name text,p_timezone text,p_door text,p_rollover time,p_logo text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $f$
DECLARE vid uuid; BEGIN
 SELECT venue_id INTO vid FROM public.staff_profiles WHERE id=auth.uid() AND active AND role='admin';
 IF vid IS NULL THEN RAISE EXCEPTION 'Venue Admin required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.venues WHERE id=vid AND lifecycle_status IN ('onboarding','active') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Venue is not editable' USING ERRCODE='42501'; END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 160 OR p_timezone IS NULL OR NOT EXISTS(SELECT FROM pg_timezone_names WHERE name=p_timezone)
 OR p_door IS NULL OR length(btrim(p_door)) NOT BETWEEN 1 AND 100 OR p_rollover IS NULL
 OR (p_logo IS NOT NULL AND (length(p_logo)>2048 OR p_logo !~ '^https://[^ /]+/')) THEN RAISE EXCEPTION 'Invalid venue settings'; END IF;
 UPDATE public.venues SET name=btrim(p_name) WHERE id=vid;
 UPDATE public.venue_settings SET timezone=p_timezone,default_door_location=btrim(p_door),service_day_rollover_time=p_rollover,updated_at=now() WHERE venue_id=vid;
 UPDATE public.venue_branding SET logo_url=p_logo,app_name=btrim(p_name),updated_at=now() WHERE venue_id=vid;
 INSERT INTO public.venue_administration_audit(venue_id,action,actor_user_id,operator_label) VALUES(vid,'settings_updated',auth.uid(),'venue_admin');
END $f$;
DO $permissions$ DECLARE r record; BEGIN
 FOR r IN SELECT oid::regprocedure AS signature,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('doorflow_create_customer','doorflow_onboard_venue','doorflow_bootstrap_admin','doorflow_set_venue_lifecycle','doorflow_update_venue_settings') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',r.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
 IF r.proname='doorflow_update_venue_settings' THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.signature); END IF;
 END LOOP;
END $permissions$;
-- Preserve reviewed invitation implementations; add lifecycle refusal before each
-- reservation/claim/dispatch decision, including existing idempotent replays.
DO $invitations$ DECLARE r record; body text; BEGIN
 FOR r IN SELECT oid,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('doorflow_reserve_staff_invitation','doorflow_claim_staff_invitation','doorflow_authorize_staff_invitation_dispatch') LOOP
 body:=replace(pg_get_functiondef(r.oid),chr(13),'');
 IF position(E'begin\n' IN body)=0 THEN RAISE EXCEPTION 'Invitation function boundary drift'; END IF;
 body:=replace(body,E'begin\n',E'begin\n  if not exists(select 1 from public.staff_profiles sp where sp.id=p_actor_user_id and sp.active and sp.role=''admin'' and public.doorflow_venue_operational(sp.venue_id)) then return pg_catalog.jsonb_build_object(''decision_code'',''forbidden'',''record'',null); end if;\n');
 EXECUTE body;
 END LOOP;
END $invitations$;
COMMIT;
