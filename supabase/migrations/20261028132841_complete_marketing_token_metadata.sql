-- Aggregate private-reader metadata before PostgREST's set-row limit.
create function public.read_owned_marketing_token_metadata(p_owner uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare tokens jsonb;total integer;result jsonb;
begin
 if current_user<>'service_role' then raise exception 'Credential metadata unavailable' using errcode='42501';end if;
 if p_owner is null then raise exception 'Credential metadata invalid' using errcode='22023';end if;
 select count(*)::integer,coalesce(jsonb_agg(jsonb_build_object('account_id',t.account_id,'brand',t.brand,'platform',t.platform,
  'expires_at',t.expires_at,'refreshed_at',t.refreshed_at,'scopes',to_jsonb(t.scopes),'login_mode',t.login_mode)
  order by t.brand,t.platform,t.account_id),'[]'::jsonb)
 into total,tokens from public.marketing_account_token_metadata(p_owner) t;
 -- The existing account constraint allows two brands × two platforms per owner.
 result:=jsonb_build_object('ownerId',p_owner,'count',total,'tokens',tokens);
 if total>4 or octet_length(result::text)>16384 then raise exception 'Credential metadata unavailable' using errcode='54000';end if;
 return result;
end $$;
revoke all on function public.read_owned_marketing_token_metadata(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_owned_marketing_token_metadata(uuid) to service_role;
comment on function public.read_owned_marketing_token_metadata(uuid) is
 'One complete owner-bound non-secret metadata envelope before the REST row limit; four constrained tuples and 16KiB maximum. Service-only invoker over the existing private reader; no credential, row, table-privilege or RLS changes.';
