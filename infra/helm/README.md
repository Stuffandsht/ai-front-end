# Helm Scaffold

The first complete pass targets Docker Compose for self-hosted single-server deployments.
This directory is reserved for Kubernetes manifests that preserve the same service
boundaries: web/API app, Postgres, Valkey/Redis, S3-compatible object storage, and
external KMS/Vault integration.
