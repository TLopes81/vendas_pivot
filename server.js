/**
 * PIVOT Deal Manager WEB - API
 * Node.js + Express + Supabase (Postgres + Storage)
 * Hierarquia: diretor > gerente > vendedor
 *
 * Roda tanto localmente (npm start -> app.listen) quanto como
 * Vercel Serverless Function (api/index.js importa e exporta `app`).
 */
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'troque-isso';
const BUCKET = 'arquivos';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
);

const app = express();
app.use(cors());
app.use(express.json());

function hash(senha, salt) {
  return crypto.createHash('sha256').update(String(salt) + String(senha)).digest('hex');
}

function signToken(usuario) {
  return jwt.sign({ id: usuario.id, nome: usuario.nome, email: usuario.email, nivel: usuario.nivel }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.indexOf('Bearer ') === 0 ? h.slice(7) : null;
  if (!token) return res.status(401).json({ erro: 'Nao autenticado' });
  try {
    req.usuario = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ erro: 'Token invalido ou expirado' });
  }
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
  const { data, error } = await supabase.from('usuarios').select('id').eq('superior_id', gerenteId);
  if (error) throw error;
  return [gerenteId].concat((data || []).map(function (v) { return v.id; }));
}

function must(result) {
  if (result.error) throw result.error;
  return result.data;
}

