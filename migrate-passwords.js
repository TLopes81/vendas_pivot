// ============================================
// MIGRAÇÃO: Hash de Senhas Plain Text → Bcrypt
// ============================================
// EXECUTAR UMA VEZ: node migrate-passwords.js

const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function migratePasswords() {
  console.log('🔄 Iniciando migração de senhas...\n');

  try {
    // Buscar todos os usuários
    const { data: usuarios, error: selectError } = await supabase
      .from('usuarios')
      .select('id, email, senha');

    if (selectError) throw selectError;

    console.log(`📋 Encontrados ${usuarios.length} usuários\n`);

    let migrados = 0;
    let erros = 0;

    for (const usuario of usuarios) {
      try {
        // Verificar se já é hash (bcrypt começa com $2a$, $2b$ ou $2y$)
        if (usuario.senha.startsWith('$2')) {
          console.log(`⏭️  ${usuario.email} - já está com hash`);
          continue;
        }

        // Fazer hash da senha
        const senhaHash = await bcrypt.hash(usuario.senha, 10);

        // Atualizar no banco
        const { error: updateError } = await supabase
          .from('usuarios')
          .update({ senha: senhaHash })
          .eq('id', usuario.id);

        if (updateError) throw updateError;

        console.log(`✅ ${usuario.email} - migrado com sucesso`);
        migrados++;

      } catch (err) {
        console.log(`❌ ${usuario.email} - ERRO: ${err.message}`);
        erros++;
      }
    }

    console.log(`\n📊 RESUMO:`);
    console.log(`   ✅ Migrados: ${migrados}`);
    console.log(`   ❌ Erros: ${erros}`);
    console.log(`   ⏭️  Já com hash: ${usuarios.length - migrados - erros}`);

    if (erros === 0) {
      console.log(`\n🎉 Migração completa com sucesso!`);
      process.exit(0);
    } else {
      console.log(`\n⚠️  Migração com erros`);
      process.exit(1);
    }

  } catch (err) {
    console.error('❌ Erro na migração:', err.message);
    process.exit(1);
  }
}

migratePasswords();
