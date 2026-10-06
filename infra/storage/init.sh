#!/bin/sh
# Creates the photo buckets and their rules (ADR-0009). Safe to re-run.
#
# Runs in the official AWS CLI image:
# - dev:   the one-shot `storage-init` service in infra/docker-compose.yml
# - tests: @borrowbox/testing's startS3()
# - prod:  once by hand against Cloudflare R2 (see infra/storage/README.md)
#
# Env:
#   S3_ENDPOINT                         e.g. http://seaweedfs:8333
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY   admin credentials
#   AWS_DEFAULT_REGION                  us-east-1 (SeaweedFS) or auto (R2)
#   S3_UPLOADS_BUCKET, S3_PUBLIC_BUCKET
#   S3_CORS_ORIGINS                     comma-separated browser origins allowed to upload
set -eu

: "${S3_ENDPOINT:?}" "${S3_UPLOADS_BUCKET:?}" "${S3_PUBLIC_BUCKET:?}" "${S3_CORS_ORIGINS:?}"
s3api() { aws --endpoint-url "$S3_ENDPOINT" s3api "$@"; }

for bucket in "$S3_UPLOADS_BUCKET" "$S3_PUBLIC_BUCKET"; do
  if s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
    echo "bucket $bucket exists"
  else
    s3api create-bucket --bucket "$bucket" >/dev/null
    echo "created bucket $bucket"
  fi
done

# Browsers upload straight to the private bucket with presigned PUTs, only
# from our own origins, and only with the signed Content-Type.
origins=$(printf '%s' "$S3_CORS_ORIGINS" | sed 's/[[:space:]]//g; s/,/","/g')
s3api put-bucket-cors --bucket "$S3_UPLOADS_BUCKET" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedOrigins\": [\"$origins\"],
    \"AllowedMethods\": [\"PUT\"],
    \"AllowedHeaders\": [\"content-type\"],
    \"MaxAgeSeconds\": 3600
  }]
}"
echo "set upload CORS for $S3_CORS_ORIGINS"

# Safety net behind the app's sweeper: raw uploads never stay longer than a day.
s3api put-bucket-lifecycle-configuration --bucket "$S3_UPLOADS_BUCKET" --lifecycle-configuration '{
  "Rules": [{
    "ID": "expire-incoming",
    "Status": "Enabled",
    "Filter": { "Prefix": "incoming/" },
    "Expiration": { "Days": 1 }
  }]
}'
echo "set 1-day expiry on incoming/ uploads"
