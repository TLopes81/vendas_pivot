/**
 * PIVOT Deal Manager WEB - API
 * Node.js + Express + SQLite
 * Hierarquia: diretor > gerente > vendedor
 */
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { v4: uuid } = require('uuid');
const moment = require('moment');

const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'pivot.db');
const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(UPLOAD_DIR));

const db = new sqlite3.Database(DB_FILE);
const sessions = new Map(); // token -> usuario

function hash(senha, salt) {
  return crypto.createHash('sha256').update(String(salt) + String(senha)).digest('hex');
}
function run(sql, params) {
  return new Promise((resolve, reject) => {
    db.run(sql, params || [], function (err) { err ? reject(err) : resolve(this); });
  });
}
function all(sql, params) {
  return new Promise((resolve, reject) => {
    db.all(sql, params || [], (err, rows) => { err ? reject(err) : resolve(rows); });
  });
}
function one(sql, params) {
  return new Promise((resolve, reject) => {
    db.get(sql, params || [], (err, row) => { err ? reject(err) : resolve(row); });
  });
}

const SEED = [
  { nome: 'Silvio Pivot',      email: 'silvio@pivot.com',      nivel: 'diretor',  superior: null },
  { nome: 'Marta Alves',       email: 'marta@pivot.com',       nivel: 'gerente',  superior: 'silvio@pivot.com' },
  { nome: 'Roberto Lima',      email: 'roberto@pivot.com',     nivel: 'gerente',  superior: 'silvio@pivot.com' },
  { nome: 'Ana Souza',         email: 'ana@pivot.com',         nivel: 'vendedor', superior: 'marta@pivot.com' },
  { nome: 'Bruno Dias',        email: 'bruno@pivot.com',       nivel: 'vendedor', superior: 'marta@pivot.com' },
  { nome: 'Carla Mendes',      email: 'carla@pivot.com',       nivel: 'vendedor', superior: 'marta@pivot.com' },
  { nome: 'Diego Rocha',       email: 'diego@pivot.com',       nivel: 'vendedor', superior: 'marta@pivot.com' },
  { nome: 'Elisa Prado',       email: 'elisa@pivot.com',       nivel: 'vendedor', superior: 'marta@pivot.com' },
  { nome: 'Fabio Nunes',       email: 'fabio@pivot.com',       nivel: 'vendedor', superior: 'roberto@pivot.com' },
  { nome: 'Gisele Barros',     email: 'gisele@pivot.com',      nivel: 'vendedor', superior: 'roberto@pivot.com' },
  { nome: 'Heitor Campos',     email: 'heitor@pivot.com',      nivel: 'vendedor', superior: 'roberto@pivot.com' },
  { nome: 'Iris Tavares',      email: 'iris@pivot.com',        nivel: 'vendedor', superior: 'roberto@pivot.com' },
  { nome: 'Joao Peixoto',      email: 'joao@pivot.com',        nivel: 'vendedor', superior: 'roberto@pivot.com' }
];

async function createTables() {
  await run('CREATE TABLE IF NOT EXISTS usuarios (id TEXT PRIMARY KEY, nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT NOT NULL, salt TEXT NOT NULL, nivel TEXT NOT NULL, superior_id TEXT, ativo INTEGER DEFAULT 1, created_at TEXT)');
  await run('CREATE TABLE IF NOT EXISTS projetos (id TEXT PRIMARY KEY, cliente TEXT NOT NULL, descricao TEXT, valor REAL DEFAULT 0, custo REAL DEFAULT 0, status TEXT DEFAULT "em_negociacao", vendedor_id TEXT, gerente_id TEXT, created_at TEXT, updated_at TEXT)');
  await run('CREATE TABLE IF NOT EXISTS arquivos (id TEXT PRIMARY KEY, projeto_id TEXT, nome TEXT, caminho TEXT, tamanho INTEGER, mimetype TEXT, enviado_por TEXT, created_at TEXT)');
  await run('CREATE TABLE IF NOT EXISTS aprovacoes (id TEXT PRIMARY KEY, projeto_id TEXT, aprovador_id TEXT, decisao TEXT, comentario TEXT, created_at TEXT)');
}

