#!/usr/bin/env bash
# Install ALL dependencies, including devDependencies
npm install --include=dev

# Compile TypeScript
npm run build
