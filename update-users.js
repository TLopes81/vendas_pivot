const { Client } = require('pg');
const bcrypt = require('bcrypt');
const fs = require('fs');

const envContent = fs.readFileSync('.env', 'utf-8');
const DATABASE_URL = envContent.match(/DATABASE_URL=(.+)/)[1].trim();

const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    await client.connect();
    console.log('Atualizando nomes de vendedores...\n');

    const updates = [
      { id: 'thiago_h', nome: 'Thiago Henrique' },
      { id: 'itamar', nome: 'Itamar' },
      { id: 'iury', nome: 'Iury Hudson' },
      { id: 'doris', nome: 'Doris' },
      { id: 'arthur', nome: 'Arthur' },
      { id: 'henrique', nome: 'Henrique' },
      { id: 'ruitte', nome: 'Ruitte' },
      { id: 'paulo', nome: 'Paulo' },
      { id: 'luismael', nome: 'Luismael' },
      { id: 'gerson', nome: 'Gerson' },
      { id: 'isabella', nome: 'Isabella' },
      { id: 'felipe', nome: 'Felipe' },
      { id: 'tocantins', nome: 'Tocantins' }
    ];

    for (const u of updates) {
      await client.query('UPDATE usuarios SET nome = $1 WHERE id = $2', [u.nome, u.id]);
      console.log('[OK] ' + u.nome);
    }
    
    console.log('\nSucesso! Vendedores atualizados');
  } catch(e) {
    console.error('Erro:', e.message);
  } finally {
    await client.end();
  }
})();
