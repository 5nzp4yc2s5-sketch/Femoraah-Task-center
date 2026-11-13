import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The separate Cash Flow app (APP_MODE=cashflow). Run after tests/e2e against the same database,
// with the app started with APP_MODE=cashflow: npx playwright test -c playwright.cashflow.config.ts
export default defineConfig({ ...base, testDir: 'tests/e2e-cashflow' });
