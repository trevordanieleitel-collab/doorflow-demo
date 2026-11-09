BEGIN;
SET LOCAL lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.doorflow_venue_operational(p_venue uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $f$
 SELECT EXISTS(SELECT FROM public.venues v LEFT JOIN public.organizations o ON o.id=v.organization_id
 LEFT JOIN public.subscription_accounts s ON s.organization_id=o.id
 WHERE v.id=p_venue AND v.lifecycle_status='active'
 AND (current_setting('role',true) NOT IN ('authenticated','anon') OR EXISTS(SELECT FROM public.staff_profiles sp WHERE sp.id=auth.uid() AND sp.active AND sp.venue_id=p_venue))
 AND (v.organization_id IS NULL OR (o.status='active' AND s.status IN ('legacy','trial','active'))))
$f$;
CREATE POLICY phase9_staff_read ON public.staff_profiles AS RESTRICTIVE FOR SELECT TO authenticated
USING(id=(SELECT auth.uid()) OR public.doorflow_venue_operational(venue_id));
CREATE FUNCTION public.doorflow_set_customer_status(p_organization_id uuid,p_status text,p_reason text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $f$
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('active','suspended','canceled') OR p_reason IS NULL OR length(btrim(p_reason))<3 THEN RAISE EXCEPTION 'Valid customer status and reason required'; END IF;
 UPDATE public.organizations SET status=p_status,updated_at=now() WHERE id=p_organization_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Customer missing'; END IF;
 INSERT INTO public.venue_administration_audit(action,operator_label,details) VALUES('customer_status_changed','trusted_server',jsonb_build_object('organization_id',p_organization_id,'status',p_status,'reason',p_reason));
END $f$;
REVOKE ALL ON FUNCTION public.doorflow_set_customer_status(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.doorflow_set_customer_status(uuid,text,text) TO service_role;
CREATE INDEX venue_onboarding_organization_idx ON public.venue_onboarding(organization_id);
CREATE INDEX venue_administration_audit_venue_idx ON public.venue_administration_audit(venue_id);
COMMIT;
