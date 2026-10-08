import express from 'express';
import cors from 'cors';
import multer from 'multer';
import sqlite3 from 'sqlite3';
import { v4 as uuidv4 } from 'uuid';
import moment from 'moment';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Upload de arquivos
const upload = multer({ dest: 'uploads/' });
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Banco de dados
const db = new sqlite3.Database('pivot.db', (err) => {
  if (err) console.error('Erro ao conectar:', err);
  else console.log('✅ Banco de dados conectado');
});

// Criar tabelas
const criarTabelas = () => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id TEXT PRIMARY KEY,
      nome TEXT,
      email TEXT UNIQUE,
      senha TEXT,
      nivel TEXT,
      gerente_id TEXT,
      ativo BOOLEAN DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projetos (
      id TEXT PRIMARY KEY,
      cliente TEXT,
      fazenda TEXT,
      vendedor_id TEXT,
      gerente_id TEXT,
      diretor_id TEXT,
      status TEXT,
      valor REAL,
      desconto REAL,
      margem REAL,
      data_criacao TEXT,
      observacoes TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS arquivos (
      id TEXT PRIMARY KEY,
      projeto_id TEXT,
      nome TEXT,
      versao INTEGER,
      data_upload TEXT,
      tamanho INTEGER,
      caminho TEXT,
      FOREIGN KEY(projeto_id) REFERENCES projetos(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS aprovacoes (
      id TEXT PRIMARY KEY,
      projeto_id TEXT,
      usuario_id TEXT,
      status TEXT,
      comentario TEXT,
      data TEXT,
      FOREIGN KEY(projeto_id) REFERENCES projetos(id)
    )
  `);
};

criarTabelas();

// ==================== AUTENTICAÇÃO ====================

app.post('/api/login', (req, res) => {
  const { email, senha } = req.body;

  db.get(
    'SELECT * FROM usuarios WHERE email = ? AND senha = ? AND ativo = 1',
    [email, senha],
    (err, usuario) => {
      if (err || !usuario) {
        return res.status(401).json({ erro: 'Credenciais inválidas' });
      }

      res.json({
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        nivel: usuario.nivel,
        gerente_id: usuario.gerente_id
      });
    }
  );
});

// ==================== CRIAR USUÁRIOS (SETUP INICIAL) ====================

app.post('/api/usuarios/setup', (req, res) => {
  const usuarios = [
    { id: 'silvio', nome: 'Silvio', email: 'silvio@pivot.com', senha: '123456', nivel: 'diretor', gerente_id: null },
    { id: 'tiago', nome: 'Tiago Lopes', email: 'tiago@pivot.com', senha: '123456', nivel: 'gerente', gerente_id: null },
    { id: 'joao', nome: 'João Batista', email: 'joao@pivot.com', senha: '123456', nivel: 'gerente', gerente_id: null },
    // 8 Vendedores (Tiago)
    { id: 'v1', nome: 'Vendedor 1 (Tiago)', email: 'v1@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'tiago' },
    { id: 'v2', nome: 'Vendedor 2 (Tiago)', email: 'v2@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'tiago' },
    { id: 'v3', nome: 'Vendedor 3 (Tiago)', email: 'v3@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'tiago' },
    { id: 'v4', nome: 'Vendedor 4 (Tiago)', email: 'v4@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'tiago' },
    { id: 'v5', nome: 'Vendedor 5 (Tiago)', email: 'v5@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'tiago' },
    { id: 'v6', nome: 'Vendedor 6 (Tiago)', email: 'v6@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'tiago' },
    { id: 'v7', nome: 'Vendedor 7 (Tiago)', email: 'v7@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'tiago' },
    { id: 'v8', nome: 'Vendedor 8 (Tiago)', email: 'v8@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'tiago' },
    // 4 Vendedores (João)
    { id: 'v9', nome: 'Vendedor 1 (João)', email: 'v9@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'joao' },
    { id: 'v10', nome: 'Vendedor 2 (João)', email: 'v10@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'joao' },
    { id: 'v11', nome: 'Vendedor 3 (João)', email: 'v11@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'joao' },
    { id: 'v12', nome: 'Vendedor 4 (João)', email: 'v12@pivot.com', senha: '123456', nivel: 'vendedor', gerente_id: 'joao' }
  ];

  usuarios.forEach(u => {
    db.run(
      'INSERT OR IGNORE INTO usuarios (id, nome, email, senha, nivel, gerente_id) VALUES (?, ?, ?, ?, ?, ?)',
      [u.id, u.nome, u.email, u.senha, u.nivel, u.gerente_id]
    );
  });

  res.json({ mensagem: 'Usuários criados com sucesso!' });
});

// ==================== PROJETOS ====================

app.post('/api/projetos', (req, res) => {
  const { cliente, fazenda, vendedor_id, gerente_id, observacoes } = req.body;
  const id = uuidv4();
  const data_criacao = moment().format('YYYY-MM-DD HH:mm:ss');

  db.run(
    `INSERT INTO projetos (id, cliente, fazenda, vendedor_id, gerente_id, diretor_id, status, data_criacao, observacoes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, cliente, fazenda, vendedor_id, gerente_id, 'silvio', 'em_negociacao', data_criacao, observacoes],
    (err) => {
      if (err) return res.status(400).json({ erro: err.message });
      res.json({ id, mensagem: 'Projeto criado com sucesso!' });
    }
  );
});

