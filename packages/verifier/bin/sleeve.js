#!/usr/bin/env node
// pnpm links a bin only when its target exists at install time, and dist/ exists only after a build.
import '../dist/cli.js';
