# Automação WhatsApp - EBHC Cloud

Uma aplicação desktop moderna para automação de mensagens no WhatsApp, desenvolvida com Electron, React e a API Baileys.

## 📋 Descrição

Esta aplicação permite conectar sua conta do WhatsApp e configurar o envio automático de mensagens em grupos baseado em gatilhos personalizáveis. Com uma interface intuitiva e moderna, você pode gerenciar até 5 mensagens padrão e configurar automações específicas para cada grupo.

## ✨ Características Principais

- **Conexão Segura**: Integração com WhatsApp via API Baileys
- **Interface Moderna**: Design responsivo com tema claro/escuro
- **Automação Inteligente**: Envio automático baseado em contadores de mensagens
- **Gerenciamento de Grupos**: Visualização e configuração de todos os seus grupos
- **Mensagens Personalizadas**: Até 5 mensagens padrão configuráveis
- **Logs Detalhados**: Sistema completo de registros e monitoramento
- **Backup e Restauração**: Exportação e importação de configurações

## 🎯 Funcionalidades

### Conexão WhatsApp
- Autenticação via QR Code
- Reconexão automática
- Status de conexão em tempo real
- Desconexão segura

### Gerenciamento de Grupos
- Lista completa de grupos do WhatsApp
- Busca por nome de grupo
- Configuração individual de automação
- Visualização de participantes

### Mensagens Automáticas
- Até 5 mensagens padrão configuráveis
- Suporte a texto e mídia
- Preview de mensagens
- Validação de conteúdo

### Automação
- Gatilhos baseados em quantidade de mensagens
- Configuração por grupo
- Ativação/desativação individual
- Contador de mensagens em tempo real

### Configurações
- Modo claro/escuro
- Notificações do sistema
- Níveis de log configuráveis
- Backup e restauração de dados

## 🚀 Instalação

### Pré-requisitos

- **Node.js**: Versão 16.0 ou superior
- **npm**: Versão 7.0 ou superior
- **Windows**: Windows 10 ou superior (para execução)

### Instalação das Dependências

1. Clone ou extraia o projeto para um diretório local
2. Abra o terminal na pasta do projeto
3. Execute o comando para instalar as dependências:

```bash
npm install
```

### Compilação do Projeto

Para compilar o frontend React:

```bash
npm run build
```

Para gerar os estilos CSS:

```bash
npx tailwindcss -i ./src/styles.css -o ./dist/output.css
```

## 🔧 Desenvolvimento

### Executar em Modo de Desenvolvimento

Para iniciar a aplicação em modo de desenvolvimento:

```bash
npm start
```

Para desenvolvimento com hot-reload do frontend:

```bash
# Terminal 1 - Compilar CSS
npm run build-css

# Terminal 2 - Compilar JavaScript
npm run dev

# Terminal 3 - Executar Electron
npm start
```

### Estrutura do Projeto

```
whatsapp-automation-app/
├── main.js                 # Processo principal do Electron
├── preload.js             # Script de preload para comunicação segura
├── index.html             # Página principal
├── package.json           # Configurações e dependências
├── webpack.config.js      # Configuração do Webpack
├── tailwind.config.js     # Configuração do Tailwind CSS
├── assets/                # Recursos estáticos (logo, ícones)
├── src/
│   ├── App.js            # Componente principal React
│   ├── index.js          # Ponto de entrada React
│   ├── styles.css        # Estilos principais
│   ├── components/       # Componentes React
│   │   ├── Sidebar.js
│   │   ├── Header.js
│   │   ├── ConnectionPage.js
│   │   ├── GroupsPage.js
│   │   ├── MessagesPage.js
│   │   └── SettingsPage.js
│   ├── services/         # Serviços de backend
│   │   ├── whatsappService.js
│   │   └── dataService.js
│   └── utils/            # Utilitários
│       ├── validation.js
│       └── helpers.js
└── dist/                 # Arquivos compilados
```

## 📦 Empacotamento

### Gerar Instalador para Windows

Para criar um instalador .exe para Windows:

```bash
npm run dist-win
```

