# SOLUCIONAR_ERROS.md — PIVOT Deal Manager WEB

## 1. "node nao e reconhecido"
Instale o Node.js 18+ (https://nodejs.org) e **reabra** o terminal.
Confirme com: \`node --version\` e \`npm --version\`.

## 2. Falha ao instalar o \`sqlite3\` (node-gyp / compilador)
Sintoma: \`gyp ERR!\` ou \`MSBuild\` ausente.
E necessario o Visual Studio Build Tools (C++) **ou** usar binario pre-compilado.

Opcao A (mais simples) — trocar por \`better-sqlite3\`:
\`\`\`bash
npm remove sqlite3
npm install better-sqlite3
\`\`\`
E no \`server.js\` trocar as 3 primeiras linhas do banco por:
\`\`\`js
const Database = require('better-sqlite3');
const db = new Database(DB_FILE);
\`\`\`
(atencao: a API de consultas muda — \`db.prepare(...).all()\` em vez de callbacks).

Opcao B — instalar as Build Tools:
\`\`\`powershell
npm install --global --production windows-build-tools
:: ou instale "Desktop development with C++" no Visual Studio Installer
\`\`\`

Opcao C (mais rapido, zero dependencia nativa) — usar \`node:sqlite\` (Node 22+):
\`\`\`js
const { DatabaseSync } = require('node:sqlite');
\`\`\`

## 3. Porta 3000 ocupada
\`\`\`powershell
netstat -ano | findstr :3000
taskkill /PID <numero> /F
\`\`\`
Ou rode em outra porta: \`set PORT=4000 && npm start\`.

## 4. Login retorna "Email ou senha invalidos"
- O banco precisa existir/popular: abra \`http://localhost:3000/usuarios/setup\` uma vez.
- Se alterou o \`SEED\`, apague \`pivot.db\` e reinicie (o seed so roda com a tabela vazia).
- Confira se digitou o e-mail exatamente como no README.

## 5. Dashboard vazio
Vendedor ve apenas os proprios projetos e gerente apenas a propria equipe — se ainda nao houver
projetos, crie um em "Novo projeto".

## 6. Falha no \`git push\` (FAZER_PUSH.bat)
- O GitHub **nao aceita mais senha** no push por HTTPS: use **Personal Access Token (classico,
  escopo \`repo\`)** ou GitHub CLI (\`gh auth login\`).
- Se o Git abrir uma janela pedindo senha, cole o **token** no lugar da senha.
- \`remote origin already exists\` — o script remove e recria o remote automaticamente.
- \`failed to push some refs\` — o repositorio remoto tem commits:
  \`\`\`bash
  git pull --rebase origin main
  git push -u origin main
  \`\`\`
- \`403\` / \`Permission denied\` — confirme que esta autenticado como **TLopes81**
  (\`git config user.name\` / \`gh auth status\`) e que o repo existe.

## 7. Onde ficam os dados
- Banco: \`pivot.db\` na raiz do projeto (ignorado pelo Git).
- Arquivos enviados: \`uploads/\` (ignorado pelo Git).
- Apagar o \`pivot.db\` reseta tudo (tabelas + 13 usuarios).

## 8. Sessoes caem sozinhas
A autenticacao usa token **em memoria**: reiniciar o servidor exige novo login.
Para persistir sessoes seria necessario gravar tokens em tabela (nao incluido).
