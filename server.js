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

// Confere se o usuario logado pode ver/editar o projeto (mesma regra de
// visibilidade usada nas listas): diretor ve tudo; gerente ve a propria
// equipe (idsDaEquipe); vendedor so o que e dele. Usado em todo endpoint
// que recebe um projeto_id/pivo_id direto (sem isso, dava pra contornar o
// filtro das listas so trocando o id na requisicao).
async function possoAcessarProjeto(usuario, projetoId) {
  if (!projetoId) return false;
  const p = must(await supabase.from('projetos').select('vendedor_id').eq('id', projetoId).maybeSingle());
  if (!p) return false;
  if (usuario.nivel === 'diretor') return true;
  if (usuario.nivel === 'gerente') {
    const ids = await idsDaEquipe(usuario.id);
    return ids.indexOf(p.vendedor_id) !== -1;
  }
  return p.vendedor_id === usuario.id;
}

function must(result) {
  if (result.error) throw result.error;
  return result.data;
}

// ---------- FORMULA DE RECALCULO (validada contra os 4 pivos reais do cliente Horacio) ----------
// Reproduz exatamente a formula da coluna N ("Valor negociado") da aba "Calculo"
// da Calculadora .xlsm. J,K,H,I,E,F,G vem do pivo; icmsPct/pisPct/descRevendaPct vem
// de config_fiscal/config_global (equivalente a aba "Dados").
function recalcularValorNegociado(p, icmsPct, pisPct, descRevendaPct) {
  var J = Number(p.preco_total) || 0;
  var K = Number(p.preco_parte_aerea) || 0;
  var E = Number(p.encargos_pct) || 0;
  var F = Number(p.desconto_pct) || 0;
  var G = Number(p.taxa_flat_pct) || 0;
  var H = Number(p.montagem) || 0;
  var I = Number(p.servicos_adicionais) || 0;

  if (!J) return { valorNegociado: null, custoPorHectare: null, pctAncillary: null };

  var icmsFactor = (0.82 / ((100 - icmsPct) / 100)) * (100 / 100);
  var term1 = ((J - K) * icmsFactor) / ((100 - E) / 100) * ((100 - descRevendaPct) / 100) / ((100 - G) / 100);
  var term2 = ((H / J * (J - K)) + (I / J * (J - K))) / ((100 - pisPct - icmsPct - G) / 100);
  var term3 = (K * icmsFactor) / ((100 - E) / 100) * ((100 - F) / 100) / ((100 - G) / 100);
  var term4 = ((H / J * K) + (I / J * K)) / ((100 - pisPct - icmsPct - G) / 100);
  var total = term1 + term2 + term3 + term4;
  var valorNegociado = Math.ceil(total / 100) * 100; // ROUNDUP(total/100,0)*100

  var area = Number(p.area_irrigada_ha) || 0;
  var custoPorHectare = area ? valorNegociado / area : null;
  var pctAncillary = J ? (J - K) / J : null;

  return { valorNegociado: valorNegociado, custoPorHectare: custoPorHectare, pctAncillary: pctAncillary };
}

