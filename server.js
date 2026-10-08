// ============================================
// PIVOT Deal Manager - Backend Seguro
// Tech Lead Implementation
// ============================================

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const Joi = require('joi');
const winston = require('winston');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURAÇÃO SEGURA
// ============================================

const app = express();

// Logger estruturado (Winston)
const logger = winston.createLogger({
  format: winston.format.json(),
  defaultMeta: { service: 'pivot-backend' },
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Criar pasta de logs se não existir
if (!fs.existsSync('logs')) {
  fs.mkdirSync('logs');
}

// ============================================
// SUPABASE INIT
// ============================================

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// ============================================
// SEGURANÇA: CORS RESTRITIVO
// ============================================

const allowedOrigins = [
  'https://vendaspivot.com',
  'http://localhost:3000',
  'http://localhost:3001',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS bloqueado', { origin });
      callback(new Error('CORS policy violation'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// ============================================
// MIDDLEWARE SEGURANÇA
// ============================================

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Rate limiting global
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: 'Muitas requisições, aguarde um pouco',
  standardHeaders: true,
  legacyHeaders: false
});
app.use(globalLimiter);

// Rate limiting específico para login
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Muitas tentativas de login, aguarde 15 minutos',
  skipSuccessfulRequests: true
});

// ============================================
// MULTER - UPLOAD SEGURO
// ============================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/temp';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const sanitized = file.originalname
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .slice(0, 50);
    cb(null, `${Date.now()}-${uuidv4()}-${sanitized}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedMimes = ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
  const allowedExtensions = ['.xlsx'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedMimes.includes(file.mimetype) && allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    logger.warn('Upload bloqueado - tipo inválido', {
      user: req.userId,
      mimetype: file.mimetype,
      originalname: file.originalname
    });
    cb(new Error('Apenas arquivos .xlsx são permitidos'));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024
  }
});

// ============================================
// VALIDAÇÃO COM JOI
// ============================================

const schemas = {
  login: Joi.object({
    email: Joi.string().email().required().messages({
      'string.email': 'Email inválido',
      'any.required': 'Email é obrigatório'
    }),
    senha: Joi.string().min(6).required().messages({
      'string.min': 'Senha deve ter no mínimo 6 caracteres',
      'any.required': 'Senha é obrigatória'
    })
  }),

  projeto: Joi.object({
    cliente: Joi.string().max(100).required(),
    fazenda: Joi.string().max(100).required(),
    valor: Joi.number().positive().precision(2),
    desconto: Joi.number().min(0).max(100),
    observacoes: Joi.string().max(500)
  }),

  upload: Joi.object({
    projeto_id: Joi.string().required()
  })
};

// ============================================
// AUTENTICAÇÃO JWT
// ============================================

const JWT_SECRET = process.env.JWT_SECRET || 'seu-secret-aqui-MUDE-ISSO';
const JWT_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '7d';

const generateTokens = (userId) => {
  const token = jwt.sign(
    { userId, type: 'access' },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  const refreshToken = jwt.sign(
    { userId, type: 'refresh' },
    JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );

  return { token, refreshToken };
};

// Middleware: verificar JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    logger.warn('Acesso negado - sem token', { ip: req.ip });
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      logger.warn('Token inválido', { ip: req.ip, error: err.message });
      return res.status(403).json({ error: 'Token inválido' });
    }

    req.userId = decoded.userId;
    next();
  });
};

// ============================================
// ROTAS: AUTENTICAÇÃO
// ============================================

app.post('/login', loginLimiter, async (req, res) => {
  try {
    const { error, value } = schemas.login.validate(req.body);
    if (error) {
      logger.warn('Validação falhou no login', { 
        error: error.details[0].message,
        email: req.body.email 
      });
      return res.status(400).json({ error: error.details[0].message });
    }

    const { email, senha } = value;

    const { data: usuarios, error: dbError } = await supabase
      .from('usuarios')
      .select('*')
      .eq('email', email)
      .single();

    if (dbError || !usuarios) {
      logger.warn('Login falhou - usuário não encontrado', { email });
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const senhaValida = await bcrypt.compare(senha, usuarios.senha);

    if (!senhaValida) {
      logger.warn('Login falhou - senha incorreta', { email });
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    if (!usuarios.ativo) {
      logger.warn('Login falhou - usuário inativo', { email });
      return res.status(403).json({ error: 'Usuário inativo' });
    }

    const { token, refreshToken } = generateTokens(usuarios.id);

    logger.info('Login bem-sucedido', {
      userId: usuarios.id,
      email: usuarios.email,
      nivel: usuarios.nivel
    });

    res.json({
      token,
      refreshToken,
      usuario: {
        id: usuarios.id,
        nome: usuarios.nome,
        email: usuarios.email,
        nivel: usuarios.nivel
      }
    });

  } catch (err) {
    logger.error('Erro no login', { error: err.message });
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

app.post('/refresh-token', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(401).json({ error: 'Refresh token não fornecido' });
    }

    jwt.verify(refreshToken, JWT_SECRET, (err, decoded) => {
      if (err) {
        logger.warn('Refresh token inválido', { error: err.message });
        return res.status(403).json({ error: 'Refresh token expirado' });
      }

      const { token: newToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);

      res.json({
        token: newToken,
        refreshToken: newRefreshToken
      });
    });

  } catch (err) {
    logger.error('Erro ao refreshar token', { error: err.message });
    res.status(500).json({ error: 'Erro ao refreshar token' });
  }
});

// ============================================
// ROTAS: PROJETOS
// ============================================

app.get('/projetos', authenticateToken, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nivel, gerente_id')
      .eq('id', req.userId)
      .single();

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let query = supabase
      .from('projetos')
      .select('id, cliente, fazenda, status, valor, margem, data_criacao', { count: 'exact' });

    if (usuario.nivel === 'diretor') {
      // Diretor vê tudo
    } else if (usuario.nivel === 'gerente') {
      query = query.eq('gerente_id', req.userId);
    } else {
      query = query.eq('vendedor_id', req.userId);
    }

    const { data, count, error } = await query
      .order('data_criacao', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    logger.info('Projetos listados', {
      userId: req.userId,
      count: count,
      page: page
    });

    res.json({
      data,
      totalPages: Math.ceil(count / limit),
      currentPage: page,
      total: count
    });

  } catch (err) {
    logger.error('Erro ao listar projetos', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Erro ao listar projetos' });
  }
});

// ============================================
// ROTAS: UPLOAD DE ARQUIVOS
// ============================================

app.post('/arquivos/upload', authenticateToken, upload.single('arquivo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Nenhum arquivo foi enviado' });
    }

    const { error, value } = schemas.upload.validate(req.body);
    if (error) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: error.details[0].message });
    }

    const { projeto_id } = value;

    const { data: projeto } = await supabase
      .from('projetos')
      .select('*')
      .eq('id', projeto_id)
      .single();

    if (!projeto) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    if (projeto.vendedor_id !== req.userId && projeto.gerente_id !== req.userId) {
      fs.unlinkSync(req.file.path);
      logger.warn('Upload bloqueado - sem permissão', {
        userId: req.userId,
        projeto_id
      });
      return res.status(403).json({ error: 'Sem permissão para este projeto' });
    }

    const { data: arquivos, error: countError } = await supabase
      .from('arquivos')
      .select('versao')
      .eq('projeto_id', projeto_id)
      .order('versao', { ascending: false })
      .limit(1);

    if (countError) throw countError;

    const proximaVersao = arquivos.length > 0 ? arquivos[0].versao + 1 : 1;

    const { data: arquivo, error: insertError } = await supabase
      .from('arquivos')
      .insert([{
        id: uuidv4(),
        projeto_id,
        nome: req.file.originalname,
        versao: proximaVersao,
        tamanho: req.file.size,
        url: `/uploads/${req.file.filename}`,
        caminho: req.file.path,
        uploaded_by: req.userId,
        data_upload: new Date().toISOString()
      }])
      .select()
      .single();

    if (insertError) throw insertError;

    logger.info('Arquivo uploadado com sucesso', {
      userId: req.userId,
      projeto_id,
      arquivo: req.file.originalname,
      versao: proximaVersao,
      tamanho: req.file.size
    });

    res.json({
      message: 'Upload realizado com sucesso',
      arquivo: {
        id: arquivo.id,
        versao: arquivo.versao,
        nome: arquivo.nome,
        tamanho: arquivo.tamanho,
        dataUpload: arquivo.data_upload
      }
    });

  } catch (err) {
    if (req.file) {
      fs.unlinkSync(req.file.path);
    }
    logger.error('Erro ao fazer upload', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Erro ao fazer upload' });
  }
});

// ============================================
// ROTAS: DASHBOARD
// ============================================

app.get('/dashboard', authenticateToken, async (req, res) => {
  try {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nivel')
      .eq('id', req.userId)
      .single();

    if (!usuario) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    let query = supabase.from('projetos').select('*');

    if (usuario.nivel === 'vendedor') {
      query = query.eq('vendedor_id', req.userId);
    } else if (usuario.nivel === 'gerente') {
      query = query.eq('gerente_id', req.userId);
    }

    const { data: projetos, error } = await query;

    if (error) throw error;

    const totalProjetos = projetos.length;
    const emNegociacao = projetos.filter(p => p.status === 'em_negociacao').length;
    const aprovados = projetos.filter(p => p.status === 'aprovado').length;
    const perdidos = projetos.filter(p => p.status === 'perdido').length;

    const valorTotal = projetos.reduce((sum, p) => sum + (p.valor || 0), 0);
    const margensValidas = projetos.filter(p => p.margem).map(p => p.margem);
    const margemMedia = margensValidas.length > 0
      ? margensValidas.reduce((a, b) => a + b) / margensValidas.length
      : 0;

    logger.info('Dashboard acessado', {
      userId: req.userId,
      totalProjetos,
      nivel: usuario.nivel
    });

    res.json({
      kpis: {
        totalProjetos,
        emNegociacao,
        aprovados,
        perdidos,
        valorTotal: parseFloat(valorTotal.toFixed(2)),
        margemMedia: parseFloat(margemMedia.toFixed(2))
      },
      projetos
    });

  } catch (err) {
    logger.error('Erro ao carregar dashboard', { error: err.message, userId: req.userId });
    res.status(500).json({ error: 'Erro ao carregar dashboard' });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
  try {
    const { error } = await supabase
      .from('usuarios')
      .select('id')
      .limit(1);

    if (error) throw error;

    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected'
    });
  } catch (err) {
    logger.error('Health check falhou', { error: err.message });
    res.status(503).json({
      status: 'error',
      message: 'Database connection failed',
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// ERROR HANDLING GLOBAL
// ============================================

app.use((err, req, res, next) => {
  logger.error('Erro não tratado', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.userId
  });

  if (err.message.includes('CORS')) {
    return res.status(403).json({ error: 'CORS policy violation' });
  }

  if (err.message === 'Apenas arquivos .xlsx são permitidos') {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Arquivo muito grande (máximo 5MB)' });
  }

  res.status(500).json({
    error: 'Erro interno do servidor',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// ============================================
// 404 HANDLER
// ============================================

app.use((req, res) => {
  logger.warn('Rota não encontrada', { path: req.path, method: req.method });
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  logger.info(`Servidor iniciado na porta ${PORT}`);
  logger.info(`Ambiente: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
