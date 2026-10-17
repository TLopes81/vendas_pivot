-- PIVOT Deal Manager - Schema Supabase (Postgres)
-- Rode isso inteiro no Supabase Dashboard -> SQL Editor -> New query -> Run

create extension if not exists pgcrypto;

drop table if exists aprovacoes cascade;
drop table if exists arquivos cascade;
drop table if exists projetos cascade;
drop table if exists usuarios cascade;

create table usuarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text unique not null,
  senha_hash text not null,
  salt text not null,
  nivel text not null check (nivel in ('diretor','gerente','vendedor')),
  superior_id uuid references usuarios(id),
  ativo boolean default true,
  created_at timestamptz default now()
);

create table projetos (
  id uuid primary key default gen_random_uuid(),
  cliente text not null,
  descricao text,
  valor numeric default 0,
  custo numeric default 0,
  status text default 'em_negociacao' check (status in ('em_negociacao','aprovado','reprovado')),
  vendedor_id uuid references usuarios(id),
  gerente_id uuid references usuarios(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table arquivos (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid references projetos(id) on delete cascade,
  nome text,
  caminho text,
  tamanho bigint,
  mimetype text,
  enviado_por uuid references usuarios(id),
  created_at timestamptz default now()
);

create table aprovacoes (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid references projetos(id) on delete cascade,
  aprovador_id uuid references usuarios(id),
  decisao text,
  comentario text,
  created_at timestamptz default now()
);

alter table usuarios disable row level security;
alter table projetos disable row level security;
alter table arquivos disable row level security;
alter table aprovacoes disable row level security;

INSERT INTO usuarios (id, nome, email, senha_hash, salt, nivel, superior_id, ativo, created_at) VALUES
('4c8b8970-d853-4f2a-b05c-f13cbbb7960f', 'Silvio Pivot', 'silvio@pivot.com', 'f29f0d2d83444ced2870c5ce59339ef58660bf6e2b329e16e4387cd2af8d2457', '76674dae8fec7338', 'diretor', NULL, true, now()),
('1ffb6ae4-273b-4549-86b7-63a25a1a6bc9', 'Marta Alves', 'marta@pivot.com', 'e3ae328976c49e1bd653a4f316c833c2c8ff2697f719484b182e030c6daa2403', '09ee1a8e46853215', 'gerente', '4c8b8970-d853-4f2a-b05c-f13cbbb7960f', true, now()),
('4addecb6-f1b1-4d6a-ab18-68a067791a78', 'Roberto Lima', 'roberto@pivot.com', 'aa1b5e59c14e99cdee46083b489848d0a95d2fbc0ee09845c3ab7a0cea4fd80c', '495fa21b009609e4', 'gerente', '4c8b8970-d853-4f2a-b05c-f13cbbb7960f', true, now()),
('751bfaab-9d2e-4359-aaa3-f899dfc352d2', 'Ana Souza', 'ana@pivot.com', '2a8a17c30d1effe0c03f71fa2d207b6eef55b85bffd146dcb60a4f7804890a87', '042f50276b9e7214', 'vendedor', '1ffb6ae4-273b-4549-86b7-63a25a1a6bc9', true, now()),
('e59ca3c6-128e-4ed6-9431-5ebe4ad976de', 'Bruno Dias', 'bruno@pivot.com', '23f1fded35c51a3f1975f4918234602093df2f7212faea9620af584f34fb1fe9', 'b428dcb6c1a7dce4', 'vendedor', '1ffb6ae4-273b-4549-86b7-63a25a1a6bc9', true, now()),
('07f7fec7-be89-49f3-98fb-10bfe9d3d471', 'Carla Mendes', 'carla@pivot.com', '4b3f636ea1e20a04d4a1eab54312b657a89c14e78a41e293c7ca8672ad88726b', 'e196e1d0b7634bcc', 'vendedor', '1ffb6ae4-273b-4549-86b7-63a25a1a6bc9', true, now()),
('3fdb9724-abc9-463a-8e69-8803a69e8c71', 'Diego Rocha', 'diego@pivot.com', '70d2686c386b6584bfe540512d7f1b6e3e0a494423463c82f7f44632ab05b343', 'f008fcb4b09c70dc', 'vendedor', '1ffb6ae4-273b-4549-86b7-63a25a1a6bc9', true, now()),
('6fbe37f6-bf0c-4b5f-bec7-9ab6d326c73c', 'Elisa Prado', 'elisa@pivot.com', '81f931fa09be978705e0edce62ccfcdd118e7b37905e751fecf00d8184d74903', 'd73a8f38fc30b281', 'vendedor', '1ffb6ae4-273b-4549-86b7-63a25a1a6bc9', true, now()),
('735a1781-b97a-4a87-87a7-bbaf48c8c5b4', 'Fabio Nunes', 'fabio@pivot.com', '2461a255423cea5e5b1b259286b2200934d4499080d9a459b2b0250b8e48587b', 'f13f0e3dfaf4004b', 'vendedor', '4addecb6-f1b1-4d6a-ab18-68a067791a78', true, now()),
('be0c27f1-7e80-409a-aeb9-b4927a1ff050', 'Gisele Barros', 'gisele@pivot.com', 'ec7f301ee20e1d2c2e6a0e0ac2007f28ed867c36f4e8c1fdffbe8f509ac80a63', '1854a6d74fbe1c15', 'vendedor', '4addecb6-f1b1-4d6a-ab18-68a067791a78', true, now()),
('98458973-4219-48b2-b204-c6a3e723a684', 'Heitor Campos', 'heitor@pivot.com', '5f134d2de377c3a4144e2937f59e4ef47d08574f646de513d6d773e0b1dab9f7', 'cf499c825e462658', 'vendedor', '4addecb6-f1b1-4d6a-ab18-68a067791a78', true, now()),
('b5c30f1e-16f8-4c23-88e9-5915e9c6602c', 'Iris Tavares', 'iris@pivot.com', 'e68b4e2429152460dd71fd986fa9d10e5fe35176898e3b3535bc964241087562', 'c8675ea51827a614', 'vendedor', '4addecb6-f1b1-4d6a-ab18-68a067791a78', true, now()),
('9678564b-7ec8-4907-b37f-7bab02e30625', 'Joao Peixoto', 'joao@pivot.com', 'f6f75c0e1f553faba2801d8f06764c1ae0e5fc0bdeb4d5851f9923dc5871ec6b', '43c8d0d998b16723', 'vendedor', '4addecb6-f1b1-4d6a-ab18-68a067791a78', true, now())
ON CONFLICT (email) DO NOTHING;
