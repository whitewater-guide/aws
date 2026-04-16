# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AWS CDK (v2) infrastructure-as-code for **whitewater.guide**. TypeScript-based, defining all AWS resources for dev and prod environments in separate AWS accounts.

## Common Commands

```bash
pnpm run check          # Lint
pnpm run typecheck:ci   # Check Typecript compilation
pnpm run cdk -- diff    # Show pending infrastructure changes
pnpm run cdk -- synth   # Synthesize CloudFormation templates
pnpm run cdk -- deploy  # Deploy stack
pnpm run clean          # Remove cdk.out and dist/
```

CDK commands accept stack names and flags after `--`, e.g. `npm run cdk -- deploy DevStack`.

## Architecture

### Entry Point & Stacks

- [bin/aws.ts](bin/aws.ts) — CDK app entry point, instantiates Dev and Prod stacks
- [bin/aws-accounts.ts](bin/aws-accounts.ts) — AWS account IDs and certificate ARNs
- [lib/RootStack.ts](lib/RootStack.ts) — Root stack composing all sub-stacks (networking, database, services, web, certificates)

### Sub-Stacks (under `lib/`)

- **networking/** — VPC, ECS Cluster, CloudMap service discovery
- **database/** — RDS PostgreSQL 13, backup tasks, DB initialization and migration runners
- **services/** — ECS Fargate services with ALB routing:
  - `Api` (port 3333) — main backend
  - `Gorge` (port 7080) — river gauge data
  - `Synapse` (port 8008) — Matrix homeserver
  - `Imgproxy` (port 8080) — image proxy with CloudFront
  - `Grafana` / `Loki` — monitoring stack
  - `PGAdmin` — database admin UI
  - `Service.ts` — base class for all ECS services (DRY pattern)
  - `LoadBalancer.ts` — ALB with SNI-based HTTPS routing
- **web/** — S3 buckets and CloudFront distributions for static content
- **certificates/** — ACM SSL certificates (us-east-1)

### Configuration & Secrets

- [lib/config/Config.ts](lib/config/Config.ts) — Singleton config loaded from CDK context
- [lib/types.ts](lib/types.ts) — `AppConfig` interface for environment-specific values
- [lib/SSM.ts](lib/SSM.ts) — SSM Parameter Store path constants
- Secrets managed via AWS SSM Parameter Store and Secrets Manager

### Scripts (under `scripts/`)

- `start_stop.ts` — Start/stop tagged infrastructure to save costs
- `manual_backup_restore.ts` — Manual database backup/restore operations

## Code Conventions

- **Formatting**: Prettier (80 chars, single quotes, trailing commas)
- **Commits**: Conventional commit format enforced by commitlint (e.g. `fix:`, `feat:`, `chore:`)
- **Git hooks**: Husky runs lint-staged on pre-commit
- **TypeScript**: Strict mode, ES2020 target, CommonJS modules
- **CDK patterns**: PascalCase for construct classes, config via singleton `Config` class
