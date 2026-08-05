# Pando

The public site (pando.is) and the Seed Tool, as one Next.js app.

```
web/       the application — see web/README.md
deploy/    what runs on the VPS (compose file + runtime env template)
.github/   CI and the deploy pipeline
```

```bash
npm --prefix web install
```

```bash
npm --prefix web run dev
```

http://localhost:3000 · Seed Tool: `/join?i=sgv-founding`

Deployment — GitHub → GHCR → VPS, on every push to `main`: [DEPLOY.md](DEPLOY.md).
