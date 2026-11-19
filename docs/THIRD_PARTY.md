# Third-party provenance and licensing

This repository contains original GoreeCloud application logic plus source generated
from the Flutter SDK's standard Android/Linux scaffold. Third-party framework
packages are resolved through their package registries and **not** represented as
original GoreeCloud source. Their original license notices remain applicable.

| Component | Use | Upstream | License |
| --- | --- | --- | --- |
| React / React DOM | Web UI | https://github.com/facebook/react | MIT |
| Vite | Web tooling | https://github.com/vitejs/vite | MIT |
| Fastify | HTTP API | https://github.com/fastify/fastify | MIT |
| @fastify/static | Self-hosted static distribution | https://github.com/fastify/fastify-static | MIT |
| better-sqlite3 | Server-side SQLite bindings | https://github.com/WiseLibs/better-sqlite3 | MIT |
| argon2 | Password hashing | https://github.com/ranisalt/node-argon2 | MIT |
| ws | Real-time WebSocket server | https://github.com/websockets/ws | MIT |
| lucide-react | Web UI icons | https://github.com/lucide-icons/lucide | ISC |
| TypeScript | Compile-time checking | https://github.com/microsoft/TypeScript | Apache-2.0 |
| Flutter | Android/Linux native UI framework and platform template | https://github.com/flutter/flutter | BSD-3-Clause |
| GoreeCloud UI alpha tokens | Semantic visual guidance | https://github.com/GoreeCloud/gc-ui | MIT |

No Slack or Mattermost proprietary software, logos, trademarks, or message
history were copied. A full dependency-specific license inventory must be
regenerated and reviewed when lockfiles change; package license declarations
alone are not a security or legal audit. Verify the exact dependency graph
before production distribution.

GoreeCloud UI visual values are provisional alpha tokens. The implementation
uses semantic values from gc-ui's verified token registry rather than adopting
an unapproved identity.
