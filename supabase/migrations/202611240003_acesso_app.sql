-- Apply only after authorizing exposure of gestao_pessoal in the Data API.
begin;
create table gestao_pessoal.acessos_app (
  user_id uuid primary key references auth.users(id) on delete cascade
);
alter table gestao_pessoal.acessos_app enable row level security;
revoke all on gestao_pessoal.acessos_app from public, anon, authenticated, service_role;

create function gestao_pessoal.tem_acesso_app() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from gestao_pessoal.acessos_app
    where user_id = (select auth.uid())
  );
$$;
revoke all on function gestao_pessoal.tem_acesso_app() from public, anon, authenticated, service_role;
grant usage on schema gestao_pessoal to authenticated;
grant execute on function gestao_pessoal.tem_acesso_app() to authenticated;

do $setup$
declare nome text;
begin
  foreach nome in array array['contas','ganhos','reservas','metas_mensais','fontes_renda','metas_por_fonte'] loop
    execute format('create policy acesso_app on gestao_pessoal.%I as restrictive for all to authenticated using ((select gestao_pessoal.tem_acesso_app())) with check ((select gestao_pessoal.tem_acesso_app()))', nome);
    execute format('grant select, insert, update on gestao_pessoal.%I to authenticated', nome);
  end loop;
end
$setup$;
commit;
