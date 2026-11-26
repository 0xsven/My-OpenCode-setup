#!/usr/bin/env node
import { createHash, randomUUID } from "node:crypto"
import { cp, lstat, mkdir, mkdtemp, readFile, readlink, rename, rm, symlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"

export const MANAGED_TARGETS = [
  "opencode.json",
  "AGENTS.md",
  "agents",
  "commands",
  "plugins",
  "bin",
  "skills/visual-qa",
  "skills/pr-review",
]

const repoRoot = resolve(import.meta.dirname, "..")
const sourceRoot = join(repoRoot, "opencode")
const defaultBackupRoot = join(homedir(), ".local", "state", "opencode-setup", "backups")

export function defaultTarget(environment = process.env) {
  return join(environment.XDG_CONFIG_HOME || join(homedir(), ".config"), "opencode")
}

export function planTargets(target, source = sourceRoot) {
  return MANAGED_TARGETS.map((entry) => ({
    entry,
    source: join(source, entry),
    destination: join(target, entry),
  }))
}

async function entryKind(path) {
  try {
    return (await lstat(path)).isSymbolicLink() ? "symlink" : "other"
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return "missing"
    throw error
  }
}

export async function pointsTo(path, source) {
  if (await entryKind(path) !== "symlink") return false
  return resolve(dirname(path), await readlink(path)) === resolve(source)
}

async function checkParents(target, { destination, entry }) {
  for (let parent = dirname(destination); parent !== dirname(target); parent = dirname(parent)) {
    try {
      if (!(await lstat(parent)).isDirectory()) throw new Error(`Refusing to use non-directory or symlink parent for: ${entry}`)
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
  }
}

function historyPath(root, target) {
  const key = createHash("sha256").update(target).digest("hex")
  return join(root, `active-${key}.json`)
}

async function withOperation(history, { target, yes, dryRun }, run) {
  const marker = `${history}.operation`
  const recovery = `Installer operation marker: ${marker}. Wait if an installer is running. Otherwise reconcile the target, saved batches, and active history (${history}) before removing the marker and retrying.`
  if (!yes || dryRun) {
    if (await entryKind(marker) !== "missing") throw new Error(recovery)
    return run()
  }

  await mkdir(dirname(marker), { recursive: true })
  try {
    await writeFile(marker, "", { flag: "wx" })
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(recovery, { cause: error })
    throw error
  }
  const explain = (error) => new Error(`${error.message}\n${recovery}`, { cause: error })
  async function release() {
    try {
      await rm(marker)
    } catch (error) {
      throw explain(error)
    }
  }
  let started = false
  let result
  try {
    result = await run(async (details) => {
      await writeFile(marker, `${JSON.stringify({ pid: process.pid, target, history, ...details }, null, 2)}\n`)
      started = true
    })
  } catch (error) {
    if (started) throw explain(error)
    await release()
    throw error
  }
  await release()
  return result
}

async function readHistory(path) {
  let contents
  try {
    contents = await readFile(path, "utf8")
  } catch (error) {
    if (error.code === "ENOENT") return []
    throw error
  }
  const batches = JSON.parse(contents)
  if (!Array.isArray(batches) || !batches.length || new Set(batches).size !== batches.length ||
      batches.some((name) => typeof name !== "string" || !name || name !== basename(name) || name === "." || name === "..")) {
    throw new Error("Malformed active installer history.")
  }
  return batches
}

async function writeHistory(path, batches) {
  if (!batches.length) {
    await rm(path)
    return
  }
  const temporary = `${path}.${randomUUID()}`
  await writeFile(temporary, `${JSON.stringify(batches)}\n`, { flag: "wx" })
  try {
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function install(target, { yes = false, dryRun = false, now = new Date(), backupRoot = defaultBackupRoot } = {}) {
  target = resolve(target)
  backupRoot = resolve(backupRoot)
  const history = historyPath(backupRoot, target)
  return withOperation(history, { target, yes, dryRun }, (begin) =>
    installBatch(target, { yes, dryRun, now, backupRoot, history, begin }))
}

async function installBatch(target, { yes, dryRun, now, backupRoot, history, begin }) {
  const entries = planTargets(target)
  const changes = []
  const ownedEntries = []
  for (const entry of entries) {
    const kind = await entryKind(entry.destination)
    const owned = kind === "symlink" && await pointsTo(entry.destination, entry.source)
    if (!owned) changes.push({ ...entry, kind })
    else ownedEntries.push(entry.entry)
  }
  for (const entry of changes) await checkParents(target, entry)
  const batches = await readHistory(history)
  const baseline = await readBaseline(backupRoot, target, batches)
  for (const [entry, saved] of baseline) await checkSaved(entry, saved)
  const untracked = ownedEntries.filter((entry) => !baseline.has(entry))
  if (changes.length && !yes && !dryRun) throw new Error("Refusing to change targets without --yes. Review --dry-run first.")
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  if (dryRun) return { action: "install", target, backup: changes.length ? join(backupRoot, `${stamp}-*`) : undefined, changes: changes.map(({ entry, kind }) => `${entry}: ${kind}`), untracked }
  if (!changes.length) return { action: "install", target, backup: undefined, changes: [], moved: [], untracked }

  const backup = await mkdtemp(join(backupRoot, `${stamp}-`))
  const moved = changes.filter(({ kind }) => kind !== "missing").map(({ entry }) => entry)
  const created = changes.filter(({ kind }) => kind === "missing").map(({ entry }) => entry)
  await writeFile(join(backup, "manifest.json"), `${JSON.stringify({ version: 1, target, moved, created }, null, 2)}\n`)
  await begin({ action: "install", backup })
  for (const entry of changes) {
    await mkdir(dirname(entry.destination), { recursive: true })
    if (entry.kind !== "missing") {
      const saved = join(backup, entry.entry)
      await mkdir(dirname(saved), { recursive: true })
      await rename(entry.destination, saved)
    }
    await symlink(entry.source, entry.destination)
  }
  await writeHistory(history, [...batches, basename(backup)])
  return { action: "install", target, backup, changes: changes.map(({ entry }) => entry), moved, untracked }
}

async function readManifest(backup, target) {
  const manifest = JSON.parse(await readFile(join(backup, "manifest.json"), "utf8"))
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
      Object.keys(manifest).some((key) => !["version", "target", "moved", "created"].includes(key)) ||
      ("version" in manifest && manifest.version !== 1) ||
      typeof manifest.target !== "string" || !Array.isArray(manifest.moved) || !Array.isArray(manifest.created) ||
      [...manifest.moved, ...manifest.created].some((entry) => typeof entry !== "string") ||
      new Set([...manifest.moved, ...manifest.created]).size !== manifest.moved.length + manifest.created.length) {
    throw new Error("Unsupported or malformed installer backup manifest.")
  }
  if (resolve(manifest.target) !== resolve(target)) throw new Error("Backup belongs to a different target directory.")
  for (const entry of [...manifest.moved, ...manifest.created]) {
    if (!MANAGED_TARGETS.includes(entry)) throw new Error(`Unknown backup target: ${entry}`)
  }
  return manifest
}

function addBaseline(baseline, backup, manifest) {
  // The first change records the pre-install state; later batches are kept for recovery.
  for (const entry of manifest.moved) {
    if (!baseline.has(entry)) baseline.set(entry, join(backup, entry))
  }
  for (const entry of manifest.created) {
    if (!baseline.has(entry)) baseline.set(entry, null)
  }
}

async function readBaseline(root, target, batches) {
  const baseline = new Map()
  for (const batch of batches) {
    const backup = join(root, batch)
    const manifest = await readManifest(backup, target)
    if (manifest.version !== 1) throw new Error("Unsupported manifest in active installer history.")
    addBaseline(baseline, backup, manifest)
  }
  return baseline
}

async function checkSaved(entry, saved) {
  if (saved && await entryKind(saved) === "missing") {
    throw new Error(`Backup target is missing: ${entry} (${saved})`)
  }
}

export async function restore(target, { yes = false, dryRun = false, backup, backupRoot } = {}) {
  target = resolve(target)
  const explicit = backup && await readManifest(backup, target)
  const root = resolve(backupRoot ?? (explicit?.version === 1 ? dirname(backup) : defaultBackupRoot))
  const history = historyPath(root, target)
  return withOperation(history, { target, yes, dryRun }, (begin) =>
    restoreBatches(target, { yes, dryRun, backup, explicit, root, history, begin }))
}

async function restoreBatches(target, { yes, dryRun, backup, explicit, root, history, begin }) {
  const batches = await readHistory(history)
  const selected = batches.length ? join(root, batches.at(-1)) : undefined
  const active = await readBaseline(root, target, batches)
  let baseline = active
  if (explicit) {
    if ((explicit.version === 1 && resolve(backup) !== selected) || (!explicit.version && selected)) {
      throw new Error("Explicit restore requires the latest active batch, or an older compatible manifest with no active install.")
    }
    baseline = new Map()
    addBaseline(baseline, backup, explicit)
  }
  const changes = []
  const untracked = []
  for (const entry of planTargets(target)) {
    if (!baseline.has(entry.entry)) {
      if (!active.has(entry.entry) && await pointsTo(entry.destination, entry.source)) untracked.push(entry.entry)
      continue
    }
    await checkParents(target, entry)
    const saved = baseline.get(entry.entry)
    const kind = await entryKind(entry.destination)
    if (kind !== "missing" && !(kind === "symlink" && await pointsTo(entry.destination, entry.source))) {
      throw new Error(`Refusing to restore over unmanaged target: ${entry.entry}`)
    }
    await checkSaved(entry.entry, saved)
    if (saved || kind !== "missing") changes.push({ ...entry, saved })
  }
  const result = { action: "restore", target, backup: backup || selected, changes: changes.map(({ entry }) => entry), untracked }
  if (dryRun) return result
  if ((changes.length || batches.length) && !yes) throw new Error("Refusing to alter managed targets without --yes.")
  if (!changes.length && !selected) return result
  await begin({ action: "restore", backups: explicit ? [resolve(backup)] : batches.map((batch) => join(root, batch)) })
  for (const entry of changes) await restoreEntry(target, entry)
  if (selected) await writeHistory(history, explicit ? batches.slice(0, -1) : [])
  return result
}

async function restoreEntry(target, entry) {
  await checkParents(target, entry)
  let staging
  try {
    let staged
    if (entry.saved) {
      const parent = dirname(entry.destination)
      await mkdir(parent, { recursive: true })
      staging = await mkdtemp(join(parent, ".opencode-restore-"))
      staged = join(staging, basename(entry.destination))
      await cp(entry.saved, staged, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true })
    }
    const kind = await entryKind(entry.destination)
    if (kind !== "missing" && !await pointsTo(entry.destination, entry.source)) {
      throw new Error(`Refusing to restore over unmanaged target: ${entry.entry}`)
    }
    if (kind !== "missing") await rm(entry.destination)
    if (staged) await rename(staged, entry.destination)
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true })
  }
}

function parseArgs(args) {
  const options = { dryRun: false, install: false, restore: false, yes: false, target: defaultTarget() }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === "--dry-run") options.dryRun = true
    else if (argument === "--install") options.install = true
    else if (argument === "--uninstall" || argument === "--restore") options.restore = true
    else if (argument === "--yes") options.yes = true
    else if (argument === "--target") options.target = args[++index]
    else if (argument === "--help") return null
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!isAbsolute(options.target)) throw new Error("--target must be an absolute path.")
  if (options.install === options.restore) throw new Error("Choose exactly one of --install or --uninstall/--restore.")
  return options
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    console.log("Usage: install.mjs (--install | --uninstall) [--dry-run] [--yes] [--target /absolute/path]")
    return
  }
  const result = options.install
    ? await install(options.target, options)
    : await restore(options.target, options)
  console.log(`${result.action}: ${result.changes.length} managed target(s) ${options.dryRun ? "would change" : "changed"}.`)
  console.log(`Target: ${result.target}`)
  console.log(`Latest batch: ${result.backup || "none"}`)
  if (result.untracked.length) {
    console.warn(`Untracked repository links left unchanged; any originals cannot be reliably restored: ${result.untracked.join(", ")}`)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
