# tutor.ai

> App desktop open source de estudo personalizado com IA. Roda local, dados ficam no seu computador.

Status: 🚧 em desenvolvimento — atualmente na **v0.1.0 (Fundação)**.

## Documentação

- [Arquitetura completa](docs/ARCHITECTURE.md)
- [Roadmap & versionamento](docs/TODO.md)

## Setup local (desenvolvedores)

```bash
# 1. Pré-requisitos: Node.js 20+ e npm
node --version

# 2. Clonar e instalar
git clone https://github.com/minepedro/tutor-ai.git
cd tutor-ai
npm install

# 3. Rodar em modo dev
npm run dev
```

Na primeira vez, o app pede sua API key da Anthropic (vai em [console.anthropic.com](https://console.anthropic.com)) e baixa um modelo de embeddings (~30MB). Depois disso, tudo funciona offline exceto chamadas para a Claude.

## Licença

MIT.
