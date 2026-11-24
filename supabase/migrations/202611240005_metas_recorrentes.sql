begin;
alter table gestao_pessoal.metas_mensais add column recorrente boolean not null default false;
alter table gestao_pessoal.metas_por_fonte
  add column recorrente boolean not null default false,
  add constraint metas_por_fonte_recorrencia_mensal check (not recorrente or periodo = 'mes');
commit;
