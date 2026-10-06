# Object storage

Photo storage as described in [ADR-0009](../../docs/adr/0009-photo-pipeline.md):

| Bucket | Access | Holds |
|---|---|---|
| `borrowbox-uploads` | private | raw uploads (`incoming/`, expired after a day); condition photos later |
| `borrowbox-public` | anonymous read (no listing, no writes) | processed, metadata-free photos |

- `seaweedfs.sh` starts SeaweedFS (dev and tests) with three identities: **admin** (only for setup), **catalog** (read/write on the two buckets) and **anonymous** (read on the public bucket).
- `init.sh` creates both buckets, the upload CORS rule and the 1-day expiry. It's safe to re-run, and runs in the official AWS CLI image:
  - dev: the one-shot `storage-init` service in `infra/docker-compose.yml`
  - tests: `startS3()` in `libs/testing`
  - production: once by hand (below)

## Production checklist (Cloudflare R2)

1. **Create the buckets** `borrowbox-uploads` and `borrowbox-public` (EU jurisdiction), and set up the CORS rule and lifecycle rule by running `init.sh` once with an admin R2 API token:
   ```sh
   docker run --rm -v "$PWD/infra/storage:/storage:ro" \
     -e S3_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com \
     -e AWS_ACCESS_KEY_ID=<admin key> -e AWS_SECRET_ACCESS_KEY=<admin secret> \
     -e AWS_DEFAULT_REGION=auto \
     -e S3_UPLOADS_BUCKET=borrowbox-uploads -e S3_PUBLIC_BUCKET=borrowbox-public \
     -e S3_CORS_ORIGINS=https://<pwa domain> \
     --entrypoint /bin/sh amazon/aws-cli:2.31.13 /storage/init.sh
   ```
2. **Public access:** connect a custom domain (e.g. `media.<domain>`) to `borrowbox-public` only. Leave `borrowbox-uploads` without public access, and keep the `r2.dev` URL disabled for both.
3. **Catalog's credentials:** an R2 API token with *Object Read & Write* on the two buckets only. Never give a service the admin token.
4. **CDN cache:** choose a cache lifetime, or purge on delete, for the public domain. A deleted photo stays reachable until its cache expires (ARCHITECTURE.md §10).
5. **Check:**
   - an anonymous GET of a public photo works
   - an anonymous GET of anything in `borrowbox-uploads` returns 403
   - a preflight from another origin is refused
