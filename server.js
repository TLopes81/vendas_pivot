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
const pdfParse = require('pdf-parse');
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

// Montagem e Servicos Adicionais sao um total UNICO por negociacao (projeto),
// nao um valor por pivo/equipamento -- aplicados uma unica vez no total do
// projeto. Na formula original (coluna N da Calculadora) o termo H/I, apesar
// de parecer ponderado pelo preco de cada pivo, se simplifica algebricamente
// para um valor flat "gross-up" (H+I) / ((100-pis-icms-flat)/100) -- por
// isso e seguro trata-lo como um unico valor agregado para o projeto inteiro
// em vez de fragmentado por pivo.
function calcularAncillaryGrossado(projeto, pisPct, icmsPct) {
  var G = Number(projeto.taxa_flat_pct) || 0;
  var H = Number(projeto.montagem) || 0;
  var I = Number(projeto.servicos_adicionais) || 0;
  if (!H && !I) return 0;
  var fator = (100 - pisPct - icmsPct - G) / 100;
  if (!fator || fator <= 0) return 0;
  var bruto = (H + I) / fator;
  return Math.ceil(bruto / 100) * 100;
}

// Item adicional AVULSO da negociacao (bombeamento/PVC/cabos eletricos
// vendidos separados de qualquer pivo), com seu PROPRIO desconto/encargos/
// taxa flat/servicos adicionais -- diferente do item ao lado e diferente
// dos parametros gerais do pivo. Usa o mesmo ramo da formula da Calculadora
// que aplica desconto (o equivalente ao termo "K" / parte aerea), pois um
// item vendido avulso e negociavel como qualquer outro produto.
function calcularValorItemAdicional(item, icmsPct, pisPct) {
  var K = Number(item.valor) || 0;
  if (!K) return 0;
  var E = Number(item.encargos_pct) || 0;
  var F = Number(item.desconto_pct) || 0;
  var G = Number(item.taxa_flat_pct) || 0;
  var I = Number(item.servicos_adicionais) || 0;

  var icmsFactor = 0.82 / ((100 - icmsPct) / 100);
  var base = (K * icmsFactor) / ((100 - E) / 100) * ((100 - F) / 100) / ((100 - G) / 100);
  var fatorFlat = (100 - pisPct - icmsPct - G) / 100;
  var servico = (I && fatorFlat > 0) ? (I / fatorFlat) : 0;
  var total = base + servico;
  return Math.ceil(total / 100) * 100;
}

