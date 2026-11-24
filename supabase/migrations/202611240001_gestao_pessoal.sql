begin;
create schema gestao_pessoal;
revoke all on schema gestao_pessoal from public, anon, authenticated, service_role;

create table gestao_pessoal.metas_mensais (
  user_id uuid not null default auth.uid() references auth.users(id),
  mes date not null check (extract(day from mes) = 1),
  meta_centavos bigint not null check (meta_centavos >= 0),
  primary key (user_id, mes)
);
create table gestao_pessoal.contas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  descricao text not null check (length(btrim(descricao)) between 1 and 200),
  vencimento date not null,
  valor_centavos bigint not null check (valor_centavos > 0),
  pago_em date,
  criado_em timestamptz not null default now()
);
create index contas_usuario_vencimento on gestao_pessoal.contas (user_id, vencimento);
create table gestao_pessoal.ganhos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  origem text not null check (length(btrim(origem)) between 1 and 100),
  descricao text check (length(descricao) <= 200),
  recebido_em date not null,
  valor_centavos bigint not null check (valor_centavos > 0),
  criado_em timestamptz not null default now()
);
create index ganhos_usuario_data on gestao_pessoal.ganhos (user_id, recebido_em);
create table gestao_pessoal.reservas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  data date not null,
  tipo text not null check (tipo in ('saldo_inicial', 'deposito', 'retirada')),
  valor_centavos bigint not null check (valor_centavos > 0),
  criado_em timestamptz not null default now()
);
create index reservas_usuario_data on gestao_pessoal.reservas (user_id, data);
create unique index reservas_um_saldo_inicial on gestao_pessoal.reservas (user_id) where tipo = 'saldo_inicial';
create table gestao_pessoal.uber_semanas (
  user_id uuid not null default auth.uid() references auth.users(id),
  semana date not null check (extract(isodow from semana) = 1),
  dias_previstos smallint not null default 6 check (dias_previstos between 0 and 6),
  meta_diaria_centavos bigint not null check (meta_diaria_centavos >= 0),
  combustivel_diario_previsto_centavos bigint not null check (combustivel_diario_previsto_centavos >= 0),
  app_recebido_centavos bigint check (app_recebido_centavos >= 0),
  combustivel_real_centavos bigint check (combustivel_real_centavos >= 0),
  check ((app_recebido_centavos is null) = (combustivel_real_centavos is null)),
  primary key (user_id, semana)
);

revoke all on all tables in schema gestao_pessoal from public, anon, authenticated, service_role;
do $setup$
declare nome text;
begin
  foreach nome in array array['metas_mensais','contas','ganhos','reservas','uber_semanas'] loop
    execute format('alter table gestao_pessoal.%I enable row level security', nome);
    execute format('alter table gestao_pessoal.%I force row level security', nome);
    execute format('create policy dono on gestao_pessoal.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', nome);
  end loop;
end
$setup$;
commit;

select c.relname as tabela, c.relrowsecurity as rls, c.relforcerowsecurity as rls_forcada,
       not has_schema_privilege('anon', n.oid, 'USAGE') as anon_bloqueado,
       not has_schema_privilege('authenticated', n.oid, 'USAGE') as api_bloqueada
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'gestao_pessoal' and c.relkind = 'r'
order by c.relname;
