# 🌐 PIVOT Deal Manager - WEB

**Sistema centralizad de gestão de propostas com hierarquia: Diretor → Gerentes → Vendedores**

---

## 🎯 Estrutura

```
SILVIO (Diretor)
├─ Tiago Lopes (Gerente) - 8 vendedores
└─ João Batista (Gerente) - 4 vendedores

Total: 13 pessoas
```

---

## 🚀 INSTALAÇÃO E EXECUÇÃO

### Passo 1: Instalar Node.js
https://nodejs.org/

### Passo 2: Navegar até a pasta
```bash
cd pivot-web
```

### Passo 3: Instalar dependências
```bash
npm install
```

### Passo 4: Rodar o servidor
```bash
npm start
```

### Passo 5: Abrir no navegador
```
http://localhost:3000
```

---

## 👥 USUÁRIOS DE TESTE

### Login padrão:
```
Email: silvio@pivot.com
Senha: 123456
```

### Todos os usuários:

**Diretor:**
- silvio@pivot.com / 123456 (vê TUDO)

**Gerentes:**
- tiago@pivot.com / 123456 (vê 8 vendedores)
- joao@pivot.com / 123456 (vê 4 vendedores)

**8 Vendedores (Tiago):**
- v1@pivot.com → v8@pivot.com (senha: 123456)

**4 Vendedores (João):**
- v9@pivot.com → v12@pivot.com (senha: 123456)

---

## 📊 FUNCIONALIDADES

### Silvio (Diretor)
✅ Vê TUDO de todos (Tiago + João + todos os 12 vendedores)
✅ Dashboard executivo com KPIs globais
✅ Pode aprovar/rejeitar qualquer proposta
✅ Relatório consolidado

### Tiago / João (Gerentes)
✅ Vê SÓ seus vendedores
✅ Dashboard gerencial com KPIs dos seus
✅ Aprova/rejeita propostas deles
✅ Pode comentar e dar feedback

### Vendedores
✅ Vê SÓ suas propostas
✅ Faz upload de planilhas Excel
✅ Compartilha com gerente automaticamente
✅ Recebe aprovação/feedback em tempo real

---

## 🔄 FLUXO DE UMA PROPOSTA

```
1. VENDEDOR CARLOS (de Tiago)
   ├─ Faz upload de proposta
   └─ Gerente Tiago VIRA notificação

2. TIAGO (Gerente de Carlos)
   ├─ Vê proposta no seu dashboard
   ├─ Avalia (aprova ou pede mudança)
   └─ Diretor Silvio VIRA notificação

3. SILVIO (Diretor)
   ├─ Se Tiago aprovou, vê na fila
   ├─ Aprova final
   └─ Autoriza envio ao cliente

4. CARLOS (Vendedor)
   ├─ Recebe notificação: "Aprovado!"
   └─ Envia ao cliente
```

---

## 📁 ESTRUTURA DE PASTAS

```
pivot-web/
├─ server.js           ← Backend (Node.js + Express)
├─ index.html          ← Frontend (React)
├─ package.json        ← Dependências
├─ pivot.db            ← Banco de dados (criado automático)
├─ uploads/            ← Arquivos enviados
└─ README.md           ← Este arquivo
```

---

## 🔧 API ENDPOINTS

### Autenticação
```
POST /api/login
  → Email + Senha → Retorna usuário
```

### Projetos
```
POST /api/projetos
  → Criar novo projeto

GET /api/projetos/:usuario_id/:nivel
  → Listar projetos (com permissões)
```

### Arquivos
```
POST /api/arquivos/:projeto_id
  → Upload de arquivo

GET /api/arquivos/:projeto_id
  → Listar arquivos/versões
```

### Dashboard
```
GET /api/dashboard/:usuario_id/:nivel
  → KPIs e estatísticas
```

---

## 🌍 DEPLOY (Opcional)

Quando quiser colocar online para acessar de qualquer lugar:

### Opção 1: Railway (Gratuito)
```bash
npm install -g railway
railway login
railway init
railway up
```

### Opção 2: Vercel + Netlify
```bash
# Frontend no Netlify
# Backend no Vercel

npm run build
vercel --prod
```

---

## 🐛 TROUBLESHOOTING

### "Porta 3000 já está em uso"
```bash
# Matar processo na porta 3000
lsof -i :3000
kill -9 <PID>
```

### "npm: command not found"
Instale Node.js: https://nodejs.org/

### "Banco de dados não foi criado"
Delete `pivot.db` e reinicie (vai criar novamente)

---

## 📞 SUPORTE

Tem dúvida? Pergunte!

---

**Versão**: 1.0
**Data**: 2026-10-08
