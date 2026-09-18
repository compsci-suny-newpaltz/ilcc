# Deploying ILCC to Hydra

Prod: **https://hydra.newpaltz.edu/ilcc** · namespace `hydra-infra` · one pod.

## Day-to-day

```bash
# on the Hydra control node, as infra
/home/infra/hydra-saml-auth/scripts/deploy-ilcc.sh            # main → build → import → roll → smoke
/home/infra/hydra-saml-auth/scripts/deploy-ilcc.sh --ref my-branch
/home/infra/hydra-saml-auth/scripts/deploy-ilcc.sh --rollback
/home/infra/hydra-saml-auth/scripts/deploy-ilcc.sh --sync-downloads   # after changing a course file in /home/infra
```

The script: pulls this repo to `/home/infra/web_ilcc`, `buildah bud --build-arg VITE_BASE=/ilcc/`, imports the image into RKE2's containerd (there is no registry), tags it `docker.io/ndg8743/ilcc:<date>` (image name only — containerd needs a registry-style name; no push happens), applies `k8s/components/ilcc/` from hydra-saml-auth, `kubectl set image`, waits for readiness through Traefik, and runs smoke checks.

## Where things live

| what | where |
|---|---|
| manifests | `hydra-saml-auth/k8s/components/ilcc/` (Deployment, Service, PVCs, Middleware, IngressRoute, CronJob) |
| secret | `ilcc-secret` in-cluster: `HYDRA_PROXY_SECRET`, `SEED_ADMINS` — never in git |
| SQLite DB + nightly backups | PVC `ilcc-data` → `/data/ilcc.db`, `/data/backups/` |
| course zips + textbook | PVC `ilcc-downloads` → `/data/downloads/` (synced from `/home/infra/*.zip`, `*.pdf`) |
| logs | `kubectl -n hydra-infra logs deploy/ilcc -f` (pino JSON) |

## Auth model

- Traefik `hydra-forward-auth` (hydra-system) validates the SAML session cookie via hydra-auth and returns `X-Hydra-User/Email/Roles`.
- A second middleware `ilcc-proxy-secret` adds `X-Hydra-Proxy-Secret`. The app only trusts identity headers from the pod CIDR **and** with that secret (`server/src/middleware/auth.js`).
- Public: editor, `/setup`, `/faq`, `/docs`, `/examples`, demos, run/debug WebSockets, download manifest.
  SSO: `/downloads`, `/materials`, `/my-submissions`, file downloads, submissions.
  Staff: `/autograder`, `/api/grader/*` (TA+), `/api/staff` (admin).
- Faculty (SAML affiliation) become admins on first sign-in; `SEED_ADMINS` adds explicit ones; admins add TAs in the app (User menu → Staff).
- The IngressRoute rule **must be one line** — Traefik v3 rejects YAML folded blocks and silently disables the router.

### Lab configuration

The staff configuration page is `/labs`. The client calls `/api/grader/labs`
for published labs and `/api/grader/labs/admin` for staff management. These
requests reuse the existing SSO-protected `/ilcc/api/grader` IngressRoute, with
forward-auth followed by the proxy-secret middleware. No separate API prefix
needs to be added for the current client. The original `/api/labs` endpoints
remain available for older clients, but need their own SSO routing if used.

Express mounts the lab router before the general autograder staff gate. The lab
router requires campus SSO for all requests, returns only published labs to
students, and requires TA-or-admin access for management. All other grader
endpoints retain their staff-only permissions. The page's React role guard and
`/api/me` use the existing sign-in flow. Optional protection of `/ilcc/labs`
itself can be added to the external IngressRoute like `/ilcc/autograder`.

Use the existing `/login?returnTo=...` flow for staff sign-in, preserving the
`/ilcc/labs` destination. Faculty affiliation promotes professors to admin on
their first authenticated request. TAs need an entry in the app's Staff list;
an affiliation header alone does not grant TA privileges. The UI route, account
menu, and management API all use the same staff role check as the autograder.

Migration `003_labs.sql` creates the lab table automatically at startup on the
existing SQLite data volume; it requires no manual database changes.

If `/api/me` identifies a signed-in user but a lab request returns 401, verify
that the request is to `/ilcc/api/grader/labs/...` and that its IngressRoute
passes `X-Hydra-Email` and the proxy secret. A 403 indicates insufficient staff
permissions; a 401 indicates missing trusted identity or an expired session.
The app never trusts browser-supplied identity headers or bypasses role checks.

The web manifest and icons are linked using Vite's configured base URL, so
`/ilcc`, `/ilcc/`, and nested pages all request `/ilcc/site.webmanifest`. A
manifest syntax error at the first character often means that the response is
an HTML page instead of JSON. Check the requested URL and response content type.

## Data safety

Both PVCs are `hydra-local` with `reclaimPolicy: Delete`. **Never `kubectl delete pvc`.** Pin the PVs to Retain after first bind (see `k8s/components/ilcc/README.md`). The CronJob keeps 14 nightly `.db.gz` backups on `ilcc-data`; copy them off-node periodically:

```bash
kubectl -n hydra-infra cp $(kubectl -n hydra-infra get pod -l app=ilcc -o name | cut -d/ -f2):/data/backups /home/infra/backups/ilcc/
```

## Course files

Rebuild the all-platform zip when upstream ships a new package, then sync:

```bash
scripts/build-unified-cuh63.sh /home/infra /home/infra/cuh63.zip
/home/infra/hydra-saml-auth/scripts/sync-ilcc-downloads.sh
```

## Student sandbox

Aidan's dev copy at `/students/odonnela6/ilcc/` is unrelated to prod and untouched. Prod deploys from this repo's `main`.

## Auto-deploy (since 2026-09-08)

Pushing to `main` redeploys https://hydra.newpaltz.edu/ilcc automatically:
GitHub webhook → `https://hydra.newpaltz.edu/hooks/ilcc-deploy` (HMAC-verified,
served by `ilcc-webhook.service` on the Hydra host) → `deploy-ilcc.sh`
(build, import, roll, smoke). Concurrent pushes coalesce into one follow-up deploy.

- Status: `https://hydra.newpaltz.edu/hooks/ilcc-deploy/status` (JSON: running / last result)
- Logs: `journalctl -u ilcc-webhook` and `/var/log/ilcc-webhook/deploy.log` on Hydra
- Secret: `/etc/ilcc-webhook.env` on Hydra + the webhook config on the GitHub repo
- CI (`.github/workflows/ci.yml`) runs in parallel on the same push; the deploy
  does not wait for it — revert or push a fix if CI catches something.