async function seedUsuarios() {
  const total = await one('SELECT COUNT(*) AS n FROM usuarios');
  if (total.n > 0) return { seeded: false, usuarios: total.n };
  const idPorEmail = {};
  for (const u of SEED) {
    const id = uuid();
    const salt = crypto.randomBytes(8).toString('hex');
    idPorEmail[u.email] = id;
  }
  for (const u of SEED) {
    const salt = crypto.randomBytes(8).toString('hex');
    const superiorId = u.superior ? idPorEmail[u.superior] : null;
    await run('INSERT INTO usuarios (id,nome,email,senha_hash,salt,nivel,superior_id,ativo,created_at) VALUES (?,?,?,?,?,?,?,1,?)',
      [idPorEmail[u.email], u.nome, u.email, hash('123456', salt), salt, u.nivel, superiorId, moment().toISOString()]);
  }
  return { seeded: true, usuarios: SEED.length };
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.indexOf('Bearer ') === 0 ? h.slice(7) : null;
  const usuario = token ? sessions.get(token) : null;
  if (!usuario) return res.status(401).json({ erro: 'Nao autenticado' });
  req.usuario = usuario;
  next();
}
function exigirNivel() {
  const permitidos = Array.prototype.slice.call(arguments);
  return function (req, res, next) {
    if (permitidos.indexOf(req.usuario.nivel) === -1) {
      return res.status(403).json({ erro: 'Sem permissao para esta acao' });
    }
    next();
  };
}
async function idsDaEquipe(gerenteId) {
  const vendedores = await all('SELECT id FROM usuarios WHERE superior_id = ?', [gerenteId]);
  return [gerenteId].concat(vendedores.map(v => v.id));
}

