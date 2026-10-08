# 🗄️ CRIAR ESTRUTURA DO BANCO SUPABASE

**Seu banco está vazio. Vamos preencher agora!**

---

## 📋 ARQUIVO SQL PRONTO

Arquivo: `init-supabase.sql`

Contém:
- ✅ 5 tabelas (usuarios, projetos, arquivos, aprovacoes, notificacoes)
- ✅ Índices para performance
- ✅ 13 usuários de teste (1 diretor + 2 gerentes + 12 vendedores)
- ✅ Políticas de segurança (Row Level Security)

---

## 🚀 PASSO A PASSO

### 1️⃣ Abra Supabase

Acesse: https://supabase.com

Faça login → seu projeto `vendas-pivot`

### 2️⃣ Vá para SQL Editor

Na sidebar, clique: **SQL Editor**

Clique: **"New Query"**

### 3️⃣ Cole o SQL completo

Abra o arquivo: `init-supabase.sql`

Copie TODO o conteúdo

Cole no editor do Supabase

### 4️⃣ Execute

Clique no botão **"Run"** (ou Ctrl+Enter)

**Aguarde 5-10 segundos** ⏳

### 5️⃣ Verificar

Quando terminar, você deve ver:

```
✅ CREATE TABLE usuarios
✅ CREATE TABLE projetos
✅ CREATE TABLE arquivos
✅ CREATE TABLE aprovacoes
✅ CREATE TABLE notificacoes
✅ 13 usuários inseridos
```

---

## ✅ PRONTO!

Seu banco agora tem:
- ✅ Tabelas criadas
- ✅ Índices otimizados
- ✅ 13 usuários prontos para testar
- ✅ Segurança configurada

---

## 🔑 PRÓXIMO PASSO

Copiar credenciais Supabase para arquivo `.env`:

### No Supabase:

1. **Settings → General**
   - Copie: **Project URL** → `SUPABASE_URL`

2. **Settings → API**
   - Copie: **anon** key → `SUPABASE_ANON_KEY`
   - Copie: **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`

3. **Settings → Database**
   - Copie: **URI** → `DATABASE_URL`

### No seu PC:

Crie arquivo: `C:\Users\lopes\Documents\Projetos\vendas_pivot\.env`

Cole as credenciais (use `.env.example` como template)

---

## 🎉 PRONTO!

Seu banco Supabase está 100% estruturado e pronto para rodar!

Próximo: Fazer deploy no Railway com essas credenciais ✨