O instalador será gerado na pasta `dist-electron/`.

### Configurações de Empacotamento

As configurações do electron-builder estão no `package.json`:

- **Formato**: Instalador NSIS
- **Ícone**: Logo da EBHC
- **Atalhos**: Desktop e Menu Iniciar
- **Instalação**: Diretório personalizável

## 🔐 Segurança

### Dados Locais
- Credenciais do WhatsApp criptografadas
- Configurações armazenadas localmente
- Logs com informações não sensíveis

### Comunicação
- Conexão direta com servidores WhatsApp
- Sem servidores intermediários
- Dados não compartilhados com terceiros

## 📱 Como Usar

### 1. Primeira Conexão

1. Abra a aplicação
2. Clique em "Conectar WhatsApp"
3. Escaneie o QR Code com seu WhatsApp
4. Aguarde a confirmação de conexão

### 2. Configurar Mensagens

1. Acesse a aba "Mensagens"
2. Clique em "Nova Mensagem" ou edite uma existente
3. Defina nome e texto da mensagem
4. Adicione mídia se necessário
5. Salve a configuração

### 3. Configurar Automação

1. Acesse a aba "Grupos"
2. Localize o grupo desejado
3. Clique em "Configurar"
4. Ative a automação
5. Selecione a mensagem e defina o gatilho
6. Salve as configurações

### 4. Monitorar Atividade

1. Acesse a aba "Configurações"
2. Visualize estatísticas em tempo real
3. Consulte os logs do sistema
4. Faça backup das configurações

## ⚠️ Limitações e Considerações

### Limitações Técnicas
- Máximo de 5 mensagens padrão
- Suporte apenas para grupos (não conversas individuais)
- Requer conexão constante com a internet
- Uma conta WhatsApp por instalação

### Boas Práticas
- Use gatilhos moderados (evite spam)
- Monitore regularmente os logs
- Faça backup das configurações
- Respeite as políticas do WhatsApp

### Resolução de Problemas

**Problema**: QR Code não aparece
- **Solução**: Verifique a conexão com a internet e tente reconectar

**Problema**: Grupos não carregam
- **Solução**: Certifique-se de que está conectado ao WhatsApp

**Problema**: Mensagens não são enviadas
- **Solução**: Verifique se a automação está ativa e o gatilho configurado

**Problema**: Aplicação não inicia
- **Solução**: Verifique se todas as dependências foram instaladas

## 🔄 Atualizações

Para atualizar a aplicação:

1. Faça backup das configurações
2. Substitua os arquivos da aplicação
3. Execute `npm install` se necessário
4. Restaure as configurações se necessário

## 📞 Suporte

Para suporte técnico ou dúvidas:

- **Email**: suporte@ebhc.cloud
- **Website**: https://ebhc.cloud
- **Documentação**: Consulte este README

## 📄 Licença

© 2024 EBHC Cloud. Todos os direitos reservados.

Esta aplicação é propriedade da EBHC e destina-se ao uso interno e de clientes autorizados.

## 🔧 Desenvolvimento e Contribuição

### Tecnologias Utilizadas

- **Electron**: Framework para aplicações desktop
- **React**: Biblioteca para interface do usuário
- **Tailwind CSS**: Framework CSS utilitário
- **Baileys**: API não oficial do WhatsApp
- **Webpack**: Bundler de módulos
- **Node.js**: Runtime JavaScript

### Estrutura de Desenvolvimento

O projeto segue uma arquitetura modular com separação clara entre:

- **Frontend**: Componentes React com Tailwind CSS
- **Backend**: Serviços Node.js para WhatsApp e dados
- **Comunicação**: IPC seguro entre processos Electron

### Padrões de Código

- **ES6+**: JavaScript moderno
- **Componentes funcionais**: React Hooks
- **Modularização**: Separação por responsabilidade
- **Validação**: Entrada de dados e tratamento de erros
- **Logs**: Sistema completo de auditoria

---

**Versão**: 1.0.0  
**Data de Criação**: Janeiro 2024  
**Última Atualização**: Janeiro 2024