async function getConstantesFiscais(estado) {
  var fiscal = must(await supabase.from('config_fiscal').select('*').eq('estado', estado).maybeSingle());
  var globais = must(await supabase.from('config_global').select('*'));
  var map = {};
  globais.forEach(function (g) { map[g.chave] = Number(g.valor); });
  return {
    icmsPct: fiscal ? Number(fiscal.icms_pct) : 0,
    pisPct: map.pis_pct || 0,
    descRevendaPct: map.desconto_revenda_pct || 0
  };
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

// ---------- CONFIG FISCAL (a "tabela de desconto": ICMS por estado + constantes globais) ----------
app.get('/config/fiscal', auth, async (req, res) => {
  try {
    const estados = must(await supabase.from('config_fiscal').select('*').order('estado'));
    const globais = must(await supabase.from('config_global').select('*').order('chave'));
    res.json({ estados: estados, globais: globais });
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.put('/config/fiscal/:estado', auth, exigirNivel('gerente', 'diretor'), async (req, res) => {
  try {
    const icms = Number((req.body || {}).icms_pct);
    if (isNaN(icms)) return res.status(400).json({ erro: 'Informe icms_pct' });
    const row = must(await supabase.from('config_fiscal')
      .update({ icms_pct: icms, updated_at: new Date().toISOString() })
      .eq('estado', req.params.estado.toUpperCase())
      .select().single());
    res.json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.put('/config/global/:chave', auth, exigirNivel('gerente', 'diretor'), async (req, res) => {
  try {
    const valor = Number((req.body || {}).valor);
    if (isNaN(valor)) return res.status(400).json({ erro: 'Informe valor' });
    const row = must(await supabase.from('config_global')
      .update({ valor: valor, updated_at: new Date().toISOString() })
      .eq('chave', req.params.chave)
      .select().single());
    res.json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Quem o usuario logado pode escolher como destinatario ao enviar um arquivo:
// vendedor -> seu gerente + o diretor; gerente -> o diretor; diretor -> ninguem.
app.get('/usuarios/destinatarios', auth, async (req, res) => {
  try {
    const ids = [];
    if (req.usuario.nivel === 'vendedor' || req.usuario.nivel === 'gerente') {
      const eu = must(await supabase.from('usuarios').select('superior_id').eq('id', req.usuario.id).maybeSingle());
      if (eu && eu.superior_id) {
        ids.push(eu.superior_id);
        if (req.usuario.nivel === 'vendedor') {
          const gerente = must(await supabase.from('usuarios').select('superior_id').eq('id', eu.superior_id).maybeSingle());
          if (gerente && gerente.superior_id) ids.push(gerente.superior_id);
        }
      }
    }
    if (ids.length === 0) return res.json([]);
    const rows = must(await supabase.from('usuarios').select('id,nome,email,nivel').in('id', ids));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Arquivos pendentes de aceite pelo usuario logado (ele e o destinatario)
app.get('/arquivos/pendentes', auth, async (req, res) => {
  try {
    const rows = must(await supabase.from('arquivos')
      .select('*, projetos(cliente,estado,municipio,fazenda)')
      .eq('destinatario_id', req.usuario.id)
      .eq('status', 'pendente')
      .order('created_at'));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.put('/arquivos/:id/aceitar', auth, async (req, res) => {
  try {
    const a = must(await supabase.from('arquivos').select('*').eq('id', req.params.id).maybeSingle());
    if (!a) return res.status(404).json({ erro: 'Arquivo nao encontrado' });
    if (a.destinatario_id !== req.usuario.id) return res.status(403).json({ erro: 'Este arquivo nao foi enviado para voce' });
    const row = must(await supabase.from('arquivos').update({ status: 'aceito', aceito_em: new Date().toISOString() }).eq('id', a.id).select().single());
    res.json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.put('/arquivos/:id/recusar', auth, async (req, res) => {
  try {
    const a = must(await supabase.from('arquivos').select('*').eq('id', req.params.id).maybeSingle());
    if (!a) return res.status(404).json({ erro: 'Arquivo nao encontrado' });
    if (a.destinatario_id !== req.usuario.id) return res.status(403).json({ erro: 'Este arquivo nao foi enviado para voce' });
    const row = must(await supabase.from('arquivos').update({ status: 'recusado' }).eq('id', a.id).select().single());
    res.json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// ---------- PIVOS ----------
app.get('/pivos', auth, async (req, res) => {
  try {
    if (!req.query.projeto_id) return res.status(400).json({ erro: 'Informe projeto_id' });
    if (!(await possoAcessarProjeto(req.usuario, req.query.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    const rows = must(await supabase.from('pivos').select('*').eq('projeto_id', req.query.projeto_id).order('numero_pivo'));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Cria OU atualiza um pivo a partir do arquivo de proposta (.xlsb) lido no
// navegador. Reenviar a planilha de um pivo que ja existe no mesmo projeto
// (mesmo projeto_id + numero_pivo) NUNCA cria uma segunda linha -- isso
// contaria o pivo em dobro no dashboard (valor, area). Em vez disso:
//   1) o estado atual e congelado em pivos_historico (nada se perde);
//   2) a MESMA linha e atualizada com os dados tecnicos/monetarios novos
//      (area, preco_total, preco_parte_aerea, montagem, servicos_adicionais,
//      arquivo/caminho local, revisao +1);
//   3) os campos puramente de negociacao (encargos_pct, desconto_pct,
//      taxa_flat_pct) sao SEMPRE preservados da versao anterior -- o fluxo
//      de upload nunca os envia, entao eles so mudam via PUT /desconto, e
//      continuam valendo sobre a versao mais nova, nunca sobre uma antiga.
app.post('/pivos', auth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.projeto_id || !b.numero_pivo) return res.status(400).json({ erro: 'Informe projeto_id e numero_pivo' });
    if (!(await possoAcessarProjeto(req.usuario, b.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });

    const existente = must(await supabase.from('pivos').select('*')
      .eq('projeto_id', b.projeto_id).eq('numero_pivo', b.numero_pivo).maybeSingle());

    const { icmsPct, pisPct, descRevendaPct } = await getConstantesFiscais(b.estado || (must(await supabase.from('projetos').select('estado').eq('id', b.projeto_id).maybeSingle()) || {}).estado);

    const dadosTecnicos = {
      projeto_id: b.projeto_id,
      numero_pivo: b.numero_pivo,
      composicao: b.composicao || null,
      propriedade: b.propriedade || null,
      municipio: b.municipio || null,
      estado: b.estado || null,
      marca: b.marca || null,
      modelo: b.modelo || null,
      area_irrigada_ha: b.area_irrigada_ha != null ? Number(b.area_irrigada_ha) : null,
      montagem: Number(b.montagem) || 0,
      servicos_adicionais: Number(b.servicos_adicionais) || 0,
      preco_total: Number(b.preco_total) || 0,
      preco_parte_aerea: Number(b.preco_parte_aerea) || 0,
      preco_pvc: Number(b.preco_pvc) || 0,
      nome_arquivo_original: b.nome_arquivo_original || null,
      caminho_local: b.caminho_local || null,
      linha_calculadora: b.linha_calculadora != null ? b.linha_calculadora : (existente ? existente.linha_calculadora : null),
      updated_at: new Date().toISOString()
    };

    // Campos de negociacao: preserva o que ja estava, so usa o enviado no
    // corpo se vier explicitamente (o fluxo de upload normal nunca manda).
    const campos = Object.assign({}, dadosTecnicos, {
      encargos_pct: b.encargos_pct != null ? Number(b.encargos_pct) : (existente ? existente.encargos_pct : 10),
      desconto_pct: b.desconto_pct != null ? Number(b.desconto_pct) : (existente ? existente.desconto_pct : 0),
      taxa_flat_pct: b.taxa_flat_pct != null ? Number(b.taxa_flat_pct) : (existente ? existente.taxa_flat_pct : 0),
      revisao: existente ? (existente.revisao || 1) + 1 : (b.revisao || 1)
    });

    const calc = recalcularValorNegociado(campos, icmsPct, pisPct, descRevendaPct);
    campos.valor_negociado = calc.valorNegociado;
    campos.custo_por_hectare = calc.custoPorHectare;
    campos.pct_ancillary = calc.pctAncillary;

    let row;
    if (existente) {
      await supabase.from('pivos_historico').insert({
        pivo_id: existente.id,
        revisao: existente.revisao || 1,
        dados: existente,
        substituido_por: req.usuario.id
      });
      row = must(await supabase.from('pivos').update(campos).eq('id', existente.id).select().single());
    } else {
      row = must(await supabase.from('pivos').insert(campos).select().single());
    }
    res.status(existente ? 200 : 201).json(Object.assign({}, row, { nova_versao: !!existente }));
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Historico de versoes anteriores de um pivo (mais recente primeiro).
app.get('/pivos/:id/historico', auth, async (req, res) => {
  try {
    const p = must(await supabase.from('pivos').select('projeto_id').eq('id', req.params.id).maybeSingle());
    if (!p) return res.status(404).json({ erro: 'Pivo nao encontrado' });
    if (!(await possoAcessarProjeto(req.usuario, p.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    const rows = must(await supabase.from('pivos_historico').select('*').eq('pivo_id', req.params.id).order('revisao', { ascending: false }));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Edita o desconto (ou encargos/taxa flat) de um pivo e recalcula o Valor
// Negociado na hora, usando a mesma formula da Calculadora real. Isso NAO
// escreve no arquivo .xlsm local -- fica registrado em log_desconto com
// sincronizado_local=false ate o script local aplicar e gravar a nova versao.
app.put('/pivos/:id/desconto', auth, async (req, res) => {
  try {
    const p = must(await supabase.from('pivos').select('*').eq('id', req.params.id).maybeSingle());
    if (!p) return res.status(404).json({ erro: 'Pivo nao encontrado' });
    if (!(await possoAcessarProjeto(req.usuario, p.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });

    const b = req.body || {};
    const desconto_pct = b.desconto_pct != null ? Number(b.desconto_pct) : p.desconto_pct;
    const encargos_pct = b.encargos_pct != null ? Number(b.encargos_pct) : p.encargos_pct;
    const taxa_flat_pct = b.taxa_flat_pct != null ? Number(b.taxa_flat_pct) : p.taxa_flat_pct;
    const montagem = b.montagem != null ? Number(b.montagem) : p.montagem;
    const servicos_adicionais = b.servicos_adicionais != null ? Number(b.servicos_adicionais) : p.servicos_adicionais;

    const { icmsPct, pisPct, descRevendaPct } = await getConstantesFiscais(p.estado);
    const atualizado = Object.assign({}, p, { desconto_pct, encargos_pct, taxa_flat_pct, montagem, servicos_adicionais });
    const calc = recalcularValorNegociado(atualizado, icmsPct, pisPct, descRevendaPct);

    const novo = must(await supabase.from('pivos').update({
      desconto_pct: desconto_pct,
      encargos_pct: encargos_pct,
      taxa_flat_pct: taxa_flat_pct,
      montagem: montagem,
      servicos_adicionais: servicos_adicionais,
      valor_negociado: calc.valorNegociado,
      custo_por_hectare: calc.custoPorHectare,
      pct_ancillary: calc.pctAncillary,
      updated_at: new Date().toISOString()
    }).eq('id', p.id).select().single());

    await supabase.from('log_desconto').insert({
      pivo_id: p.id,
      usuario_id: req.usuario.id,
      desconto_anterior: p.desconto_pct,
      desconto_novo: desconto_pct,
      valor_negociado_anterior: p.valor_negociado,
      valor_negociado_novo: calc.valorNegociado,
      sincronizado_local: false
    });

    res.json(novo);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Fila de alteracoes de desconto ainda nao gravadas no arquivo local --
// o script local (device bridge / agente na maquina do usuario) consome
// isso, escreve no .xlsm e confirma com PUT /log_desconto/:id/sincronizado
app.get('/log_desconto/pendentes', auth, async (req, res) => {
  try {
    const rows = must(await supabase.from('log_desconto').select('*, pivos(*)').eq('sincronizado_local', false).order('created_at'));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.put('/log_desconto/:id/sincronizado', auth, async (req, res) => {
  try {
    const row = must(await supabase.from('log_desconto').update({ sincronizado_local: true }).eq('id', req.params.id).select().single());
    res.json(row);
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

// Projeto nasce do upload do primeiro pivo -- este endpoint so cria o
// "envelope" (cliente/estado/municipio/fazenda); os valores vem dos pivos.
app.post('/projetos', auth, exigirNivel('vendedor', 'gerente', 'diretor'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.cliente) return res.status(400).json({ erro: 'Informe o cliente' });
    const row = must(await supabase.from('projetos').insert({
      cliente: b.cliente,
      estado: b.estado || null,
      municipio: b.municipio || null,
      fazenda: b.fazenda || null,
      descricao: b.descricao || '',
      status: 'em_negociacao',
      vendedor_id: req.usuario.id,
      caminho_local_calculadora: b.caminho_local_calculadora || null
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
      estado: b.estado !== undefined ? b.estado : p.estado,
      municipio: b.municipio !== undefined ? b.municipio : p.municipio,
      fazenda: b.fazenda !== undefined ? b.fazenda : p.fazenda,
      descricao: b.descricao !== undefined ? b.descricao : p.descricao,
      status: b.status !== undefined ? b.status : p.status,
      caminho_local_calculadora: b.caminho_local_calculadora !== undefined ? b.caminho_local_calculadora : p.caminho_local_calculadora,
      updated_at: new Date().toISOString()
    };
    if (['em_negociacao', 'aprovado', 'reprovado'].indexOf(novo.status) === -1) return res.status(400).json({ erro: 'Status invalido' });
    const row = must(await supabase.from('projetos').update(novo).eq('id', p.id).select().single());
    res.json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Projeto + seus pivos + totais agregados (equivalente ao "dashboard por
// projeto" pedido -- reflete o que estaria no RESUMO da Calculadora).
app.get('/projetos/:id/resumo', auth, async (req, res) => {
  try {
    const p = must(await supabase.from('projetos').select('*').eq('id', req.params.id).maybeSingle());
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });
    if (!(await possoAcessarProjeto(req.usuario, p.id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    const pivos = must(await supabase.from('pivos').select('*').eq('projeto_id', p.id).order('numero_pivo'));
    const valorTotal = pivos.reduce(function (s, r) { return s + (Number(r.valor_negociado) || 0); }, 0);
    const areaTotal = pivos.reduce(function (s, r) { return s + (Number(r.area_irrigada_ha) || 0); }, 0);
    res.json({
      projeto: p,
      pivos: pivos,
      resumo: {
        qtde_pivos: pivos.length,
        valor_total: valorTotal,
        area_total_ha: areaTotal,
        custo_por_hectare_medio: areaTotal ? valorTotal / areaTotal : 0
      }
    });
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

// O busboy (usado pelo multer) decodifica o header multipart do nome do
// arquivo como latin1 por padrao -- um nome com acentuacao UTF-8 (ex.
// "URUAÇU.xlsb") chega corrompido ("URUAÃ...") se nao reinterpretarmos.
function corrigirNomeArquivo(nome) {
  try { return Buffer.from(nome, 'latin1').toString('utf8'); } catch (e) { return nome; }
}
// A CHAVE de armazenamento no Supabase Storage (diferente do nome exibido)
// so aceita um conjunto restrito de caracteres -- espaco e acento geram
// "Invalid key". Sanitiza so a chave; o nome original (acentuado, com
// espacos) continua intacto no campo `nome` pra exibicao/download.
function slugArquivo(nome) {
  return String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

app.post('/arquivos', auth, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    const projetoId = req.body.projeto_id;
    const p = must(await supabase.from('projetos').select('id').eq('id', projetoId).maybeSingle());
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });
    if (!(await possoAcessarProjeto(req.usuario, projetoId))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });

    const nomeOriginal = corrigirNomeArquivo(req.file.originalname);
    const caminhoStorage = projetoId + '/' + Date.now() + '-' + slugArquivo(nomeOriginal);
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(caminhoStorage, req.file.buffer, {
      contentType: req.file.mimetype,
      upsert: true
    });
    if (upErr) throw upErr;

    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(caminhoStorage);

    const tipo = ['pivo', 'calculadora', 'outro'].indexOf(req.body.tipo) !== -1 ? req.body.tipo : 'pivo';
    const row = must(await supabase.from('arquivos').insert({
      projeto_id: projetoId,
      pivo_id: req.body.pivo_id || null,
      tipo: tipo,
      nome: nomeOriginal,
      caminho: pub.publicUrl,
      tamanho: req.file.size,
      mimetype: req.file.mimetype,
      enviado_por: req.usuario.id,
      destinatario_id: req.body.destinatario_id || null,
      status: req.body.destinatario_id ? 'pendente' : 'aceito'
    }).select().single());
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.get('/arquivos', auth, async (req, res) => {
  try {
    if (!req.query.projeto_id) return res.status(400).json({ erro: 'Informe projeto_id' });
    if (!(await possoAcessarProjeto(req.usuario, req.query.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    const rows = must(await supabase.from('arquivos').select('id,projeto_id,nome,caminho,tamanho,mimetype,created_at').eq('projeto_id', req.query.projeto_id).order('created_at', { ascending: false }));
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
    const projetoIds = projetos.map(function (p) { return p.id; });
    const pivos = projetoIds.length ? must(await supabase.from('pivos').select('projeto_id,valor_negociado,area_irrigada_ha').in('projeto_id', projetoIds)) : [];

    const valorPorProjeto = {};
    pivos.forEach(function (piv) {
      valorPorProjeto[piv.projeto_id] = (valorPorProjeto[piv.projeto_id] || 0) + (Number(piv.valor_negociado) || 0);
    });

    const total = projetos.length;
    const emNegociacao = projetos.filter(function (p) { return p.status === 'em_negociacao'; }).length;
    const aprovados = projetos.filter(function (p) { return p.status === 'aprovado'; }).length;
    const valorTotal = pivos.reduce(function (s, r) { return s + (Number(r.valor_negociado) || 0); }, 0);
    const areaTotal = pivos.reduce(function (s, r) { return s + (Number(r.area_irrigada_ha) || 0); }, 0);

    res.json({
      kpis: {
        total: total,
        em_negociacao: emNegociacao,
        aprovados: aprovados,
        qtde_pivos: pivos.length,
        valor_total: valorTotal,
        area_total_ha: areaTotal,
        custo_por_hectare_medio: areaTotal ? valorTotal / areaTotal : 0
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
