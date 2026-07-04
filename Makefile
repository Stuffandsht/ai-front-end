.PHONY: install dev lint typecheck test test-integration test-e2e build db-migrate db-seed

install:
	npm install

dev:
	npm run dev

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test

test-integration:
	npm run test:integration

test-e2e:
	npm run test:e2e

build:
	npm run build

db-migrate:
	npm run db:migrate

db-seed:
	npm run db:seed