// ---------- LOGIN ----------
app.post('/login', async (req, res) => {
  try {
    const body = req.body || {};
    const email = body.email;
    const senha = body.senha;
    if (!email || !senha) return res.status(400).json({ erro: 'Informe email e senha' });

    const { data: u, error } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', String(email).toLowerCase().trim())
      .eq('ativo', true)
      .maybeSingle();

    if (error) throw error;
    if (!u) return res.status(401).json({ erro: 'Email ou senha invalidos' });
    if (hash(senha, u.salt) !== u.senha_hash) return res.status(401).json({ erro: 'Email ou senha invalidos' });

    const usuario = { id: u.id, nome: u.nome, email: u.email, nivel: u.nivel };
    const token = signToken(usuario);
    res.json({ token: token, usuario: usuario });
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.post('/logout', auth, (req, res) => {
  res.json({ ok: true });
});

app.get('/me', auth, (req, res) => res.json({ usuario: req.usuario }));

// ---------- USUARIOS ----------
app.get('/usuarios', auth, async (req, res) => {
  try {
    const cols = 'id,nome,email,nivel,superior_id,ativo';
    if (req.usuario.nivel === 'diretor') {
      const rows = must(await supabase.from('usuarios').select(cols).order('nivel').order('nome'));
      return res.json(rows);
    }
    if (req.usuario.nivel === 'gerente') {
      const ids = await idsDaEquipe(req.usuario.id);
      const rows = must(await supabase.from('usuarios').select(cols).in('id', ids).order('nivel').order('nome'));
      return res.json(rows);
    }
    res.status(403).json({ erro: 'Sem permissao' });
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// ---------- PROJETOS ----------
async function anexarVendedorNome(rows) {
  const ids = Array.from(new Set(rows.map(function (r) { return r.vendedor_id; }).filter(Boolean)));
  if (ids.length === 0) return rows.map(function (r) { return Object.assign({}, r, { vendedor_nome: null }); });
  const usuarios = must(await supabase.from('usuarios').select('id,nome').in('id', ids));
  const nomeMap = {};
  usuarios.forEach(function (u) { nomeMap[u.id] = u.nome; });
  return rows.map(function (r) { return Object.assign({}, r, { vendedor_nome: nomeMap[r.vendedor_id] || null }); });
}

app.get('/projetos', auth, async (req, res) => {
  try {
    let rows;
    if (req.usuario.nivel === 'diretor') {
      rows = must(await supabase.from('projetos').select('*').order('created_at', { ascending: false }));
    } else if (req.usuario.nivel === 'gerente') {
      const ids = await idsDaEquipe(req.usuario.id);
      rows = must(await supabase.from('projetos').select('*').in('vendedor_id', ids).order('created_at', { ascending: false }));
    } else {
      rows = must(await supabase.from('projetos').select('*').eq('vendedor_id', req.usuario.id).order('created_at', { ascending: false }));
    }
    res.json(await anexarVendedorNome(rows));
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.post('/projetos', auth, exigirNivel('vendedor', 'gerente', 'diretor'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.cliente) return res.status(400).json({ erro: 'Informe o cliente' });
    const valor = Number(b.valor) || 0;
    const custo = Number(b.custo) || 0;
    const row = must(await supabase.from('projetos').insert({
      cliente: b.cliente,
      descricao: b.descricao || '',
      valor: valor,
      custo: custo,
      status: 'em_negociacao',
      vendedor_id: req.usuario.id
    }).select().single());
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.put('/projetos/:id', auth, async (req, res) => {
  try {
    const p = must(await supabase.from('projetos').select('*').eq('id', req.params.id).maybeSingle());
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
      status: b.status !== undefined ? b.status : p.status,
      updated_at: new Date().toISOString()
    };
    if (['em_negociacao', 'aprovado', 'reprovado'].indexOf(novo.status) === -1) return res.status(400).json({ erro: 'Status invalido' });
    const row = must(await supabase.from('projetos').update(novo).eq('id', p.id).select().single());
    res.json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.delete('/projetos/:id', auth, exigirNivel('diretor'), async (req, res) => {
  try {
    await supabase.from('arquivos').delete().eq('projeto_id', req.params.id);
    await supabase.from('aprovacoes').delete().eq('projeto_id', req.params.id);
    await supabase.from('projetos').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// ---------- ARQUIVOS (Supabase Storage) ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.post('/arquivos', auth, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    const projetoId = req.body.projeto_id;
    const p = must(await supabase.from('projetos').select('id').eq('id', projetoId).maybeSingle());
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });

    const caminhoStorage = projetoId + '/' + Date.now() + '-' + req.file.originalname;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(caminhoStorage, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true
    });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(caminhoStorage);

    const row = must(await supabase.from('arquivos').insert({
      projeto_id: projetoId,
      nome: req.file.originalname,
      caminho: pub.publicUrl,
      tamanho: req.file.size,
      mimetype: req.file.mimetype,
      enviado_por: req.usuario.id
    }).select().single());
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.get('/arquivos', auth, async (req, res) => {
  try {
    let q = supabase.from('arquivos').select('id,projeto_id,nome,caminho,tamanho,mimetype,created_at');
    if (req.query.projeto_id) q = q.eq('projeto_id', req.query.projeto_id);
    const rows = must(await q.order('created_at', { ascending: false }));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// ---------- APROVACOES ----------
app.post('/aprovacoes', auth, exigirNivel('gerente', 'diretor'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.projeto_id || ['aprovado', 'reprovado'].indexOf(b.decisao) === -1) {
      return res.status(400).json({ erro: 'Informe projeto_id e decisao (aprovado|reprovado)' });
    }
    const p = must(await supabase.from('projetos').select('*').eq('id', b.projeto_id).maybeSingle());
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });
    if (req.usuario.nivel === 'gerente' && (await idsDaEquipe(req.usuario.id)).indexOf(p.vendedor_id) === -1) {
      return res.status(403).json({ erro: 'Projeto fora da sua equipe' });
    }
    const row = must(await supabase.from('aprovacoes').insert({
      projeto_id: b.projeto_id,
      aprovador_id: req.usuario.id,
      decisao: b.decisao,
      comentario: b.comentario || ''
    }).select().single());
    await supabase.from('projetos').update({ status: b.decisao, updated_at: new Date().toISOString() }).eq('id', b.projeto_id);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.get('/aprovacoes', auth, async (req, res) => {
  try {
    const rows = must(await supabase.from('aprovacoes').select('*').order('created_at', { ascending: false }));
    const ids = Array.from(new Set(rows.map(function (r) { return r.aprovador_id; }).filter(Boolean)));
    let nomeMap = {};
    if (ids.length) {
      const usuarios = must(await supabase.from('usuarios').select('id,nome').in('id', ids));
      usuarios.forEach(function (u) { nomeMap[u.id] = u.nome; });
    }
    res.json(rows.map(function (r) { return Object.assign({}, r, { aprovador_nome: nomeMap[r.aprovador_id] || null }); }));
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// ---------- DASHBOARD ----------
app.get('/dashboard', auth, async (req, res) => {
  try {
    let projetos;
    if (req.usuario.nivel === 'diretor') {
      projetos = must(await supabase.from('projetos').select('*'));
    } else if (req.usuario.nivel === 'gerente') {
      const ids = await idsDaEquipe(req.usuario.id);
      projetos = must(await supabase.from('projetos').select('*').in('vendedor_id', ids));
    } else {
      projetos = must(await supabase.from('projetos').select('*').eq('vendedor_id', req.usuario.id));
    }
    const total = projetos.length;
    const emNegociacao = projetos.filter(function (p) { return p.status === 'em_negociacao'; }).length;
    const aprovados = projetos.filter(function (p) { return p.status === 'aprovado'; }).length;
    const valorTotal = projetos.reduce(function (s, p) { return s + (Number(p.valor) || 0); }, 0);
    const comValor = projetos.filter(function (p) { return Number(p.valor) > 0; });
    const margemMedia = comValor.length
      ? comValor.reduce(function (s, p) { return s + ((Number(p.valor) - Number(p.custo)) / Number(p.valor)) * 100; }, 0) / comValor.length
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
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.get('/health', (req, res) => res.json({ status: 'OK' }));

app.use(express.static(__dirname));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('PIVOT Deal Manager WEB rodando em http://localhost:' + PORT);
    console.log('Login inicial: silvio@pivot.com / 123456');
  });
}

module.exports = app;
