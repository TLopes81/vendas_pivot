-- ============================================
-- PIVOT Deal Manager - Estrutura Supabase
-- ============================================

CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('diretor', 'gerente', 'vendedor')),
  gerente_id TEXT REFERENCES usuarios(id),
  regiao TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projetos (
  id TEXT PRIMARY KEY,
  cliente TEXT NOT NULL,
  fazenda TEXT NOT NULL,
  vendedor_id TEXT NOT NULL REFERENCES usuarios(id),
  gerente_id TEXT NOT NULL REFERENCES usuarios(id),
  diretor_id TEXT NOT NULL REFERENCES usuarios(id),
  status TEXT DEFAULT 'em_negociacao' CHECK (status IN ('em_negociacao', 'aprovado', 'perdido', 'suspenso')),
  valor NUMERIC(15,2),
  desconto NUMERIC(5,2),
  margem NUMERIC(5,2),
  regiao TEXT,
  data_criacao TIMESTAMP DEFAULT NOW(),
  observacoes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS arquivos (
  id TEXT PRIMARY KEY,
  projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  versao INTEGER NOT NULL,
  data_upload TIMESTAMP DEFAULT NOW(),
  tamanho INTEGER,
  url TEXT,
  caminho TEXT,
  uploaded_by TEXT REFERENCES usuarios(id)
);

CREATE TABLE IF NOT EXISTS aprovacoes (
  id TEXT PRIMARY KEY,
  projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  status TEXT NOT NULL CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  comentario TEXT,
  data_criacao TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notificacoes (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  projeto_id TEXT REFERENCES projetos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  mensagem TEXT,
  lido BOOLEAN DEFAULT false,
  data_criacao TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_gerente ON usuarios(gerente_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_regiao ON usuarios(regiao);
CREATE INDEX IF NOT EXISTS idx_projetos_vendedor ON projetos(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_projetos_gerente ON projetos(gerente_id);
CREATE INDEX IF NOT EXISTS idx_projetos_regiao ON projetos(regiao);
CREATE INDEX IF NOT EXISTS idx_projetos_status ON projetos(status);
CREATE INDEX IF NOT EXISTS idx_arquivos_projeto ON arquivos(projeto_id);
CREATE INDEX IF NOT EXISTS idx_aprovacoes_projeto ON aprovacoes(projeto_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id);

-- DIRETOR
INSERT INTO usuarios (id, nome, email, senha, nivel, regiao, ativo) VALUES
('silvio', 'Silvio', 'silvio@pivot.com', '123456', 'diretor', 'National', true);

-- GERENTES
INSERT INTO usuarios (id, nome, email, senha, nivel, regiao, ativo) VALUES
('tiago', 'Tiago Lopes', 'tiago@pivot.com', '123456', 'gerente', 'R1/R2', true),
('joao', 'João Morais', 'joao@pivot.com', '123456', 'gerente', 'R3', true);

-- VENDEDORES R1 (Tiago Lopes)
INSERT INTO usuarios (id, nome, email, senha, nivel, gerente_id, regiao, ativo) VALUES
('thiago_h', 'Thiago Henrique', 'thiago.henrique@pivot.com', '123456', 'vendedor', 'tiago', 'R1', true),
('itamar', 'Itamar', 'itamar@pivot.com', '123456', 'vendedor', 'tiago', 'R1', true),
('iury', 'Iury Hudson', 'iury@pivot.com', '123456', 'vendedor', 'tiago', 'R1', true),
('doris', 'Doris', 'doris@pivot.com', '123456', 'vendedor', 'tiago', 'R1', true),
('arthur', 'Arthur', 'arthur@pivot.com', '123456', 'vendedor', 'tiago', 'R1', true),
('henrique', 'Henrique', 'henrique@pivot.com', '123456', 'vendedor', 'tiago', 'R1', true),
('ruitte', 'Ruitte', 'ruitte@pivot.com', '123456', 'vendedor', 'tiago', 'R1', true);

-- VENDEDORES R2 (Tiago Lopes)
INSERT INTO usuarios (id, nome, email, senha, nivel, gerente_id, regiao, ativo) VALUES
('paulo', 'Paulo', 'paulo@pivot.com', '123456', 'vendedor', 'tiago', 'R2', true),
('luismael', 'Luismael', 'luismael@pivot.com', '123456', 'vendedor', 'tiago', 'R2', true);

-- VENDEDORES R3 (João Morais)
INSERT INTO usuarios (id, nome, email, senha, nivel, gerente_id, regiao, ativo) VALUES
('gerson', 'Gerson', 'gerson@pivot.com', '123456', 'vendedor', 'joao', 'R3', true),
('isabella', 'Isabella', 'isabella@pivot.com', '123456', 'vendedor', 'joao', 'R3', true),
('felipe', 'Felipe', 'felipe@pivot.com', '123456', 'vendedor', 'joao', 'R3', true),
('tocantins', 'Tocantins', 'tocantins@pivot.com', '123456', 'vendedor', 'joao', 'R3', true);

ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE projetos ENABLE ROW LEVEL SECURITY;
ALTER TABLE arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprovacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

COMMIT;
