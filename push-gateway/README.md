# FoxChat Matrix push gateway

A small self-hosted Matrix Push Gateway which receives `POST /_matrix/push/v1/notify` from a Matrix homeserver and delivers Android notifications through Google's FCM HTTP v1 API. It does not use the Firebase Admin SDK or Firebase hosting.

## Requirements

- Node.js 20 or newer, or Docker
- A Google project with the Firebase Cloud Messaging API enabled
- Application Default Credentials with permission to send FCM messages
- HTTPS in front of this service (Caddy, nginx, Traefik, or a cloud load balancer)

FCM is itself part of Firebase. Keeping FCM means the Android app still needs `google-services.json` and the gateway needs a Google service identity. The private credential exists only on this server.

## Configuration

| Variable                         | Required             | Default              | Purpose                                      |
| -------------------------------- | -------------------- | -------------------- | -------------------------------------------- |
| `GOOGLE_CLOUD_PROJECT`           | yes                  |                      | FCM target project ID                        |
| `GOOGLE_APPLICATION_CREDENTIALS` | outside Google Cloud | ADC                  | Path to a mounted service-account JSON       |
| `PORT`                           | no                   | `3985`               | HTTP listen port                             |
| `ALLOWED_APP_IDS`                | no                   | `foxchat.jakefox.de` | Comma-separated Matrix pusher app IDs        |
| `INCLUDE_MESSAGE_CONTENT`        | no                   | `true`               | Set `false` for generic lock-screen text     |
| `MAX_BODY_BYTES`                 | no                   | `262144`             | Maximum Matrix request size                  |
| `MAX_PARALLEL_SENDS`             | no                   | `10`                 | Concurrent FCM requests                      |
| `DEDUPE_TTL_SECONDS`             | no                   | `3600`               | In-memory event/device duplicate suppression |

## Run with Node

```sh
cd push-gateway
npm install
export GOOGLE_CLOUD_PROJECT=your-project-id
export GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/foxchat-fcm.json
npm start
```

## Run with Docker

```sh
docker build -t foxchat-push-gateway ./push-gateway
docker run --restart unless-stopped -p 127.0.0.1:3985:3985 \
  -e GOOGLE_CLOUD_PROJECT=your-project-id \
  -e GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/fcm.json \
  -v /secure/path/service-account.json:/run/secrets/fcm.json:ro \
  foxchat-push-gateway
```

Expose it as `https://push.example.com` through an HTTPS reverse proxy, then build FoxChat with:

```sh
VITE_MATRIX_PUSH_GATEWAY_URL=https://push.jakefox.de npm run android:build
```

The client registers `https://push.example.com/_matrix/push/v1/notify` with the Matrix homeserver automatically. `GET /healthz` is available for health monitoring.

## Security notes

The Matrix Push Gateway endpoint does not define HTTP authentication. Restrict ingress to your homeserver addresses when possible, apply reverse-proxy rate limits, and never expose the service-account file through the web server. Device tokens are not logged. For multiple gateway instances, replace the in-memory duplicate cache with a shared Redis store.
