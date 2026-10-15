const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const jwtSecret = process.env.JWT_SECRET;

const supabase = createClient(supabaseUrl, supabaseKey);

const usuarios = [
  { id: 1, nome: 'Silvio', email: 'silvio@pivot.com', nivel: 'diretor' },
  { id: 2, nome: 'Tiago Lopes', email: 'tiago@pivot.com', nivel: 'gerente', regiao: ['R1', 'R2'] },
  { id: 3, nome: 'João Morais', email: 'joao@pivot.com', nivel: 'gerente', regiao: ['R3'] },
];

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/auth') {
    const { email, senha } = req.body;

    const usuario = usuarios.find(u => u.email === email);
    if (!usuario || senha !== '123456') {
      return res.status(401).json({ message: 'Email ou senha incorretos' });
    }

    const token = jwt.sign({ id: usuario.id, email: usuario.email, nivel: usuario.nivel }, jwtSecret, { expiresIn: '24h' });

    return res.status(200).json({
      token,
      usuario: {
        id: usuario.id,
        nome: usuario.nome,
        email: usuario.email,
        nivel: usuario.nivel,
      }
    });
  }

  if (req.url === '/api/health') {
    return res.status(200).json({ status: 'OK' });
  }

  res.status(404).json({ message: 'Route not found' });
};
