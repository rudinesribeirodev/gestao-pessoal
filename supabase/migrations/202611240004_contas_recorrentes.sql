begin;
alter table gestao_pessoal.contas
  add column recorrente boolean not null default false,
  add column conta_origem_id uuid,
  add column mes_recorrencia date,
  add constraint contas_titular_id_unique unique (user_id, id),
  add constraint contas_origem_titular_fk foreign key (user_id, conta_origem_id)
    references gestao_pessoal.contas (user_id, id),
  add constraint contas_recorrencia_valida check (
    (conta_origem_id is null and mes_recorrencia is null)
    or (conta_origem_id is not null and conta_origem_id <> id
        and mes_recorrencia is not null and extract(day from mes_recorrencia) = 1
        and not recorrente)
  ),
  add constraint contas_ocorrencia_unica unique (user_id, conta_origem_id, mes_recorrencia);
commit;
