# EVA · Serviço de Estudo de Mercado (PPTX)

Gera o estudo de mercado da RE/MAX Ville em `.pptx` editável, a partir dos dados do imóvel.
O n8n (EVA) orquestra; este serviço faz o trabalho pesado (ITBI → valoração → render).

## Componentes
- `server.js` — API HTTP (a EVA chama).
- `orchestrator.js` — cola ITBI + valoração + gerador.
- `db.js` — query dos vendidos no Postgres (mesmo prédio).
- `itbi_format.js` — linhas do ITBI → bloco `vendidos`.
- `valoracao.js` — régua (âncora, IPCA, faixa, sugerido) → bloco `valoracao`.
- `amostra_extract.js` + `cloudflare.js` — extrai anúncios via Cloudflare Browser Rendering.
- `estudo_generator.js` — gera o `.pptx` (precisa da pasta `assets/`).
- `estudo_itbi.sql` — as queries do ITBI (referência).
- `eva_estudo_workflow.json` — esqueleto do workflow n8n para importar.
- `assets/` — ativos fixos da marca (logo, mapa oficial, gráfico do ciclo). **Necessários.**

## Variáveis de ambiente
- `PORT` (default 3000)
- `ASSETS_DIR` (default `./assets`)
- `DATABASE_URL` — Postgres do Supabase (SSL). Necessário p/ buscar vendidos por `buildingKey`.
- `CF_ACCOUNT_ID`, `CF_API_TOKEN` — Cloudflare Browser Rendering (token com **Browser Rendering – Edit**).
  Setar como variável de ambiente; **não** colocar no código.

## Subir (Render / Railway / VPS)
```
npm install
export DATABASE_URL=postgres://...        # Supabase
export CF_ACCOUNT_ID=...   CF_API_TOKEN=...
npm start                                  # escuta em :$PORT
```

## Endpoints
- `GET  /health` → `{ ok: true }`
- `POST /estudo` → body `{ buildingKey, imovel, corretor, amostras, estudo_data, ref }` → **.pptx** (binário).
  (alternativa sem DB: enviar `vendidosRows` em vez de `buildingKey`.)
- `POST /amostra` → `{ url, subject }` → objeto `amostra` (extraído via Cloudflare).
- `POST /amostras` → `{ avaliando, urls[], subject }` → `{ amostras, aprovacao }` (texto p/ WhatsApp).

## Teste local (sem DB, com os vendidos reais já extraídos)
```
npm run test:marquise        # gera Estudo_Orquestrado.pptx
```

## Workflow n8n (importar `eva_estudo_workflow.json`)
Fluxo: **Intake (WhatsApp) → Parse → /amostras (Cloudflare) → Aprovação → /estudo → Entrega.**
Ajustes necessários ao importar:
- variáveis `RENDER_URL`, `WHATSAPP_SEND_URL`, `WHATSAPP_SEND_DOC_URL`, `ADMIN_WHATSAPP`;
- trocar os nós de WhatsApp (placeholders) pela sua integração e **reusar a cascata Aprovar_Curadoria / Aprovar_Carrossel** no passo de aprovação;
- ligar a resposta do admin ao campo `resposta` do nó "Aplicar aprovação".

## Notas
- **Fotos do imóvel** (fachada, interior, foto do corretor) são passadas por URL no `imovel`/`corretor`; o serviço baixa sozinho. Só os ativos da marca ficam em `assets/`.
- **Cloudflare `/json`** usa Workers AI por chamada (custo em centavos); para SPAs use `waitUntil: networkidle0` (já é o default no cliente).
- Portais podem bloquear/variar — por isso o **gate de aprovação** existe: o admin confere antes de entrar no estudo.
- Gerar `.pptx` **não roda** no Code node do n8n (sandbox); por isso este serviço à parte.
