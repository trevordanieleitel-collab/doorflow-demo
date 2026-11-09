// Trusted operator tool. Never published by build-public.mjs. No email APIs.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const STAGING='ktvmihmkdfvzmgubsqqc';
const PRODUCTION='wdlgkwzowapzhurbbavf';
export function createOperator({projectRef,secret,fetchImpl=fetch}) {
 if(![STAGING,PRODUCTION].includes(projectRef)||!secret)throw Error('Explicit DoorFlow project and server credential required');
 const base=`https://${projectRef}.supabase.co`;
 async function call(path,body){
  const response=await fetchImpl(base+path,{method:'POST',headers:{apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const raw=await response.text();
  const data=raw ? JSON.parse(raw) : null;
  if(!response.ok)throw Error(`Operator request refused (${response.status}, ${data?.code||'no_code'}). Inspect the request and server audit; no credential changes were attempted.`);
  return data;
 }
 const rpc=(name,args)=>call('/rest/v1/rpc/'+name,args);
 return {
  async onboard(input){
   const org=await rpc('doorflow_create_customer',{p_name:input.customerName,p_request_id:input.customerRequestId});
   return rpc('doorflow_onboard_venue',{p_request_id:input.requestId,p_organization_id:org,p_name:input.venueName,p_timezone:input.timezone,p_email:input.email,p_full_name:input.fullName,p_address:input.address||{}});
  },
  async bootstrap(input){
   if(!input.authUserId)throw Error('Explicit confirmed Auth user ID required; existing accounts are never silently selected');
   return rpc('doorflow_bootstrap_admin',{p_request_id:input.requestId,p_auth_user_id:input.authUserId});
  },
  async createStagingUser(input,password){
   if(projectRef!==STAGING||!input.email?.endsWith('@example.invalid')||!password||password.length<20)throw Error('No-email user creation requires staging, a fictional email and a strong temporary password');
   // Auth admin create-user is not inviteUserByEmail. No recovery/resend endpoint exists here.
   const user=await call('/auth/v1/admin/users',{email:input.email,password,email_confirm:true,user_metadata:{full_name:input.fullName}});
   return {authUserId:user.id};
  },
  async customerStatus(input){return rpc("doorflow_set_customer_status",{p_organization_id:input.organizationId,p_status:input.status,p_reason:input.reason});},
  async lifecycle(input){return rpc('doorflow_set_venue_lifecycle',{p_venue_id:input.venueId,p_status:input.status,p_subscription_status:input.subscriptionStatus||null,p_reason:input.reason});}
 };
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [command,path]=process.argv.slice(2);
  if(!['onboard','bootstrap','createStagingUser','lifecycle','customerStatus'].includes(command)||!path)throw Error('Usage: node scripts/venue-operator.mjs onboard|bootstrap|createStagingUser|lifecycle request.json');
  const input=JSON.parse(await readFile(path,'utf8'));
  const operator=createOperator({projectRef:process.env.DOORFLOW_OPERATOR_PROJECT_REF,secret:process.env.DOORFLOW_OPERATOR_SECRET});
  const result=await operator[command](input,process.env.DOORFLOW_STAGING_TEMP_PASSWORD);
  // Deliberately omit Auth tokens, user details, passwords and API response metadata.
  console.log(JSON.stringify(result&&{requestId:result.request_id,venueId:result.venue_id,organizationId:result.organization_id,authUserId:result.authUserId||result.auth_user_id,completedAt:result.completed_at}||{complete:true}));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
