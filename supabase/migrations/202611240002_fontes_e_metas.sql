begin;
create table gestao_pessoal.fontes_renda (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id),
  nome text not null check (length(btrim(nome)) between 1 and 100),
  arquivada_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (user_id, id)
);
create unique index fontes_renda_nome_ativo
  on gestao_pessoal.fontes_renda (user_id, lower(btrim(nome)))
  where arquivada_em is null;

create table gestao_pessoal.metas_por_fonte (
  user_id uuid not null default auth.uid() references auth.users(id),
  fonte_id uuid not null,
  periodo text not null check (periodo in ('semana', 'mes')),
  inicio date not null,
  meta_centavos bigint not null check (meta_centavos > 0),
  primary key (user_id, fonte_id, periodo, inicio),
  foreign key (user_id, fonte_id) references gestao_pessoal.fontes_renda(user_id, id),
  check (case periodo when 'semana' then extract(isodow from inicio) = 1
                      when 'mes' then extract(day from inicio) = 1 end)
);

alter table gestao_pessoal.ganhos add column fonte_id uuid;
alter table gestao_pessoal.ganhos add constraint ganhos_fonte_titular
  foreign key (user_id, fonte_id) references gestao_pessoal.fontes_renda(user_id, id);
create index ganhos_usuario_fonte_data
  on gestao_pessoal.ganhos (user_id, fonte_id, recebido_em);

alter table gestao_pessoal.fontes_renda enable row level security;
alter table gestao_pessoal.fontes_renda force row level security;
create policy dono on gestao_pessoal.fontes_renda for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter table gestao_pessoal.metas_por_fonte enable row level security;
alter table gestao_pessoal.metas_por_fonte force row level security;
create policy dono on gestao_pessoal.metas_por_fonte for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
revoke all on gestao_pessoal.fontes_renda, gestao_pessoal.metas_por_fonte
  from public, anon, authenticated, service_role;
commit;
