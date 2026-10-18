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
  regiao text, -- R1/R2/R3 (vendedor externo) ou regiao(oes) do gerente
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

  -- Parametros comerciais da NEGOCIACAO (unicos para o projeto inteiro --
  -- aplicam-se a todos os pivos dele, nunca um valor por pivo/equipamento).
  encargos_pct numeric default 10,
  desconto_pct numeric default 0,   -- "Desconto Pivo" -- o campo que o vendedor edita
  taxa_flat_pct numeric default 0,
  montagem numeric default 0,       -- total da negociacao, somado uma unica vez (nao por pivo)
  servicos_adicionais numeric default 0, -- idem

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Um registro por pivo (equipamento), extraido automaticamente do arquivo
-- de proposta individual (.xlsb) e sincronizado com a linha correspondente
-- na aba "Calculo" da Calculadora (.xlsm) do cliente.
-- Parametros comerciais (Encargos/Desconto/Taxa Flat/Montagem/Servicos
-- Adicionais) adicionados em `projetos`, abaixo (sao UNICOS por negociacao --
-- valem para todos os pivos daquele projeto, nunca um valor por pivo).

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

  -- KPIs tecnicos (extraidos da aba FICHA_TECNICA, coordenadas validadas)
  potencia_motobomba_cv numeric,     -- "Potencia motobomba (CV)" linha 7 col 95
  perda_carga_parte_aerea_mca numeric, -- "perda friccional no tubo Pivo" linha 11 col 24
  bomba_nome text,                   -- ex "ETA 150-40"
  bomba_eficiencia_pct numeric,      -- "rendimento" da bomba selecionada
  adutora_trechos jsonb,             -- [{comprimento_m, diametro_mm, diametro_nominal_mm, pn, material}], tabela "Tubulacao Adutora"

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

-- Arquivo enviado por um vendedor para um destinatario (gerente/diretor) aprovar.
-- O destinatario "aceita" (status vira aceito) e, nesse momento, o navegador
-- do destinatario organiza uma copia local do arquivo na mesma estrutura de
-- pastas (Cliente/Estado/Municipio/Fazenda/versoes) usada pelo vendedor.
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
  destinatario_id uuid references usuarios(id),
  status text default 'pendente' check (status in ('pendente','aceito','recusado')),
  aceito_em timestamptz,
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

