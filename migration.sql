-- =========================================================
-- Migração: adiciona quantidade e preço unitário por item
-- Rode isso em: Supabase > SQL Editor > New query > Run
-- (Seguro rodar mesmo já tendo dados - só adiciona colunas novas)
-- =========================================================

alter table items add column if not exists quantity numeric(10,2) not null default 1;
alter table items add column if not exists unit_price numeric(10,2);

alter table items add column if not exists unit text not null default 'un';