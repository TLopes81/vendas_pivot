# 🔧 SOLUÇÃO DE PROBLEMAS

## ❌ Erro: "Não é possível acessar esse site"

**Significa:** O servidor não está rodando.

### Solução 1: Instalar Node.js

1. Acesse: https://nodejs.org/
2. Baixe a versão **LTS** (recomendado)
3. Execute o instalador
4. **REINICIE O COMPUTADOR**
5. Tente novamente: clique duplo em `INICIAR.bat`

### Solução 2: Rodar manualmente (se ainda não funcionar)

1. Abra o **Prompt de Comando** (cmd.exe)
2. Navegue até a pasta:
   ```bash
   cd C:\caminho\para\pivot-web
   ```
3. Digite:
   ```bash
   npm install
   ```
4. Aguarde terminar
5. Digite:
   ```bash
   npm start
   ```
6. Vá para: http://localhost:3000

### Solução 3: Verificar se Node.js está instalado

Abra o **Prompt de Comando** e digite:
```bash
node --version
```

Se aparecer um número (ex: `v18.0.0`), Node.js está ok.
Se der erro, instale Node.js.

---

## ❌ Erro: "Porta 3000 já está em uso"

**Significa:** Outro programa está usando a porta 3000.

### Solução:

Abra o **Prompt de Comando** e digite:
```bash
netstat -ano | findstr :3000
```

Vai aparecer um número (PID). Digite:
```bash
taskkill /PID [NÚMERO] /F
```

Agora tente iniciar novamente.

---

## ❌ Erro: "npm: command not found"

**Significa:** Node.js não está no PATH.

### Solução:

1. **Reinstale Node.js** (https://nodejs.org/)
2. **REINICIE O COMPUTADOR**
3. Tente novamente

---

## ❌ "Servidor inicia mas página fica vazia"

**Significa:** Frontend não carregou.

### Solução:

1. Feche o navegador
2. Abra as ferramentas de desenvolvedor: **F12**
3. Clique em **Console**
4. Procure por erros em vermelho
5. Se tem erro, me avisa o texto!

---

## ❌ "Consigo entrar mas não funciona nada"

**Significa:** Backend não está respondendo.

### Solução:

1. Abra o **Prompt de Comando**
2. Navegue até a pasta:
   ```bash
   cd C:\caminho\para\pivot-web
   ```
3. Digite:
   ```bash
   npm install
   ```
4. Aguarde terminar
5. Digite:
   ```bash
   npm start
   ```

Isso reinstala tudo.

---

## ✅ CHECKLIST FINAL

- [ ] Node.js instalado (node --version funciona)
- [ ] Pasta `node_modules` existe
- [ ] Arquivo `package.json` existe
- [ ] `INICIAR.bat` foi clicado
- [ ] Janela preta do terminal apareceu e não foi fechada
- [ ] Página em http://localhost:3000 carrega
- [ ] Console do navegador (F12) não tem erros em vermelho

Se tudo isso estiver ok, o app deve funcionar!

---

## 📞 AINDA NÃO FUNCIONA?

Abra o **Prompt de Comando** na pasta `pivot-web` e me envie a saída de:

```bash
node --version
npm --version
npm list
```

Assim consigo ajudar melhor!

---

**Versão**: 1.0