// ---------- LOGIN ----------
app.post('/login', async (req, res) => {
  try {
    const { email, senha } = req.body || {};
    if (!email || !senha) return res.status(400).json({ erro: 'Informe email e senha' });
    const u = await one('SELECT * FROM usuarios WHERE email = ? AND ativo = 1', [String(email).toLowerCase().trim()]);
    if (!u) return res.status(401).json({ erro: 'Email ou senha invalidos' });
    if (hash(senha, u.salt) !== u.senha_hash) return res.status(401).json({ erro: 'Email ou senha invalidos' });
    const token = uuid();
    const usuario = { id: u.id, nome: u.nome, email: u.email, nivel: u.nivel };
    sessions.set(token, usuario);
    res.json({ token: token, usuario: usuario });
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});

app.post('/logout', auth, (req, res) => {
  const h = req.headers.authorization || '';
  sessions.delete(h.slice(7));
  res.json({ ok: true });
});

app.get('/me', auth, (req, res) => res.json({ usuario: req.usuario }));

// ---------- USUARIOS ----------
app.post('/usuarios/setup', async (req, res) => {
  try { await createTables(); const r = await seedUsuarios(); res.json(r); }
  catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});
app.get('/usuarios/setup', async (req, res) => {
  try { await createTables(); const r = await seedUsuarios(); res.json(r); }
  catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});
app.get('/usuarios', auth, async (req, res) => {
  const cols = 'id,nome,email,nivel,superior_id,ativo';
  if (req.usuario.nivel === 'diretor') return res.json(await all('SELECT ' + cols + ' FROM usuarios ORDER BY nivel,nome'));
  if (req.usuario.nivel === 'gerente') {
    const ids = await idsDaEquipe(req.usuario.id);
    const marcas = ids.map(() => '?').join(',');
    return res.json(await all('SELECT ' + cols + ' FROM usuarios WHERE id IN (' + marcas + ') ORDER BY nivel,nome', ids));
  }
  res.status(403).json({ erro: 'Sem permissao' });
});

// ---------- PROJETOS ----------
app.get('/projetos', auth, async (req, res) => {
  try {
    let rows;
    if (req.usuario.nivel === 'diretor') {
      rows = await all('SELECT p.*, u.nome AS vendedor_nome FROM projetos p LEFT JOIN usuarios u ON u.id = p.vendedor_id ORDER BY p.created_at DESC');
    } else if (req.usuario.nivel === 'gerente') {
      const ids = await idsDaEquipe(req.usuario.id);
      const marcas = ids.map(() => '?').join(',');
      rows = await all('SELECT p.*, u.nome AS vendedor_nome FROM projetos p LEFT JOIN usuarios u ON u.id = p.vendedor_id WHERE p.vendedor_id IN (' + marcas + ') ORDER BY p.created_at DESC', ids);
    } else {
      rows = await all('SELECT p.*, u.nome AS vendedor_nome FROM projetos p LEFT JOIN usuarios u ON u.id = p.vendedor_id WHERE p.vendedor_id = ? ORDER BY p.created_at DESC', [req.usuario.id]);
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});

app.post('/projetos', auth, exigirNivel('vendedor', 'gerente', 'diretor'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.cliente) return res.status(400).json({ erro: 'Informe o cliente' });
    const id = uuid();
    const agora = moment().toISOString();
    const valor = Number(b.valor) || 0;
    const custo = Number(b.custo) || 0;
    await run('INSERT INTO projetos (id,cliente,descricao,valor,custo,status,vendedor_id,gerente_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [id, b.cliente, b.descricao || '', valor, custo, 'em_negociacao', req.usuario.id, null, agora, agora]);
    res.status(201).json(await one('SELECT * FROM projetos WHERE id = ?', [id]));
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});

app.put('/projetos/:id', auth, async (req, res) => {
  try {
    const p = await one('SELECT * FROM projetos WHERE id = ?', [req.params.id]);
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });
    const dono = p.vendedor_id === req.usuario.id;
    const gerente = req.usuario.nivel === 'gerente' && (await idsDaEquipe(req.usuario.id)).indexOf(p.vendedor_id) !== -1;
    const diretor = req.usuario.nivel === 'diretor';
    if (!dono && !gerente && !diretor) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    const b = req.body || {};
    const novo = {
      cliente: b.cliente !== undefined ? b.cliente : p.cliente,
      descricao: b.descricao !== undefined ? b.descricao : p.descricao,
      valor: b.valor !== undefined ? Number(b.valor) : p.valor,
      custo: b.custo !== undefined ? Number(b.custo) : p.custo,
      status: b.status !== undefined ? b.status : p.status
    };
    if (['em_negociacao', 'aprovado', 'reprovado'].indexOf(novo.status) === -1) return res.status(400).json({ erro: 'Status invalido' });
    await run('UPDATE projetos SET cliente=?,descricao=?,valor=?,custo=?,status=?,updated_at=? WHERE id=?',
      [novo.cliente, novo.descricao, novo.valor, novo.custo, novo.status, moment().toISOString(), p.id]);
    res.json(await one('SELECT * FROM projetos WHERE id = ?', [p.id]));
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});

app.delete('/projetos/:id', auth, exigirNivel('diretor'), async (req, res) => {
  try {
    await run('DELETE FROM arquivos WHERE projeto_id = ?', [req.params.id]);
    await run('DELETE FROM aprovacoes WHERE projeto_id = ?', [req.params.id]);
    await run('DELETE FROM projetos WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});

// ---------- ARQUIVOS ----------
const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 20 * 1024 * 1024 } });
app.post('/arquivos', auth, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    const projetoId = req.body.projeto_id;
    const p = await one('SELECT * FROM projetos WHERE id = ?', [projetoId]);
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });
    const id = uuid();
    await run('INSERT INTO arquivos (id,projeto_id,nome,caminho,tamanho,mimetype,enviado_por,created_at) VALUES (?,?,?,?,?,?,?,?)',
      [id, projetoId, req.file.originalname, req.file.path, req.file.size, req.file.mimetype, req.usuario.id, moment().toISOString()]);
    res.status(201).json(await one('SELECT * FROM arquivos WHERE id = ?', [id]));
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});
app.get('/arquivos', auth, async (req, res) => {
  try {
    if (req.query.projeto_id) return res.json(await all('SELECT id,projeto_id,nome,tamanho,mimetype,created_at FROM arquivos WHERE projeto_id = ?', [req.query.projeto_id]));
    res.json(await all('SELECT id,projeto_id,nome,tamanho,mimetype,created_at FROM arquivos ORDER BY created_at DESC'));
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});

// ---------- APROVACOES ----------
app.post('/aprovacoes', auth, exigirNivel('gerente', 'diretor'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.projeto_id || ['aprovado', 'reprovado'].indexOf(b.decisao) === -1) {
      return res.status(400).json({ erro: 'Informe projeto_id e decisao (aprovado|reprovado)' });
    }
    const p = await one('SELECT * FROM projetos WHERE id = ?', [b.projeto_id]);
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });
    if (req.usuario.nivel === 'gerente' && (await idsDaEquipe(req.usuario.id)).indexOf(p.vendedor_id) === -1) {
      return res.status(403).json({ erro: 'Projeto fora da sua equipe' });
    }
    const id = uuid();
    await run('INSERT INTO aprovacoes (id,projeto_id,aprovador_id,decisao,comentario,created_at) VALUES (?,?,?,?,?,?)',
      [id, b.projeto_id, req.usuario.id, b.decisao, b.comentario || '', moment().toISOString()]);
    await run('UPDATE projetos SET status=?, updated_at=? WHERE id=?', [b.decisao, moment().toISOString(), b.projeto_id]);
    res.status(201).json(await one('SELECT * FROM aprovacoes WHERE id = ?', [id]));
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});
app.get('/aprovacoes', auth, async (req, res) => {
  try {
    res.json(await all('SELECT a.*, u.nome AS aprovador_nome FROM aprovacoes a LEFT JOIN usuarios u ON u.id = a.aprovador_id ORDER BY a.created_at DESC'));
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});

// ---------- DASHBOARD ----------
app.get('/dashboard', auth, async (req, res) => {
  try {
    let projetos;
    if (req.usuario.nivel === 'diretor') {
      projetos = await all('SELECT * FROM projetos');
    } else if (req.usuario.nivel === 'gerente') {
      const ids = await idsDaEquipe(req.usuario.id);
      const marcas = ids.map(() => '?').join(',');
      projetos = await all('SELECT * FROM projetos WHERE vendedor_id IN (' + marcas + ')', ids);
    } else {
      projetos = await all('SELECT * FROM projetos WHERE vendedor_id = ?', [req.usuario.id]);
    }
    const total = projetos.length;
    const emNegociacao = projetos.filter(p => p.status === 'em_negociacao').length;
    const aprovados = projetos.filter(p => p.status === 'aprovado').length;
    const valorTotal = projetos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
    const comValor = projetos.filter(p => Number(p.valor) > 0);
    const margemMedia = comValor.length
      ? comValor.reduce((s, p) => s + ((Number(p.valor) - Number(p.custo)) / Number(p.valor)) * 100, 0) / comValor.length
      : 0;
    res.json({
      kpis: {
        total: total,
        em_negociacao: emNegociacao,
        aprovados: aprovados,
        valor_total: valorTotal,
        margem_media: Number(margemMedia.toFixed(2))
      },
      nivel: req.usuario.nivel,
      escopo: req.usuario.nivel === 'diretor' ? 'todos os projetos' : (req.usuario.nivel === 'gerente' ? 'sua equipe' : 'seus projetos')
    });
  } catch (e) { res.status(500).json({ erro: String(e.message || e) }); }
});

createTables().then(async () => {
  const r = await seedUsuarios();
  app.listen(PORT, () => {
    console.log('PIVOT Deal Manager WEB rodando em http://localhost:' + PORT);
    console.log('Banco: ' + DB_FILE + ' | usuarios: ' + (r.seeded ? r.usuarios + ' criados agora' : r.usuarios + ' ja existentes'));
    console.log('Login inicial: silvio@pivot.com / 123456');
  });
}).catch(err => { console.error('Falha ao iniciar:', err); process.exit(1); });
