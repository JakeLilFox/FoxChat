# FoxChat GIF gateway

A small self-hosted proxy in front of the [Klipy](https://klipy.com) GIF API. It keeps
`KLIPY_API_KEY` server-side and re-exposes only the endpoints and parameters FoxChat's GIF
picker needs, so the app never ships the key in its client bundle.

Per Klipy's integration terms, this gateway only proxies the JSON metadata endpoints
(search/trending/categories/items/share). Actual GIF bytes are always loaded by the end-user's
client directly from `static.klipy.com` — this gateway never streams media.

## Configuration

| Variable                | Required | Default  | Purpose                                             |
| ------------------------ | -------- | -------- | ---------------------------------------------------- |
| `KLIPY_API_KEY`          | yes      |          | Klipy app key, from the Klipy Partner panel          |
| `PORT`                   | no       | `3987`   | HTTP listen port                                     |
| `KLIPY_CONTENT_FILTER`   | no       | `medium` | Klipy content rating: `off`, `low`, `medium`, `high` |
| `RATE_LIMIT_PER_MINUTE`  | no       | `60`     | Per-IP request budget, protects the shared API key   |
| `MAX_BODY_BYTES`         | no       | `16384`  | Maximum request body size for `POST /gifs/share/:slug` |

## Endpoints

- `GET /gifs/trending?page=&per_page=&customer_id=&locale=`
- `GET /gifs/search?q=&page=&per_page=&customer_id=&locale=`
- `GET /gifs/categories?locale=`
- `GET /gifs/items?slugs=a,b,c`
- `POST /gifs/share/:slug` — body `{ "customer_id": "...", "q": "..." }`, tells Klipy a GIF was actually sent
- `GET /healthz`

Each endpoint forwards a fixed allowlist of query parameters to Klipy and returns Klipy's JSON
response unmodified. `customer_id` should be a random, non-identifying ID the client generates
itself (FoxChat persists one in `localStorage`) — never a Matrix user ID or other personal data.

## Run with Node

```sh
cd gif-gateway
npm install
export KLIPY_API_KEY=your-klipy-app-key
npm start
```

## Run with Docker

```sh
docker build -t foxchat-gif-gateway ./gif-gateway
docker run --restart unless-stopped -p 127.0.0.1:3987:3987 \
  -e KLIPY_API_KEY=your-klipy-app-key \
  foxchat-gif-gateway
```

Expose it as `https://gifs.example.com` through an HTTPS reverse proxy (Caddy, nginx, Traefik,
or a cloud load balancer). `GET /healthz` is available for health monitoring.

## Security notes

This endpoint has no authentication — anyone who can reach it can search/browse GIFs through
your Klipy key. Restrict ingress with your reverse proxy's rate limiting if the built-in per-IP
budget isn't enough, and never expose `KLIPY_API_KEY` through any other route.
