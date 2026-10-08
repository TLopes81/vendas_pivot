-- ============================================
-- PIVOT Deal Manager - Estrutura Supabase
-- ============================================

-- Tabela: usuarios
CREATE TABLE IF NOT EXISTS usuarios (
  id TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  senha TEXT NOT NULL,
  nivel TEXT NOT NULL CHECK (nivel IN ('diretor', 'gerente', 'vendedor')),
  gerente_id TEXT REFERENCES usuarios(id),
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela: projetos
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
  data_criacao TIMESTAMP DEFAULT NOW(),
  observacoes TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tabela: arquivos
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

-- Tabela: aprovacoes
CREATE TABLE IF NOT EXISTS aprovacoes (
  id TEXT PRIMARY KEY,
  projeto_id TEXT NOT NULL REFERENCES projetos(id) ON DELETE CASCADE,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id),
  status TEXT NOT NULL CHECK (status IN ('pendente', 'aprovado', 'rejeitado')),
  comentario TEXT,
  data_criacao TIMESTAMP DEFAULT NOW()
);

-- Tabela: notificacoes
CREATE TABLE IF NOT EXISTS notificacoes (
  id TEXT PRIMARY KEY,
  usuario_id TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  projeto_id TEXT REFERENCES projetos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  mensagem TEXT,
  lido BOOLEAN DEFAULT false,
  data_criacao TIMESTAMP DEFAULT NOW()
);

-- ============================================
-- ÍNDICES PARA PERFORMANCE
-- ============================================

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_gerente ON usuarios(gerente_id);
CREATE INDEX IF NOT EXISTS idx_projetos_vendedor ON projetos(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_projetos_gerente ON projetos(gerente_id);
CREATE INDEX IF NOT EXISTS idx_projetos_status ON projetos(status);
CREATE INDEX IF NOT EXISTS idx_arquivos_projeto ON arquivos(projeto_id);
CREATE INDEX IF NOT EXISTS idx_aprovacoes_projeto ON aprovacoes(projeto_id);
CREATE INDEX IF NOT EXISTS idx_notificacoes_usuario ON notificacoes(usuario_id);

-- ============================================
-- INSERIR DADOS INICIAIS (13 usuários)
-- ============================================

-- Diretor
INSERT INTO usuarios (id, nome, email, senha, nivel, ativo) VALUES
('silvio', 'Silvio', 'silvio@pivot.com', '123456', 'diretor', true);

-- Gerentes
INSERT INTO usuarios (id, nome, email, senha, nivel, ativo) VALUES
('tiago', 'Tiago Lopes', 'tiago@pivot.com', '123456', 'gerente', true),
('joao', 'João Batista', 'joao@pivot.com', '123456', 'gerente', true);

-- Vendedores (Tiago - 8 vendedores)
INSERT INTO usuarios (id, nome, email, senha, nivel, gerente_id, ativo) VALUES
('v1', 'Vendedor 1 (Tiago)', 'v1@pivot.com', '123456', 'vendedor', 'tiago', true),
('v2', 'Vendedor 2 (Tiago)', 'v2@pivot.com', '123456', 'vendedor', 'tiago', true),
('v3', 'Vendedor 3 (Tiago)', 'v3@pivot.com', '123456', 'vendedor', 'tiago', true),
('v4', 'Vendedor 4 (Tiago)', 'v4@pivot.com', '123456', 'vendedor', 'tiago', true),
('v5', 'Vendedor 5 (Tiago)', 'v5@pivot.com', '123456', 'vendedor', 'tiago', true),
('v6', 'Vendedor 6 (Tiago)', 'v6@pivot.com', '123456', 'vendedor', 'tiago', true),
('v7', 'Vendedor 7 (Tiago)', 'v7@pivot.com', '123456', 'vendedor', 'tiago', true),
('v8', 'Vendedor 8 (Tiago)', 'v8@pivot.com', '123456', 'vendedor', 'tiago', true);

-- Vendedores (João - 4 vendedores)
INSERT INTO usuarios (id, nome, email, senha, nivel, gerente_id, ativo) VALUES
('v9', 'Vendedor 1 (João)', 'v9@pivot.com', '123456', 'vendedor', 'joao', true),
('v10', 'Vendedor 2 (João)', 'v10@pivot.com', '123456', 'vendedor', 'joao', true),
('v11', 'Vendedor 3 (João)', 'v11@pivot.com', '123456', 'vendedor', 'joao', true),
('v12', 'Vendedor 4 (João)', 'v12@pivot.com', '123456', 'vendedor', 'joao', true);

-- ============================================
-- POLÍTICAS DE SEGURANÇA (Row Level Security)
-- ============================================

-- Ativar RLS nas tabelas
ALTER TABLE usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE projetos ENABLE ROW LEVEL SECURITY;
ALTER TABLE arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE aprovacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

-- Política: Diretor vê tudo
CREATE POLICY diretor_all ON usuarios FOR SELECT USING (
  EXISTS (SELECT 1 FROM usuarios WHERE id = auth.uid() AND nivel = 'diretor')
);

-- Política: Gerente vê seus vendedores
CREATE POLICY gerente_vendedores ON usuarios FOR SELECT USING (
  nivel = 'gerente' OR gerente_id = auth.uid() OR id = auth.uid()
);

-- Política: Vendedor vê apenas a si mesmo
CREATE POLICY vendedor_self ON usuarios FOR SELECT USING (
  id = auth.uid()
);

-- ============================================
-- FIM
-- ============================================

COMMIT;
