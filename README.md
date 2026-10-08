# PIVOT Deal Manager WEB

Aplicacao web de gestao comercial com hierarquia **Diretor > Gerente > Vendedor**.

- **Backend:** Node.js + Express + SQLite
- **Frontend:** React 18 via CDN + Babel standalone (sem build)
- **Banco:** \`pivot.db\` (criado automaticamente na primeira execucao)
- **Uploads:** \`uploads/\` (via multer)

## Instalacao

\`\`\`bash
npm install
npm start
\`\`\`

Abra http://localhost:3000 — ou use o **INICIAR.bat** (clique duplo).

Requisitos: Node.js 18+ (testado com Node 20/22).

## Usuarios de teste (13 pessoas)

Senha de **todos**: \`123456\`

| Nivel | Quantidade | E-mails |
|---|---|---|
| Diretor | 1 | silvio@pivot.com |
| Gerente | 2 | marta@pivot.com, roberto@pivot.com |
| Vendedor | 10 | ana@, bruno@, carla@, diego@, elisa@ (equipe Marta) e fabio@, gisele@, heitor@, iris@, joao@pivot.com (equipe Roberto) |

> Observacao de escopo: o pedido original citava "13 pessoas (1 diretor + 2 gerentes + 8+4 vendedores)".
> A conta 8+4 daria 15 no total; foi implementado o **total de 13** (1 + 2 + 10). Para acrescentar
> vendedores, basta incluir entradas no array \`SEED\` em \`server.js\` e apagar o \`pivot.db\`.

## Features por nivel

| Recurso | Diretor | Gerente | Vendedor |
|---|---|---|---|
| Ver todos os projetos | sim | nao (so a propria equipe) | nao (so os proprios) |
| Criar projeto | sim | sim | sim |
| Editar projeto | sim | sim (equipe) | sim (proprios) |
| Aprovar / reprovar | sim | sim (equipe) | nao |
| Excluir projeto | sim | nao | nao |
| Ver usuarios | todos | propria equipe | nao |
| KPIs do dashboard | globais | da equipe | proprios |

## KPIs expostos em /dashboard

\`total\`, \`em_negociacao\`, \`aprovados\`, \`valor_total\`, \`margem_media\`.

## API

| Metodo | Rota | Descricao |
|---|---|---|
| POST | /login | \`{ email, senha }\` -> \`{ token, usuario }\` |
| POST | /logout | encerra a sessao |
| GET/POST | /usuarios/setup | cria tabelas e popula os 13 usuarios (idempotente) |
| GET | /usuarios | usuarios visiveis ao nivel |
| GET/POST | /projetos | lista (com escopo) / cria |
| PUT | /projetos/:id | atualiza dados e status |
| DELETE | /projetos/:id | somente diretor |
| POST | /arquivos | upload (multipart, campo \`arquivo\` + \`projeto_id\`) |
| GET | /arquivos?projeto_id= | lista anexos |
| POST | /aprovacoes | \`{ projeto_id, decisao, comentario }\` (gerente/diretor) |
| GET | /aprovacoes | historico |
| GET | /dashboard | KPIs no escopo do usuario |

Autenticacao: header \`Authorization: Bearer <token>\`.

## Banco (SQLite)

4 tabelas: \`usuarios\`, \`projetos\`, \`arquivos\`, \`aprovacoes\`.
Senhas sao gravadas com salt aleatorio + SHA-256 (nunca em texto puro).

## Deploy no Vercel

O frontend (\`index.html\`) e estatico e pode ser servido pelo Vercel sem ajustes.
O **backend Express + SQLite nao roda no Vercel** no formato serverless: o sistema de arquivos e
efemero e somente leitura, entao \`pivot.db\` e \`uploads/\` se perdem a cada deploy.
Opcoes praticas:

1. **Recomendado (mais simples):** hospedar o backend em um servico com disco persistente
   (Render, Railway, Fly.io) e apontar o frontend para essa URL — troque a constante
   \`API\` em \`index.html\` pela URL do backend.
2. **Vercel + banco gerenciado:** trocar SQLite por Postgres/Supabase (Vercel Postgres,
   Neon, Supabase) — exige refatorar \`server.js\` e usar \`/api\` serverless functions.
3. **Somente demonstracao local:** usar \`INICIAR.bat\` (Windows) ou \`npm start\`.

## Seguranca (importante)

- A senha \`123456\` e **de demonstracao**. Troque as senhas antes de qualquer uso real.
- Nao versione \`.env\`, \`pivot.db\` nem \`uploads/\` (ja no \`.gitignore\`).
- A autenticacao usa token em memoria: reiniciar o servidor invalida as sessoes.

## Estrutura

\`\`\`
vendas_pivot/
  server.js             API Express + SQLite
  index.html            SPA React (CDN) — login + dashboard
  package.json
  .gitignore
  README.md
  INICIAR.bat           roda o servidor local
  FAZER_PUSH.bat        envia para o GitHub
  SOLUCIONAR_ERROS.md   troubleshooting
\`\`\`
