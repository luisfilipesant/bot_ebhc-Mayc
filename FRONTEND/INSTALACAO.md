# Guia de Instalação - Automação WhatsApp EBHC

## 📋 Pré-requisitos

### Sistema Operacional
- **Windows 10** ou superior (64-bit)
- **4GB RAM** mínimo (8GB recomendado)
- **500MB** de espaço livre em disco

### Software Necessário
- **Node.js 18.x** ou superior
- **npm 9.x** ou superior
- **Git** (opcional, para desenvolvimento)

## 🚀 Instalação Rápida

### Opção 1: Instalador Executável (Recomendado)

1. Baixe o arquivo `Automacao-WhatsApp-EBHC-Setup.exe`
2. Execute o instalador como administrador
3. Siga as instruções na tela
4. Inicie a aplicação pelo atalho criado

### Opção 2: Instalação Manual

1. **Baixar Node.js**
   - Acesse: https://nodejs.org
   - Baixe a versão LTS mais recente
   - Execute o instalador e siga as instruções

2. **Extrair a Aplicação**
   - Extraia o arquivo ZIP em uma pasta de sua escolha
   - Exemplo: `C:\Programas\WhatsApp-Automation\`

3. **Instalar Dependências**
   ```cmd
   cd C:\Programas\WhatsApp-Automation
   npm install
   ```

4. **Compilar a Aplicação**
   ```cmd
   npm run build
   npx tailwindcss -i ./src/styles.css -o ./dist/output.css
   ```

5. **Executar a Aplicação**
   ```cmd
   npm start
   ```

## 🔧 Configuração Inicial

### 1. Primeira Execução

1. **Abrir a Aplicação**
   - Clique no ícone da área de trabalho
   - Ou execute `npm start` na pasta do projeto

2. **Conectar ao WhatsApp**
   - Clique em "Conectar WhatsApp"
   - Aguarde o QR Code aparecer
   - Abra o WhatsApp no seu telefone
   - Vá em: Menu → Dispositivos conectados → Conectar dispositivo
   - Escaneie o QR Code exibido na aplicação

3. **Aguardar Conexão**
   - Aguarde a mensagem "Conectado com sucesso!"
   - Seus grupos serão carregados automaticamente

### 2. Configurar Mensagens

1. **Acessar Mensagens**
   - Clique na aba "Mensagens" na barra lateral

2. **Criar Nova Mensagem**
   - Clique em "Nova Mensagem"
   - Preencha o nome da mensagem
   - Digite o texto desejado
   - Adicione mídia se necessário
   - Clique em "Salvar Mensagem"

3. **Repetir o Processo**
   - Você pode criar até 5 mensagens padrão
   - Cada mensagem pode ter até 2000 caracteres

### 3. Configurar Automação

1. **Acessar Grupos**
   - Clique na aba "Grupos" na barra lateral

2. **Configurar Grupo**
   - Localize o grupo desejado
   - Clique em "Configurar"
   - Ative a automação
   - Selecione a mensagem a ser enviada
   - Defina após quantas mensagens enviar
   - Clique em "Salvar"

## ⚠️ Solução de Problemas

### Problema: Node.js não encontrado
**Erro**: `'node' não é reconhecido como comando interno`

**Solução**:
1. Reinstale o Node.js
2. Marque a opção "Add to PATH" durante a instalação
3. Reinicie o computador
4. Abra um novo terminal

### Problema: Erro de dependências
**Erro**: `npm ERR! peer dep missing`

**Solução**:
```cmd
npm install --legacy-peer-deps
```

### Problema: QR Code não aparece
**Possíveis causas**:
- Conexão com internet instável
- Firewall bloqueando a aplicação
- WhatsApp Web já conectado em outro dispositivo

**Solução**:
1. Verifique sua conexão com a internet
2. Desconecte outros dispositivos do WhatsApp Web
3. Tente reconectar na aplicação

### Problema: Grupos não carregam
**Solução**:
1. Verifique se está conectado ao WhatsApp
2. Aguarde alguns segundos para carregamento
3. Tente desconectar e reconectar

### Problema: Mensagens não são enviadas
**Verificações**:
1. Automação está ativada para o grupo?
2. Mensagem padrão está configurada?
3. Contador de mensagens atingiu o limite?
4. WhatsApp ainda está conectado?

## 🔒 Configurações de Segurança

### Firewall do Windows
Se o Windows Defender bloquear a aplicação:

1. Abra "Windows Defender Firewall"
2. Clique em "Permitir um aplicativo pelo firewall"
3. Clique em "Alterar configurações"
4. Clique em "Permitir outro aplicativo"
5. Navegue até a pasta da aplicação
6. Selecione `electron.exe` ou o executável da aplicação
7. Marque as caixas "Privada" e "Pública"
8. Clique em "OK"

### Antivírus
Alguns antivírus podem detectar falsamente a aplicação como ameaça:

1. Adicione a pasta da aplicação às exceções
2. Ou adicione o executável à lista de confiança
3. Consulte a documentação do seu antivírus

## 📁 Estrutura de Arquivos

Após a instalação, você encontrará:

```
WhatsApp-Automation/
├── main.js              # Arquivo principal
├── package.json         # Configurações
├── README.md            # Documentação
├── assets/              # Recursos (logo, ícones)
├── src/                 # Código fonte
├── dist/                # Arquivos compilados
├── data/                # Dados da aplicação (criado automaticamente)
│   ├── config.json      # Configurações salvas
│   └── logs.json        # Logs do sistema
└── auth_info/           # Credenciais WhatsApp (criado automaticamente)
```

## 🔄 Atualizações

### Verificar Versão Atual
Na aba "Configurações", você pode ver a versão atual da aplicação.

### Instalar Atualizações
1. Faça backup das configurações (Configurações → Exportar Backup)
2. Baixe a nova versão
3. Substitua os arquivos da aplicação
4. Execute `npm install` se necessário
5. Importe o backup das configurações

## 📞 Suporte Técnico

### Informações para Suporte
Ao entrar em contato com o suporte, tenha em mãos:

1. **Versão da aplicação**
2. **Versão do Windows**
3. **Versão do Node.js** (`node --version`)
4. **Logs de erro** (disponíveis na aba Configurações)
5. **Descrição detalhada do problema**

### Canais de Suporte
- **Email**: suporte@ebhc.cloud
- **Telefone**: (11) 9999-9999
- **Website**: https://ebhc.cloud/suporte

### Horário de Atendimento
- **Segunda a Sexta**: 8h às 18h
- **Sábado**: 8h às 12h
- **Domingo**: Não há atendimento

## 📋 Checklist de Instalação

- [ ] Node.js instalado e funcionando
- [ ] Aplicação extraída/instalada
- [ ] Dependências instaladas (`npm install`)
- [ ] Projeto compilado (`npm run build`)
- [ ] Aplicação iniciada com sucesso
- [ ] WhatsApp conectado via QR Code
- [ ] Grupos carregados
- [ ] Primeira mensagem configurada
- [ ] Primeira automação ativada
- [ ] Teste de funcionamento realizado

---

**Versão do Guia**: 1.0  
**Data**: Janeiro 2024  
**Compatibilidade**: Windows 10/11, Node.js 18+