// Recalcula o valor_negociado/custo_por_hectare de TODOS os pivos de um
// projeto usando os parametros comerciais (Encargos/Desconto/Taxa Flat) do
// PROJETO -- nunca os do pivo individual. Chamado sempre que: (a) um pivo e
// enviado/reenviado, ou (b) os parametros comerciais do projeto mudam.
async function recalcularTodosPivosDoProjeto(projetoId) {
  const projeto = must(await supabase.from('projetos').select('*').eq('id', projetoId).maybeSingle());
  if (!projeto) return;
  const { icmsPct, pisPct, descRevendaPct } = await getConstantesFiscais(projeto.estado);
  const pivos = must(await supabase.from('pivos').select('*').eq('projeto_id', projetoId));
  for (const piv of pivos) {
    const calc = recalcularValorNegociado(Object.assign({}, piv, {
      encargos_pct: projeto.encargos_pct,
      desconto_pct: projeto.desconto_pct,
      taxa_flat_pct: projeto.taxa_flat_pct,
      montagem: 0,
      servicos_adicionais: 0
    }), icmsPct, pisPct, descRevendaPct);
    await supabase.from('pivos').update({
      valor_negociado: calc.valorNegociado,
      custo_por_hectare: calc.custoPorHectare,
      pct_ancillary: calc.pctAncillary,
      encargos_pct: projeto.encargos_pct,
      desconto_pct: projeto.desconto_pct,
      taxa_flat_pct: projeto.taxa_flat_pct
    }).eq('id', piv.id);
  }
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

// Troca a PROPRIA senha (qualquer usuario logado) -- exige a senha atual.
app.put('/me/senha', auth, async (req, res) => {
  try {
    const senhaAtual = (req.body || {}).senha_atual;
    const senhaNova = (req.body || {}).senha_nova;
    if (!senhaAtual || !senhaNova) return res.status(400).json({ erro: 'Informe a senha atual e a nova senha' });
    if (String(senhaNova).length < 6) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 6 caracteres' });
    const u = must(await supabase.from('usuarios').select('id,salt,senha_hash').eq('id', req.usuario.id).maybeSingle());
    if (!u) return res.status(404).json({ erro: 'Usuario nao encontrado' });
    if (hash(senhaAtual, u.salt) !== u.senha_hash) return res.status(401).json({ erro: 'Senha atual incorreta' });
    const novoSalt = crypto.randomBytes(16).toString('hex');
    must(await supabase.from('usuarios').update({ salt: novoSalt, senha_hash: hash(senhaNova, novoSalt) }).eq('id', u.id).select().single());
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Redefine a senha de OUTRO usuario -- so gerente (so da propria equipe) ou
// diretor (qualquer um). Nao pede a senha atual (e um reset administrativo,
// pra quando a pessoa esqueceu ou pra deixar uma senha inicial no
// cadastro).
app.put('/usuarios/:id/senha', auth, exigirNivel('gerente', 'diretor'), async (req, res) => {
  try {
    const senhaNova = (req.body || {}).senha_nova;
    if (!senhaNova) return res.status(400).json({ erro: 'Informe a nova senha' });
    if (String(senhaNova).length < 6) return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 6 caracteres' });
    if (req.usuario.nivel === 'gerente') {
      const ids = await idsDaEquipe(req.usuario.id);
      if (ids.indexOf(req.params.id) === -1) return res.status(403).json({ erro: 'Sem permissao sobre este usuario' });
    }
    const u = must(await supabase.from('usuarios').select('id').eq('id', req.params.id).maybeSingle());
    if (!u) return res.status(404).json({ erro: 'Usuario nao encontrado' });
    const novoSalt = crypto.randomBytes(16).toString('hex');
    must(await supabase.from('usuarios').update({ salt: novoSalt, senha_hash: hash(senhaNova, novoSalt) }).eq('id', u.id).select().single());
    res.json({ ok: true });
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

// Quem o usuario logado pode escolher como destinatario ao enviar um
// arquivo: SO o superior direto -- vendedor -> seu gerente; gerente -> seu
// diretor; diretor -> ninguem. Sem pular nivel (vendedor nao manda direto
// pro diretor): a regra do sistema e a cadeia subir um elo de cada vez.
app.get('/usuarios/destinatarios', auth, async (req, res) => {
  try {
    if (req.usuario.nivel !== 'vendedor' && req.usuario.nivel !== 'gerente') return res.json([]);
    const eu = must(await supabase.from('usuarios').select('superior_id').eq('id', req.usuario.id).maybeSingle());
    if (!eu || !eu.superior_id) return res.json([]);
    const rows = must(await supabase.from('usuarios').select('id,nome,email,nivel').eq('id', eu.superior_id));
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

// Encaminha um arquivo ja aceito para o PROXIMO elo da cadeia (gerente ->
// seu diretor). So quem aceitou o arquivo pode encaminha-lo, e so pro seu
// superior direto (mesma regra de /usuarios/destinatarios) -- nao cria
// upload novo nem mexe no pivo/revisao, so uma nova linha pendente
// apontando pro mesmo arquivo already-aceito.
app.post('/arquivos/:id/encaminhar', auth, async (req, res) => {
  try {
    const a = must(await supabase.from('arquivos').select('*').eq('id', req.params.id).maybeSingle());
    if (!a) return res.status(404).json({ erro: 'Arquivo nao encontrado' });
    if (a.destinatario_id !== req.usuario.id || a.status !== 'aceito') {
      return res.status(403).json({ erro: 'Voce so pode encaminhar um arquivo que recebeu e ja aceitou' });
    }
    const destinatarioId = req.body.destinatario_id;
    if (!destinatarioId) return res.status(400).json({ erro: 'Informe destinatario_id' });
    const eu = must(await supabase.from('usuarios').select('superior_id').eq('id', req.usuario.id).maybeSingle());
    if (!eu || eu.superior_id !== destinatarioId) {
      return res.status(403).json({ erro: 'So e permitido encaminhar para o seu superior direto' });
    }
    const row = must(await supabase.from('arquivos').insert({
      projeto_id: a.projeto_id,
      pivo_id: a.pivo_id,
      item_adicional_id: a.item_adicional_id,
      tipo: a.tipo,
      nome: a.nome,
      caminho_storage: a.caminho_storage,
      tamanho: a.tamanho,
      mimetype: a.mimetype,
      enviado_por: req.usuario.id,
      destinatario_id: destinatarioId,
      status: 'pendente'
    }).select().single());
    res.status(201).json(row);
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

    // O numero do pivo (PC 05, PC 06...) sozinho NAO identifica um pivo
    // dentro do projeto -- um mesmo cliente pode ter mais de uma fazenda, e
    // cada fazenda numera os pivos de forma independente (PC 06 na Fazenda A
    // e PC 06 na Fazenda B sao pivos diferentes, nao versoes um do outro).
    // A identidade real e numero_pivo + propriedade (fazenda).
    const norm = function (s) { return String(s || '').trim().toUpperCase(); };
    const candidatos = must(await supabase.from('pivos').select('*')
      .eq('projeto_id', b.projeto_id).eq('numero_pivo', b.numero_pivo));
    const existente = candidatos.find(function (c) { return norm(c.propriedade) === norm(b.propriedade); }) || null;

    // Encargos/Desconto/Taxa Flat/Montagem/Servicos Adicionais NAO sao mais
    // digitados a mao -- vem extraidos da propria planilha .xlsb do pivo
    // (linha "Sub Total D - PIVO" da aba PROPOSTA, ver MAPA_TOTAIS no
    // index.html), e sao unicos por negociacao (projeto). Guardamos aqui o
    // que ESTE pivo trouxe (montagem/servicos sao o total deste pivo
    // apenas); logo abaixo sincronizamos o projeto somando todos os pivos
    // dele, e recalcularTodosPivosDoProjeto aplica o resultado a todos.
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
      potencia_motobomba_cv: b.potencia_motobomba_cv != null ? Number(b.potencia_motobomba_cv) : null,
      perda_carga_parte_aerea_mca: b.perda_carga_parte_aerea_mca != null ? Number(b.perda_carga_parte_aerea_mca) : null,
      bomba_nome: b.bomba_nome || null,
      bomba_eficiencia_pct: b.bomba_eficiencia_pct != null ? Number(b.bomba_eficiencia_pct) : null,
      adutora_trechos: Array.isArray(b.adutora_trechos) ? b.adutora_trechos : null,
      preco_total: Number(b.preco_total) || 0,
      preco_parte_aerea: Number(b.preco_parte_aerea) || 0,
      preco_pvc: Number(b.preco_pvc) || 0,
      montagem: Number(b.montagem) || 0,
      servicos_adicionais: Number(b.servicos_adicionais) || 0,
      encargos_pct: b.encargos_pct != null ? Number(b.encargos_pct) : 10,
      desconto_pct: b.desconto_pct != null ? Number(b.desconto_pct) : 0,
      taxa_flat_pct: b.taxa_flat_pct != null ? Number(b.taxa_flat_pct) : 0,
      nome_arquivo_original: b.nome_arquivo_original || null,
      caminho_local: b.caminho_local || null,
      linha_calculadora: b.linha_calculadora != null ? b.linha_calculadora : (existente ? existente.linha_calculadora : null),
      revisao: existente ? (existente.revisao || 1) + 1 : (b.revisao || 1),
      updated_at: new Date().toISOString()
    };

    let row;
    if (existente) {
      await supabase.from('pivos_historico').insert({
        pivo_id: existente.id,
        revisao: existente.revisao || 1,
        dados: existente,
        substituido_por: req.usuario.id
      });
      row = must(await supabase.from('pivos').update(dadosTecnicos).eq('id', existente.id).select().single());
    } else {
      row = must(await supabase.from('pivos').insert(dadosTecnicos).select().single());
    }

    // Sincroniza os parametros comerciais do PROJETO a partir dos dados que
    // acabaram de ser extraidos da planilha: Encargos/Desconto/Taxa Flat
    // ficam com o valor desta planilha (sao identicos entre os pivos de uma
    // mesma negociacao real); Montagem/Servicos Adicionais viram a SOMA de
    // todos os pivos do projeto (cada planilha traz so o total daquele
    // pivo).
    const todosPivosDoProjeto = must(await supabase.from('pivos').select('montagem,servicos_adicionais').eq('projeto_id', b.projeto_id));
    const somaMontagem = todosPivosDoProjeto.reduce(function (s, p) { return s + (Number(p.montagem) || 0); }, 0);
    const somaServicos = todosPivosDoProjeto.reduce(function (s, p) { return s + (Number(p.servicos_adicionais) || 0); }, 0);
    const syncProjeto = { montagem: somaMontagem, servicos_adicionais: somaServicos };
    if (b.encargos_pct != null) syncProjeto.encargos_pct = Number(b.encargos_pct);
    if (b.desconto_pct != null) syncProjeto.desconto_pct = Number(b.desconto_pct);
    if (b.taxa_flat_pct != null) syncProjeto.taxa_flat_pct = Number(b.taxa_flat_pct);
    await supabase.from('projetos').update(syncProjeto).eq('id', b.projeto_id);

    await recalcularTodosPivosDoProjeto(b.projeto_id);
    const atualizado = must(await supabase.from('pivos').select('*').eq('id', row.id).maybeSingle());
    res.status(existente ? 200 : 201).json(Object.assign({}, atualizado, { nova_versao: !!existente }));
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

// ---------- ITENS ADICIONAIS (bombeamento/PVC/cabos eletricos avulsos) ----------
// Cada item tem seu PROPRIO desconto/encargos/taxa flat/servicos adicionais
// -- nao usa os parametros gerais do projeto, nem os de outro item.
app.post('/itens-adicionais', auth, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.projeto_id || !b.tipo) return res.status(400).json({ erro: 'Informe projeto_id e tipo' });
    if (['bombeamento', 'pvc', 'cabos_eletricos', 'outro'].indexOf(b.tipo) === -1) return res.status(400).json({ erro: 'Tipo invalido' });
    if (!(await possoAcessarProjeto(req.usuario, b.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });

    const projeto = must(await supabase.from('projetos').select('estado').eq('id', b.projeto_id).maybeSingle());
    const { icmsPct, pisPct } = await getConstantesFiscais(projeto ? projeto.estado : null);

    const item = {
      projeto_id: b.projeto_id,
      tipo: b.tipo,
      descricao: b.descricao || null,
      fornecedor: b.fornecedor || null,
      arquivo_nome_original: b.arquivo_nome_original || null,
      valor: Number(b.valor) || 0,
      encargos_pct: b.encargos_pct != null ? Number(b.encargos_pct) : 10,
      desconto_pct: b.desconto_pct != null ? Number(b.desconto_pct) : 0,
      taxa_flat_pct: b.taxa_flat_pct != null ? Number(b.taxa_flat_pct) : 0,
      servicos_adicionais: b.servicos_adicionais != null ? Number(b.servicos_adicionais) : 0,
      created_by: req.usuario.id
    };
    item.valor_calculado = calcularValorItemAdicional(item, icmsPct, pisPct);

    const row = must(await supabase.from('itens_adicionais').insert(item).select().single());
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.put('/itens-adicionais/:id', auth, async (req, res) => {
  try {
    const existente = must(await supabase.from('itens_adicionais').select('*').eq('id', req.params.id).maybeSingle());
    if (!existente) return res.status(404).json({ erro: 'Item nao encontrado' });
    if (!(await possoAcessarProjeto(req.usuario, existente.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });

    const b = req.body || {};
    const item = {
      descricao: b.descricao !== undefined ? b.descricao : existente.descricao,
      valor: b.valor != null ? Number(b.valor) : existente.valor,
      encargos_pct: b.encargos_pct != null ? Number(b.encargos_pct) : existente.encargos_pct,
      desconto_pct: b.desconto_pct != null ? Number(b.desconto_pct) : existente.desconto_pct,
      taxa_flat_pct: b.taxa_flat_pct != null ? Number(b.taxa_flat_pct) : existente.taxa_flat_pct,
      servicos_adicionais: b.servicos_adicionais != null ? Number(b.servicos_adicionais) : existente.servicos_adicionais,
      updated_at: new Date().toISOString()
    };

    const projeto = must(await supabase.from('projetos').select('estado').eq('id', existente.projeto_id).maybeSingle());
    const { icmsPct, pisPct } = await getConstantesFiscais(projeto ? projeto.estado : null);
    item.valor_calculado = calcularValorItemAdicional(item, icmsPct, pisPct);

    const row = must(await supabase.from('itens_adicionais').update(item).eq('id', req.params.id).select().single());
    res.json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Extrai automaticamente o valor negociado de um orcamento em PDF de
// fornecedor de PVC. Hoje so sabemos o layout real do Tigre (2 PDFs reais
// conferidos): procura a linha "VALOR NEGOCIADO" perto do fim do pedido.
// Amanco/Corplastic ainda nao tem layout confirmado -- quando chegar um PDF
// real desses fornecedores, da pra estender este parser do mesmo jeito.
const itensPdfUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.post('/itens-adicionais/extrair-pdf', auth, itensPdfUpload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ erro: 'Nenhum arquivo enviado' });
    const fornecedor = String(req.body.fornecedor || '').trim();
    const dados = await pdfParse(req.file.buffer);
    const texto = dados.text || '';

    if (fornecedor === 'Tigre') {
      const m = texto.match(/VALOR\s+NEGOCIADO\s*R?\$?\s*([\d.,]+)/i);
      if (m) {
        const valor = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
        if (!isNaN(valor) && valor > 0) {
          return res.json({ valor: valor, origem: 'VALOR NEGOCIADO (Tigre)' });
        }
      }
    }
    res.json({ valor: null, origem: null });
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

app.delete('/itens-adicionais/:id', auth, async (req, res) => {
  try {
    const existente = must(await supabase.from('itens_adicionais').select('projeto_id').eq('id', req.params.id).maybeSingle());
    if (!existente) return res.status(404).json({ erro: 'Item nao encontrado' });
    if (!(await possoAcessarProjeto(req.usuario, existente.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    await supabase.from('itens_adicionais').delete().eq('id', req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Edita os parametros comerciais da NEGOCIACAO (Encargos/Desconto/Taxa
// Flat/Montagem/Servicos Adicionais) -- um valor so para o projeto inteiro,
// nunca por pivo/equipamento -- e recalcula o Valor Negociado de TODOS os
// pivos do projeto na hora, usando a mesma formula da Calculadora real. Isso
// NAO escreve no arquivo .xlsm local -- fica registrado em log_desconto (por
// pivo, pois e o que o write-back futuro vai aplicar arquivo por arquivo)
// com sincronizado_local=false ate o script local aplicar e gravar.
app.put('/projetos/:id/comercial', auth, async (req, res) => {
  try {
    const p = must(await supabase.from('projetos').select('*').eq('id', req.params.id).maybeSingle());
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });
    if (!(await possoAcessarProjeto(req.usuario, p.id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });

    const b = req.body || {};
    const novo = {
      encargos_pct: b.encargos_pct != null ? Number(b.encargos_pct) : p.encargos_pct,
      desconto_pct: b.desconto_pct != null ? Number(b.desconto_pct) : p.desconto_pct,
      taxa_flat_pct: b.taxa_flat_pct != null ? Number(b.taxa_flat_pct) : p.taxa_flat_pct,
      montagem: b.montagem != null ? Number(b.montagem) : p.montagem,
      servicos_adicionais: b.servicos_adicionais != null ? Number(b.servicos_adicionais) : p.servicos_adicionais,
      updated_at: new Date().toISOString()
    };

    const pivosAntes = must(await supabase.from('pivos').select('id,desconto_pct,valor_negociado').eq('projeto_id', p.id));
    const projetoAtualizado = must(await supabase.from('projetos').update(novo).eq('id', p.id).select().single());
    await recalcularTodosPivosDoProjeto(p.id);
    const pivosDepois = must(await supabase.from('pivos').select('id,desconto_pct,valor_negociado').eq('projeto_id', p.id));

    const mapaAntes = {};
    pivosAntes.forEach(function (r) { mapaAntes[r.id] = r; });
    for (const depois of pivosDepois) {
      const antes = mapaAntes[depois.id];
      if (!antes) continue;
      await supabase.from('log_desconto').insert({
        pivo_id: depois.id,
        usuario_id: req.usuario.id,
        desconto_anterior: antes.desconto_pct,
        desconto_novo: depois.desconto_pct,
        valor_negociado_anterior: antes.valor_negociado,
        valor_negociado_novo: depois.valor_negociado,
        sincronizado_local: false
      });
    }

    res.json(projetoAtualizado);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Dados do pedido + forma de pagamento (aba RESUMO da Calculadora.xlsm --
// CLIENTE/PROPRIEDADE/LOCAL/RESPONSAVEL ja vem de outros campos do projeto;
// aqui so o que e exclusivo dessa aba: distribuidor, data do pedido, e a
// config do financiamento).
app.put('/projetos/:id/financiamento', auth, async (req, res) => {
  try {
    const p = must(await supabase.from('projetos').select('*').eq('id', req.params.id).maybeSingle());
    if (!p) return res.status(404).json({ erro: 'Projeto nao encontrado' });
    if (!(await possoAcessarProjeto(req.usuario, p.id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });

    const b = req.body || {};
    const novo = {
      distribuidor: b.distribuidor !== undefined ? b.distribuidor : p.distribuidor,
      pedido_data: b.pedido_data !== undefined ? b.pedido_data : p.pedido_data,
      exibir_forma_pagamento: b.exibir_forma_pagamento !== undefined ? !!b.exibir_forma_pagamento : p.exibir_forma_pagamento,
      forma_pagamento: b.forma_pagamento !== undefined ? b.forma_pagamento : p.forma_pagamento,
      dias_adicionais: b.dias_adicionais != null ? Number(b.dias_adicionais) : p.dias_adicionais,
      juros_am_pct: b.juros_am_pct != null ? Number(b.juros_am_pct) : p.juros_am_pct,
      updated_at: new Date().toISOString()
    };
    const row = must(await supabase.from('projetos').update(novo).eq('id', p.id).select().single());
    res.json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Parcelas de financiamento -- substitui a lista inteira de uma vez (sao
// poucas linhas, 1 a 4 normalmente, editadas juntas como um formulario so,
// igual a planilha). Body: { parcelas: [{pagamento, data_vencimento,
// porcentagem}, ...] }, na ordem que devem aparecer.
app.put('/projetos/:id/parcelas', auth, async (req, res) => {
  try {
    if (!(await possoAcessarProjeto(req.usuario, req.params.id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    const parcelas = Array.isArray((req.body || {}).parcelas) ? req.body.parcelas : [];
    await supabase.from('parcelas_pagamento').delete().eq('projeto_id', req.params.id);
    if (parcelas.length > 0) {
      const linhas = parcelas.map(function (p, i) {
        return {
          projeto_id: req.params.id,
          ordem: i + 1,
          pagamento: String(p.pagamento || '').trim() || ('Parcela ' + (i + 1)),
          data_vencimento: p.data_vencimento,
          porcentagem: Number(p.porcentagem) || 0
        };
      });
      must(await supabase.from('parcelas_pagamento').insert(linhas));
    }
    const rows = must(await supabase.from('parcelas_pagamento').select('*').eq('projeto_id', req.params.id).order('ordem'));
    res.json(rows);
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
      status: 'negociando',
      vendedor_id: req.usuario.id,
      caminho_local_calculadora: b.caminho_local_calculadora || null,
      encargos_pct: b.encargos_pct != null ? Number(b.encargos_pct) : 10,
      desconto_pct: b.desconto_pct != null ? Number(b.desconto_pct) : 0,
      taxa_flat_pct: b.taxa_flat_pct != null ? Number(b.taxa_flat_pct) : 0,
      montagem: b.montagem != null ? Number(b.montagem) : 0,
      servicos_adicionais: b.servicos_adicionais != null ? Number(b.servicos_adicionais) : 0
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
      motivo_perda_categoria: b.motivo_perda_categoria !== undefined ? b.motivo_perda_categoria : p.motivo_perda_categoria,
      motivo_perda_concorrente: b.motivo_perda_concorrente !== undefined ? b.motivo_perda_concorrente : p.motivo_perda_concorrente,
      motivo_perda_detalhe: b.motivo_perda_detalhe !== undefined ? b.motivo_perda_detalhe : p.motivo_perda_detalhe,
      caminho_local_calculadora: b.caminho_local_calculadora !== undefined ? b.caminho_local_calculadora : p.caminho_local_calculadora,
      updated_at: new Date().toISOString()
    };
    if (['negociando', 'concluido_ganho', 'concluido_perdido'].indexOf(novo.status) === -1) {
      return res.status(400).json({ erro: 'Status invalido' });
    }

    if (novo.status === 'concluido_perdido') {
      const categorias = ['valor', 'concorrencia', 'prazo_entrega', 'relacionamento', 'cancelado_cliente', 'outro'];
      if (categorias.indexOf(novo.motivo_perda_categoria) === -1) {
        return res.status(400).json({ erro: 'Informe o motivo da perda' });
      }
      if (novo.motivo_perda_categoria === 'concorrencia' && ['Valley', 'Bauer', 'Krebsfer', 'Focking'].indexOf(novo.motivo_perda_concorrente) === -1) {
        return res.status(400).json({ erro: 'Informe qual concorrente' });
      }
      if (novo.motivo_perda_categoria !== 'concorrencia') novo.motivo_perda_concorrente = null;
      if (novo.motivo_perda_categoria === 'outro' && !String(novo.motivo_perda_detalhe || '').trim()) {
        return res.status(400).json({ erro: 'Descreva o motivo' });
      }
      novo.concluido_em = p.concluido_em || new Date().toISOString();
    } else if (novo.status === 'concluido_ganho') {
      novo.motivo_perda_categoria = null;
      novo.motivo_perda_concorrente = null;
      novo.motivo_perda_detalhe = null;
      novo.concluido_em = p.concluido_em || new Date().toISOString();
    } else {
      novo.motivo_perda_categoria = null;
      novo.motivo_perda_concorrente = null;
      novo.motivo_perda_detalhe = null;
      novo.concluido_em = null;
    }

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
    const valorPivos = pivos.reduce(function (s, r) { return s + (Number(r.valor_negociado) || 0); }, 0);
    const { icmsPct, pisPct } = await getConstantesFiscais(p.estado);
    const montagemServicosTotal = calcularAncillaryGrossado(p, pisPct, icmsPct);
    const itensAdicionais = must(await supabase.from('itens_adicionais').select('*').eq('projeto_id', p.id).order('created_at'));
    const itensAdicionaisTotal = itensAdicionais.reduce(function (s, r) { return s + (Number(r.valor_calculado) || 0); }, 0);
    const valorTotal = valorPivos + montagemServicosTotal + itensAdicionaisTotal;
    const areaTotal = pivos.reduce(function (s, r) { return s + (Number(r.area_irrigada_ha) || 0); }, 0);
    const vendedor = p.vendedor_id ? must(await supabase.from('usuarios').select('nome,email').eq('id', p.vendedor_id).maybeSingle()) : null;

    // KPIs tecnicos agregados (pedido explicito: CV/kW total, adutora por
    // diametro+PN, bombas com eficiencia, perda de carga da parte aerea).
    const CV_PARA_KW = 0.735499;
    const potenciaTotalCV = pivos.reduce(function (s, r) { return s + (Number(r.potencia_motobomba_cv) || 0); }, 0);
    const perdasCarga = pivos.map(function (r) { return Number(r.perda_carga_parte_aerea_mca); }).filter(function (v) { return !isNaN(v) && v > 0; });
    const perdaCargaMedia = perdasCarga.length ? perdasCarga.reduce(function (a, b) { return a + b; }, 0) / perdasCarga.length : null;

    const adutoraMapa = {};
    pivos.forEach(function (piv) {
      (piv.adutora_trechos || []).forEach(function (t) {
        const chave = (t.diametro_nominal_mm || t.diametro_mm || '-') + '|' + (t.pn || '-');
        if (!adutoraMapa[chave]) adutoraMapa[chave] = { diametro_nominal_mm: t.diametro_nominal_mm || t.diametro_mm || null, pn: t.pn || null, comprimento_total_m: 0 };
        adutoraMapa[chave].comprimento_total_m += Number(t.comprimento_m) || 0;
      });
    });
    const adutoraAgregada = Object.values(adutoraMapa).sort(function (a, b) { return (b.diametro_nominal_mm || 0) - (a.diametro_nominal_mm || 0); });

    const bombaMapa = {};
    pivos.forEach(function (piv) {
      if (!piv.bomba_nome) return;
      if (!bombaMapa[piv.bomba_nome]) bombaMapa[piv.bomba_nome] = { nome: piv.bomba_nome, eficiencia_pct: piv.bomba_eficiencia_pct, qtde_pivos: 0 };
      bombaMapa[piv.bomba_nome].qtde_pivos += 1;
    });
    const bombas = Object.values(bombaMapa);
    const parcelas = must(await supabase.from('parcelas_pagamento').select('*').eq('projeto_id', p.id).order('ordem'));

    res.json({
      projeto: Object.assign({}, p, { vendedor_nome: vendedor ? vendedor.nome : null, vendedor_email: vendedor ? vendedor.email : null }),
      pivos: pivos,
      itens_adicionais: itensAdicionais,
      parcelas: parcelas,
      resumo: {
        qtde_pivos: pivos.length,
        valor_total: valorTotal,
        valor_pivos: valorPivos,
        montagem_servicos_total: montagemServicosTotal,
        itens_adicionais_total: itensAdicionaisTotal,
        area_total_ha: areaTotal,
        area_media_por_pivo_ha: pivos.length ? areaTotal / pivos.length : 0,
        custo_por_hectare_medio: areaTotal ? valorTotal / areaTotal : 0,
        potencia_total_cv: potenciaTotalCV,
        potencia_total_kw: potenciaTotalCV * CV_PARA_KW,
        perda_carga_parte_aerea_media_mca: perdaCargaMedia,
        adutora_agregada: adutoraAgregada,
        bombas: bombas
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

    // Regra do sistema: o arquivo nao e um link publico de nuvem que
    // qualquer um com acesso ao projeto pode baixar -- ele fica "local" (so
    // quem enviou tem acesso direto) e so passa a existir para outra pessoa
    // quando ela e o destinatario escolhido E aceita o envio (ver GET
    // /arquivos e /arquivos/:id/link abaixo). Por isso nao usamos mais
    // getPublicUrl -- guardamos so o caminho dentro do bucket, e o download
    // sempre passa por um link assinado de curta duracao, gerado so depois
    // de validar que quem esta pedindo pode mesmo ver este arquivo.
    const tipo = ['pivo', 'calculadora', 'outro', 'item_adicional'].indexOf(req.body.tipo) !== -1 ? req.body.tipo : 'pivo';
    const row = must(await supabase.from('arquivos').insert({
      projeto_id: projetoId,
      pivo_id: req.body.pivo_id || null,
      item_adicional_id: req.body.item_adicional_id || null,
      tipo: tipo,
      nome: nomeOriginal,
      caminho_storage: caminhoStorage,
      tamanho: req.file.size,
      mimetype: req.file.mimetype,
      enviado_por: req.usuario.id,
      destinatario_id: req.body.destinatario_id || null,
      status: req.body.destinatario_id ? 'pendente' : 'aceito'
    }).select().single());

    // Reenvio de versao: se alguem ja tinha ACEITO uma versao anterior
    // deste mesmo pivo, a nova versao reabre pendente pra essa(s) mesma(s)
    // pessoa(s) automaticamente -- ninguem aprova sem saber uma proposta
    // que ficou desatualizada. Nao duplica pra quem ja e o destinatario
    // escolhido manualmente nesse mesmo upload.
    if (row.pivo_id) {
      const aceitesAnteriores = must(await supabase.from('arquivos')
        .select('destinatario_id')
        .eq('pivo_id', row.pivo_id)
        .eq('status', 'aceito')
        .not('destinatario_id', 'is', null)
        .neq('id', row.id));
      const jaNotificar = new Set();
      if (row.destinatario_id) jaNotificar.add(row.destinatario_id);
      jaNotificar.add(req.usuario.id);
      const paraReabrir = Array.from(new Set(aceitesAnteriores.map(function (r) { return r.destinatario_id; })))
        .filter(function (id) { return !jaNotificar.has(id); });
      for (const destId of paraReabrir) {
        await supabase.from('arquivos').insert({
          projeto_id: projetoId,
          pivo_id: row.pivo_id,
          item_adicional_id: row.item_adicional_id,
          tipo: row.tipo,
          nome: row.nome,
          caminho_storage: row.caminho_storage,
          tamanho: row.tamanho,
          mimetype: row.mimetype,
          enviado_por: req.usuario.id,
          destinatario_id: destId,
          status: 'pendente'
        });
      }
    }

    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// So retorna os arquivos que o usuario logado tem o direito de ver: os que
// ele mesmo enviou, ou os que foram enviados PRA ele e ele ja aceitou. Ver
// acima a mesma regra -- acesso ao projeto (possoAcessarProjeto) mostra os
// dados/numeros do projeto, mas NAO da acesso automatico aos arquivos de
// quem nao enviou ou nao recebeu.
app.get('/arquivos', auth, async (req, res) => {
  try {
    if (!req.query.projeto_id) return res.status(400).json({ erro: 'Informe projeto_id' });
    if (!(await possoAcessarProjeto(req.usuario, req.query.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    const rows = must(await supabase.from('arquivos').select('id,projeto_id,pivo_id,tipo,nome,tamanho,mimetype,enviado_por,destinatario_id,status,created_at').eq('projeto_id', req.query.projeto_id).order('created_at', { ascending: false }));
    const meuId = req.usuario.id;
    const visiveis = rows.filter(function (a) {
      return a.enviado_por === meuId || (a.destinatario_id === meuId && a.status === 'aceito');
    });
    res.json(visiveis);
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// Gera um link de download de curta duracao (120s) -- so depois de
// confirmar que quem pediu enviou o arquivo ou e o destinatario que ja
// aceitou. Para arquivos antigos (de antes desta migracao, sem
// caminho_storage), cai de volta no link publico que ja existia.
app.get('/arquivos/:id/link', auth, async (req, res) => {
  try {
    const a = must(await supabase.from('arquivos').select('*').eq('id', req.params.id).maybeSingle());
    if (!a) return res.status(404).json({ erro: 'Arquivo nao encontrado' });
    const souQuemEnviou = a.enviado_por === req.usuario.id;
    // Pendente OU aceito: o destinatario precisa poder baixar/conferir o
    // arquivo no momento de decidir aceitar ou recusar, nao so depois.
    const souODestinatario = a.destinatario_id === req.usuario.id && (a.status === 'pendente' || a.status === 'aceito');
    if (!souQuemEnviou && !souODestinatario) return res.status(403).json({ erro: 'Este arquivo nao foi compartilhado com voce' });
    if (!(await possoAcessarProjeto(req.usuario, a.projeto_id))) return res.status(403).json({ erro: 'Sem permissao sobre este projeto' });
    if (!a.caminho_storage) {
      if (a.caminho) return res.json({ url: a.caminho });
      return res.status(404).json({ erro: 'Arquivo sem conteudo associado' });
    }
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(a.caminho_storage, 120);
    if (error) throw error;
    res.json({ url: data.signedUrl });
  } catch (e) {
    res.status(500).json({ erro: String((e && e.message) || e) });
  }
});

// ---------- APROVACOES ----------
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
    const itensAdicionais = projetoIds.length ? must(await supabase.from('itens_adicionais').select('projeto_id,valor_calculado').in('projeto_id', projetoIds)) : [];

    const total = projetos.length;
    const negociando = projetos.filter(function (p) { return p.status === 'negociando'; }).length;
    const concluidosGanho = projetos.filter(function (p) { return p.status === 'concluido_ganho'; }).length;
    const concluidosPerdido = projetos.filter(function (p) { return p.status === 'concluido_perdido'; }).length;
    const valorPivos = pivos.reduce(function (s, r) { return s + (Number(r.valor_negociado) || 0); }, 0);
    const valorItensAdicionais = itensAdicionais.reduce(function (s, r) { return s + (Number(r.valor_calculado) || 0); }, 0);
    // Montagem/Servicos Adicionais sao um total unico POR PROJETO -- soma o
    // ancillary de cada projeto (cada um com seu proprio ICMS por estado).
    let ancillaryTotal = 0;
    for (const proj of projetos) {
      const { icmsPct, pisPct } = await getConstantesFiscais(proj.estado);
      ancillaryTotal += calcularAncillaryGrossado(proj, pisPct, icmsPct);
    }
    const valorTotal = valorPivos + ancillaryTotal + valorItensAdicionais;
    const areaTotal = pivos.reduce(function (s, r) { return s + (Number(r.area_irrigada_ha) || 0); }, 0);

    res.json({
      kpis: {
        total: total,
        negociando: negociando,
        concluidos_ganho: concluidosGanho,
        concluidos_perdido: concluidosPerdido,
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