-- Historico de versoes de um pivo. Reenviar a planilha de um pivo que ja
-- existe no projeto (mesmo projeto_id + numero_pivo) NAO cria uma linha
-- nova em `pivos` -- atualiza a mesma linha (ela e sempre "a versao
-- atual", e e nela que desconto/encargos/margem continuam sendo
-- editados). O estado anterior inteiro fica congelado aqui antes da
-- atualizacao, pra nunca perder historico nem contar o pivo em dobro no
-- dashboard.
create table pivos_historico (
  id uuid primary key default gen_random_uuid(),
  pivo_id uuid references pivos(id) on delete cascade,
  revisao int not null,
  dados jsonb not null, -- snapshot completo da linha de `pivos` antes da atualizacao
  substituido_por uuid references usuarios(id),
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
alter table pivos_historico disable row level security;
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

-- Usuarios reais da Pivot (hierarquia confirmada pelo usuario em 2026-10-17).
-- Senha padrao para todos: 123456 (pode/deve ser trocada depois).
INSERT INTO usuarios (id, nome, email, senha_hash, salt, nivel, superior_id, regiao, ativo, created_at) VALUES
('18110275-3f74-4b3c-bbac-a92e976a2cb9', 'Silvio Ubiratam', 'silvio@pivot.com.br', 'baa76c34a61105ae05f1c1b16cbe558198edd361d16d91d20dbee2403c851d51', 'c65242dabb0a95ac', 'diretor', NULL, NULL, true, now()),
('11834622-d144-4319-a69d-2432e757117f', 'Tiago Lopes Garcia', 'tiago.garcia@pivot.com.br', '11cf8b031a97ea6f274101529005a06138fff023ebe3f4f3df7e01766d9dd7a8', '055134bda5ce33bf', 'gerente', '18110275-3f74-4b3c-bbac-a92e976a2cb9', 'R1,R2', true, now()),
('4a09d47a-2c30-4cda-a674-69f898bd4c55', 'Joao Morais', 'joao.morais@pivot.com.br', '6b32b5195af90f35f56b627f7483bc43d53f9a0ab43a3d6810b7f0dd841cb56a', 'ccdc144e9f73dc71', 'gerente', '18110275-3f74-4b3c-bbac-a92e976a2cb9', 'R3', true, now()),
('b3c6283f-0cdb-44bc-8b70-e4e8d6145ccc', 'Itamar Junior', 'itamar.junior@pivot.com.br', '4a064da2e93c06d1765cb1ba5e30b0ec4f7fae0131d88eabf2f80de1604c1154', '06623c34adc92760', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R1', true, now()),
('0688bd57-2741-46bb-b305-bc70b2e1c720', 'Thiago Santos', 'thiago.santos@pivot.com.br', '29ac1cb73cdafea559d5db5235bd9ec8ebacc36493b481d18c85d3e812d58cfc', '8c7c0c9f5292ca8d', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R1', true, now()),
('a0ab90ea-6db3-4af5-9895-6e66fde0caad', 'Iury Correia', 'iury.correia@pivot.com.br', 'af80524435ae1b4ddf384030580829a35e4ec7c67e94a484186a7f6e1f6ae392', '557dcab12674beeb', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R1', true, now()),
('49c38454-9a03-4ed7-b151-0794ee2c99dd', 'Doris Carvalho', 'doris.carvalho@pivot.com.br', 'ce180c8900b9746b31e8b43e448cc237a516feca0328a254ca1c75122318f9ba', 'e06beb243c1537f1', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R1', true, now()),
('d69e3bf3-8bcb-44c3-8bb5-c268c43cd87b', 'Ruitter Souza', 'ruitter.souza@pivot.com.br', '06217647ea39f47be77c46a261458f8bacfcb5201e60ae654c187a4a2bea0d58', '07ad31b9f4a3a0ee', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R1', true, now()),
('e4ab2005-d262-4f8f-b055-7c9d18922ec4', 'Arthur Correia', 'arthur.correia@pivot.com.br', '8ce18476462e3171b115b2c4166ed70115a7de629b87881378d3459bd72e59e4', '9213be8169207f26', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R1', true, now()),
('a094a08b-0fe0-45ea-8dd6-bf02c02781dc', 'Henrique Brandao', 'henrique.brandao@pivot.com.br', 'dd448a0e22b94934bf68fffa7f276a8654ba79b7141e8d6fc43f9835fe9aa88b', '4600d177f2967a42', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R1', true, now()),
('f8c00ace-9cfb-4eb9-ab80-faacfa4bccc2', 'Paulo Mendes', 'paulo.mendes@pivot.com.br', '7839ba21e63b8edf8cf82fa5e0b6193bb9b4634b52ade4591956def45008f6b9', '698aa473e52ff0dc', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R2', true, now()),
('d272cbea-de61-439e-8198-485c42703a9e', 'Luismael', 'luismael@pivot.com.br', '7f2a3325d67e245e0af5fcb363ea3b6f3c4dd535644efd642942ff18367b2ff6', '111cfb762fbaa40b', 'vendedor', '11834622-d144-4319-a69d-2432e757117f', 'R2', true, now()),
('fd3e957f-a6bf-4f9a-b436-0c3dbb975ff1', 'Felipe Dias', 'felipe.dias@pivot.com.br', '8e9196d0b59936e24bf322145c8aaedaeab041dce69a20bc626c214a465124c9', '965e86649fdc5892', 'vendedor', '4a09d47a-2c30-4cda-a674-69f898bd4c55', 'R3', true, now()),
('dfbafc95-8cb3-41d8-bd76-2bbf1fcc55c2', 'Gerson Junior', 'gerson.junior@pivot.com.br', '958936345078507da7fd8628ec6ab399f1009b91cba5801aecb10f09fd1848b5', 'a80733cef08b7825', 'vendedor', '4a09d47a-2c30-4cda-a674-69f898bd4c55', 'R3', true, now()),
('4b622f99-d019-42a5-a391-08a36db7f708', 'Isabella Fraga', 'isabella.fraga@pivot.com.br', 'd2f70b109c93550a5a841d3b6aefc9e00525926ce94cc7f1a19b404eb7711047', 'b23368c20866ddd9', 'vendedor', '4a09d47a-2c30-4cda-a674-69f898bd4c55', 'R3', true, now())
ON CONFLICT (email) DO NOTHING;
