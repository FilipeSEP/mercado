-- =========================================================
-- Lista do Mercado - Script de configuração do banco (Supabase)
-- Rode isso em: Supabase > SQL Editor > New query > Run
-- =========================================================

create extension if not exists pgcrypto;

-- Tabela dos itens da lista
create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  checked boolean not null default false,
  created_at timestamptz not null default now()
);

-- Tabela do histórico de compras finalizadas
create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  total numeric(10,2) not null,
  items jsonb not null,
  created_at timestamptz not null default now()
);

-- Segurança: só usuários logados (autenticados) podem ler/gravar.
-- Como é uma única conta compartilhada pela família, não precisamos
-- filtrar por usuário, só exigir que esteja autenticado.
alter table items enable row level security;
alter table purchases enable row level security;

create policy "authenticated_select_items" on items
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_items" on items
  for insert with check (auth.role() = 'authenticated');
create policy "authenticated_update_items" on items
  for update using (auth.role() = 'authenticated');
create policy "authenticated_delete_items" on items
  for delete using (auth.role() = 'authenticated');

create policy "authenticated_select_purchases" on purchases
  for select using (auth.role() = 'authenticated');
create policy "authenticated_insert_purchases" on purchases
  for insert with check (auth.role() = 'authenticated');

-- Habilita sincronização em tempo real entre os celulares
alter publication supabase_realtime add table items;

-- Popula a lista com os 30 itens originais (só roda se a tabela estiver vazia)
insert into items (name)
select name from (values
  ('Manteiga'),('Aveia'),('Azeite'),('Desodorante'),('Creme dental'),
  ('Detergente'),('Cândida'),('Amaciante'),('Requeijão light'),('Pão de forma'),
  ('Mussarela'),('Iogurte sem sabor'),('Cenoura'),('Batata'),('Cebola'),
  ('Alho'),('RedBull sem açúcar'),('Papel toalha'),('Papel alumínio'),('Papel manteiga'),
  ('Produto para privada'),('Perfex'),('Lustra Móveis'),('Leite'),('Mata barata'),
  ('Chiclete'),('Bala mentos'),('Ervilha'),('Suco de laranja'),('Enxaguante bucal')
) as seed(name)
where not exists (select 1 from items);