// Listar projetos (com permissões)
app.get('/api/projetos/:usuario_id/:nivel', (req, res) => {
  const { usuario_id, nivel } = req.params;

  let query = 'SELECT * FROM projetos';
  let params = [];

  if (nivel === 'vendedor') {
    query += ' WHERE vendedor_id = ?';
    params.push(usuario_id);
  } else if (nivel === 'gerente') {
    query += ' WHERE gerente_id = ?';
    params.push(usuario_id);
  }
  // Diretor vê TUDO (sem WHERE)

  db.all(query, params, (err, projetos) => {
    if (err) return res.status(400).json({ erro: err.message });
    res.json(projetos || []);
  });
});

// ==================== UPLOAD DE ARQUIVOS ====================

app.post('/api/arquivos/:projeto_id', upload.single('arquivo'), (req, res) => {
  const { projeto_id } = req.params;

  if (!req.file) {
    return res.status(400).json({ erro: 'Nenhum arquivo fornecido' });
  }

  const id = uuidv4();
  const nome = req.file.originalname;
  const caminho = req.file.path;
  const tamanho = req.file.size;
  const data_upload = moment().format('YYYY-MM-DD HH:mm:ss');

  // Obter versão
  db.get(
    'SELECT COUNT(*) as count FROM arquivos WHERE projeto_id = ?',
    [projeto_id],
    (err, row) => {
      const versao = (row?.count || 0) + 1;

      db.run(
        `INSERT INTO arquivos (id, projeto_id, nome, versao, data_upload, tamanho, caminho)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, projeto_id, nome, versao, data_upload, tamanho, caminho],
        (err) => {
          if (err) return res.status(400).json({ erro: err.message });
          res.json({
            id,
            versao,
            nome: `v${versao}_${data_upload.split(' ')[0]}_${nome}`,
            data_upload,
            tamanho
          });
        }
      );
    }
  );
});

// Listar arquivos de um projeto
app.get('/api/arquivos/:projeto_id', (req, res) => {
  const { projeto_id } = req.params;

  db.all(
    'SELECT * FROM arquivos WHERE projeto_id = ? ORDER BY versao DESC',
    [projeto_id],
    (err, arquivos) => {
      if (err) return res.status(400).json({ erro: err.message });
      res.json(arquivos || []);
    }
  );
});

// ==================== APROVAÇÕES ====================

app.post('/api/aprovacoes', (req, res) => {
  const { projeto_id, usuario_id, status, comentario } = req.body;
  const id = uuidv4();
  const data = moment().format('YYYY-MM-DD HH:mm:ss');

  db.run(
    `INSERT INTO aprovacoes (id, projeto_id, usuario_id, status, comentario, data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, projeto_id, usuario_id, status, comentario, data],
    (err) => {
      if (err) return res.status(400).json({ erro: err.message });
      res.json({ id, mensagem: 'Aprovação registrada!' });
    }
  );
});

// ==================== DASHBOARD ====================

app.get('/api/dashboard/:usuario_id/:nivel', (req, res) => {
  const { usuario_id, nivel } = req.params;

  let query = 'SELECT * FROM projetos';
  let params = [];

  if (nivel === 'vendedor') {
    query += ' WHERE vendedor_id = ?';
    params.push(usuario_id);
  } else if (nivel === 'gerente') {
    query += ' WHERE gerente_id = ?';
    params.push(usuario_id);
  }

  db.all(query, params, (err, projetos) => {
    if (err) return res.status(400).json({ erro: err.message });

    const total = projetos.length;
    const em_negociacao = projetos.filter(p => p.status === 'em_negociacao').length;
    const aprovados = projetos.filter(p => p.status === 'aprovado').length;
    const valor_total = projetos.reduce((sum, p) => sum + (p.valor || 0), 0);
    const margem_media = projetos.length > 0
      ? (projetos.reduce((sum, p) => sum + (p.margem || 0), 0) / projetos.length).toFixed(2)
      : 0;

    res.json({
      total,
      em_negociacao,
      aprovados,
      valor_total,
      margem_media,
      projetos
    });
  });
});

// ==================== INICIAR SERVIDOR ====================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  console.log(`📊 Acesse: http://localhost:3000`);
});
