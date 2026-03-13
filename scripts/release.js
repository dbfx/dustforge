#!/usr/bin/env node

const { execSync } = require('child_process')
const { readFileSync } = require('fs')

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
const capture = (cmd) => execSync(cmd, { encoding: 'utf-8' }).trim()

const bump = process.argv[2]
if (!['patch', 'minor', 'major'].includes(bump)) {
  console.error('Usage: npm run release -- patch|minor|major')
  process.exit(1)
}

// Ensure clean working tree
const status = capture('git status --porcelain')
if (status) {
  console.error('Error: working tree is not clean. Commit or stash changes first.')
  process.exit(1)
}

// Ensure on main branch
const branch = capture('git rev-parse --abbrev-ref HEAD')
if (branch !== 'main') {
  console.error(`Error: releases must be made from main branch (currently on ${branch})`)
  process.exit(1)
}

// Ensure up to date with remote
run('git fetch origin main')
const behind = capture('git rev-list HEAD..origin/main --count')
if (behind !== '0') {
  console.error('Error: local main is behind origin. Pull first.')
  process.exit(1)
}

// 1. Bump version (no git tag, no commit)
run(`npm version ${bump} --no-git-tag-version`)
const version = JSON.parse(readFileSync('package.json', 'utf-8')).version
const tag = `v${version}`
console.log(`\nBumped to ${tag}`)

// 2. Generate changelog
run('npx conventional-changelog -p angular -i CHANGELOG.md -s')
console.log('Changelog updated')

// 3. Commit and tag
run('git add package.json package-lock.json CHANGELOG.md')
run(`git commit -m "${version}"`)
run(`git tag ${tag}`)

// 4. Push commit and tag
run('git push origin main')
run(`git push origin ${tag}`)

console.log(`\n${tag} released! CI will build and publish.`)
console.log(`Track progress: https://github.com/dbfx/dustforge/actions/workflows/release.yml`)
