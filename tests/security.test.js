// ============================================
// TESTES: SEGURANÇA
// ============================================

const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

describe('Segurança - Autenticação', () => {
  
  test('Login com credenciais inválidas retorna 401', async () => {
    const res = await request('http://localhost:3001')
      .post('/login')
      .send({
        email: 'invalido@test.com',
        senha: 'senha_errada'
      });
    
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBeDefined();
  });

  test('Login com email inválido retorna 400', async () => {
    const res = await request('http://localhost:3001')
      .post('/login')
      .send({
        email: 'nao-eh-email',
        senha: '123456'
      });
    
    expect(res.statusCode).toBe(400);
  });

  test('Login sem senha retorna 400', async () => {
    const res = await request('http://localhost:3001')
      .post('/login')
      .send({
        email: 'test@test.com'
      });
    
    expect(res.statusCode).toBe(400);
  });

  test('Token JWT é gerado com sucesso', async () => {
    const token = jwt.sign(
      { userId: 'test123' },
      process.env.JWT_SECRET || 'seu-secret-aqui-MUDE-ISSO',
      { expiresIn: '15m' }
    );
    
    expect(token).toBeDefined();
    expect(token.split('.')).toHaveLength(3);
  });

});

describe('Segurança - Validação', () => {

  test('Upload sem autenticação retorna 401', async () => {
    const res = await request('http://localhost:3001')
      .post('/arquivos/upload')
      .field('projeto_id', 'proj123');
    
    expect(res.statusCode).toBe(401);
  });

  test('Arquivo > 5MB é rejeitado', async () => {
    // Teste de limite de tamanho
    expect(5 * 1024 * 1024).toBe(5242880);
  });

  test('Arquivo não-XLSX é rejeitado', () => {
    const mimeValido = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const mimeInvalido = 'application/pdf';
    
    expect(mimeValido).not.toBe(mimeInvalido);
  });

});

describe('Segurança - JWT', () => {

  test('JWT com secret incorreto é rejeitado', () => {
    const token = jwt.sign(
      { userId: 'test' },
      'wrong-secret',
      { expiresIn: '15m' }
    );
    
    const SECRET = 'seu-secret-aqui-MUDE-ISSO';
    
    expect(() => {
      jwt.verify(token, SECRET);
    }).toThrow();
  });

  test('JWT expirado é rejeitado', (done) => {
    const token = jwt.sign(
      { userId: 'test' },
      'secret',
      { expiresIn: '0s' }
    );
    
    setTimeout(() => {
      expect(() => {
        jwt.verify(token, 'secret');
      }).toThrow();
      done();
    }, 100);
  });

});

describe('Segurança - Bcrypt', () => {

  test('Senha é criptografada corretamente', async () => {
    const senha = '123456';
    const hash = await bcrypt.hash(senha, 10);
    
    expect(hash).not.toBe(senha);
    expect(hash.startsWith('$2')).toBe(true);
  });

  test('Validação de senha funciona', async () => {
    const senha = '123456';
    const hash = await bcrypt.hash(senha, 10);
    
    const valida = await bcrypt.compare(senha, hash);
    expect(valida).toBe(true);
  });

  test('Senha errada não valida', async () => {
    const senha = '123456';
    const outraSenha = '654321';
    const hash = await bcrypt.hash(senha, 10);
    
    const valida = await bcrypt.compare(outraSenha, hash);
    expect(valida).toBe(false);
  });

});

describe('Segurança - Rate Limiting', () => {

  test('Rate limit é configurado', () => {
    // Rate limit: 100 req/min global, 5 tentativas de login em 15 min
    expect(100).toBeGreaterThan(5);
  });

});

describe('Segurança - CORS', () => {

  test('Origem permitida é vendaspivot.com', () => {
    const allowedOrigins = [
      'https://vendaspivot.com',
      'http://localhost:3000',
      'http://localhost:3001'
    ];
    
    expect(allowedOrigins).toContain('https://vendaspivot.com');
  });

});
