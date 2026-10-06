#!/bin/sh
# Starts SeaweedFS with S3 identities built from env (ADR-0009):
# - admin:     full rights; used only by storage-init (never by services)
# - catalog:   read/write on the uploads and public buckets, nothing else
# - anonymous: read-only on the public bucket (no listing, no writing)
# Used by infra/docker-compose.yml and by @borrowbox/testing's startS3().
set -eu

: "${S3_ADMIN_ACCESS_KEY_ID:?}" "${S3_ADMIN_SECRET_ACCESS_KEY:?}"
: "${S3_CATALOG_ACCESS_KEY_ID:?}" "${S3_CATALOG_SECRET_ACCESS_KEY:?}"
: "${S3_UPLOADS_BUCKET:?}" "${S3_PUBLIC_BUCKET:?}"

cat > /tmp/s3.json <<EOF
{
  "identities": [
    {
      "name": "admin",
      "credentials": [{ "accessKey": "${S3_ADMIN_ACCESS_KEY_ID}", "secretKey": "${S3_ADMIN_SECRET_ACCESS_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    },
    {
      "name": "catalog",
      "credentials": [{ "accessKey": "${S3_CATALOG_ACCESS_KEY_ID}", "secretKey": "${S3_CATALOG_SECRET_ACCESS_KEY}" }],
      "actions": [
        "Read:${S3_UPLOADS_BUCKET}", "Write:${S3_UPLOADS_BUCKET}",
        "Read:${S3_PUBLIC_BUCKET}", "Write:${S3_PUBLIC_BUCKET}"
      ]
    },
    {
      "name": "anonymous",
      "actions": ["Read:${S3_PUBLIC_BUCKET}"]
    }
  ]
}
EOF

exec /usr/bin/weed -logtostderr=true server -dir=/data -volume.max=0 \
  -master.volumeSizeLimitMB=1024 \
  -s3 -s3.config=/tmp/s3.json -s3.port.iceberg=0 -s3.port.lance=0
