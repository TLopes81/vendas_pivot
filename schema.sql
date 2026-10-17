-- PIVOT Deal Manager - Schema Supabase (Postgres)
-- Rode isso inteiro no Supabase Dashboard -> SQL Editor -> New query -> Run

create extension if not exists pgcrypto;

drop table if exists log_desconto cascade;
drop table if exists pivos cascade;
drop table if exists aprovacoes cascade;
drop table if exists arquivos cascade;
drop table if exists projetos cascade;
drop table if exists usuarios cascade;
drop table if exists config_fiscal cascade;
drop table if exists config_global cascade;

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

-- Projeto agora nasce dos uploads de pivos, nao de formulario manual.
-- valor/custo somem daqui: sao agregados a partir da tabela pivos.
create table projetos (
  id uuid primary key default gen_random_uuid(),
  cliente text not null,
  estado text,
  municipio text,
  fazenda text,
  descricao text,
  status text default 'em_negociacao' check (status in ('em_negociacao','aprovado','reprovado')),
  vendedor_id uuid references usuarios(id),
  gerente_id uuid references usuarios(id),
  caminho_local_calculadora text, -- caminho da planilha "Calculadora" (.xlsm) deste cliente, na pasta local do usuario
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Um registro por pivo (equipamento), extraido automaticamente do arquivo
-- de proposta individual (.xlsb) e sincronizado com a linha correspondente
-- na aba "Calculo" da Calculadora (.xlsm) do cliente.
create table pivos (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid references projetos(id) on delete cascade,

  -- identificacao (extraidos da aba PROPOSTA)
  numero_pivo text not null,         -- ex: "PC 05"
  composicao text,                   -- ex: "P 05-638/01-637/L4"
  propriedade text,
  municipio text,
  estado text,
  marca text,
  modelo text,
  area_irrigada_ha numeric,          -- extraido da aba FICHA_TECNICA

  -- entradas editaveis (replicam a aba "Calculo" da Calculadora, colunas E-I)
  encargos_pct numeric default 10,
  desconto_pct numeric default 0,    -- "Desconto Pivo" -- o campo que o vendedor edita
  taxa_flat_pct numeric default 0,
  montagem numeric default 0,
  servicos_adicionais numeric default 0,

  -- extraidos da PROPOSTA (nao editaveis, vem do arquivo fonte)
  preco_total numeric,               -- J: TOTAL GERAL (linha 260, col 28 na PROPOSTA)
  preco_parte_aerea numeric,         -- K: Sub Total D - PIVO (linha 259, col 28 na PROPOSTA)
  preco_pvc numeric default 0,       -- L

  -- calculados (formula validada contra a Calculadora real; ver recalcularPivo no server.js)
  valor_negociado numeric,           -- N: o numero que vai para o cliente
  custo_por_hectare numeric,         -- O: valor_negociado / area_irrigada_ha
  pct_ancillary numeric,             -- M

  -- controle de arquivo/versao
  revisao int default 1,
  nome_arquivo_original text,
  caminho_local text,
  linha_calculadora int,             -- linha dentro da aba "Calculo" da Calculadora (p/ escrita de volta)

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Tabela de desconto/parametros fiscais por estado (aba "Dados" da Calculadora).
-- Editavel no sistema -- isso resolve "atualizar a tabela de desconto".
create table config_fiscal (
  estado text primary key,
  icms_pct numeric not null,
  updated_at timestamptz default now()
);

-- Constantes globais usadas na formula (aba "Dados": PIS, Desconto itens revenda)
create table config_global (
  chave text primary key,
  valor numeric not null,
  descricao text,
  updated_at timestamptz default now()
);

create table arquivos (
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid references projetos(id) on delete cascade,
  pivo_id uuid references pivos(id) on delete cascade,
  nome text,
  caminho text,
  tipo text default 'pivo' check (tipo in ('pivo','calculadora','outro')),
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

-- Auditoria: toda vez que alguem muda o desconto de um pivo pelo sistema
create table log_desconto (
  id uuid primary key default gen_random_uuid(),
  pivo_id uuid references pivos(id) on delete cascade,
  usuario_id uuid references usuarios(id),
  desconto_anterior numeric,
  desconto_novo numeric,
  valor_negociado_anterior numeric,
  valor_negociado_novo numeric,
  sincronizado_local boolean default false, -- vira true quando o script local grava no .xlsm
  created_at timestamptz default now()
);

alter table usuarios disable row level security;
alter table projetos disable row level security;
alter table pivos disable row level security;
alter table config_fiscal disable row level security;
alter table config_global disable row level security;
alter table arquivos disable row level security;
alter table aprovacoes disable row level security;
alter table log_desconto disable row level security;

-- Dados fiscais extraidos da aba "Dados" da Calculadora real (validos para todas as planilhas)
INSERT INTO config_fiscal (estado, icms_pct) VALUES
('AL',4.1),('AM',4.1),('AP',4.1),('BA',4.1),('CE',4.1),('DF',4.1),('ES',4.1),('GO',4.1),
('MA',4.1),('MG',7.0),('MS',4.1),('MT',4.1),('PA',4.1),('PB',4.1),('PE',4.1),('PI',4.1),
('PR',7.0),('RJ',7.0),('RN',4.1),('RO',4.1),('RR',4.1),('RS',7.0),('SC',7.0),('SE',4.1),
('SP',0),('TO',4.1)
ON CONFLICT (estado) DO NOTHING;

INSERT INTO config_global (chave, valor, descricao) VALUES
('pis_pct', 6.58, 'PIS usado na formula de valor negociado'),
('desconto_revenda_pct', 5, 'Desconto fixo de itens de revenda (aplicado na parte nao-aerea)')
ON CONFLICT (chave) DO NOTHING;

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
