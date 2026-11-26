import assert from "node:assert/strict"
import fs, { lstat, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { syncBuiltinESMExports } from "node:module"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import test from "node:test"
import { MANAGED_TARGETS, install, planTargets, pointsTo, restore } from "./install.mjs"

const backupRoot = (target) => join(target, "backups")

test("plans only the explicit public OpenCode targets", () => {
  assert.deepEqual(planTargets("/tmp/opencode").map(({ entry }) => entry), MANAGED_TARGETS)
  assert.equal(MANAGED_TARGETS.includes("node_modules"), false)
  assert.equal(MANAGED_TARGETS.includes("node_modules/context-mode"), false)
  assert.equal(MANAGED_TARGETS.includes("skills/context-mode-research"), false)
  assert.equal(MANAGED_TARGETS.includes("tui.json"), false)
})

test("auto-discovered global plugins resolve through installed symlinks", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-setup-plugin-paths-"))
  try {
    await install(target, { yes: true, backupRoot: backupRoot(target) })
    for (const name of ["compaction-reasoning.ts", "rtk.ts"]) {
      const actual = await realpath(join(target, "plugins", name))
      const expected = await realpath(resolve(import.meta.dirname, "../opencode/plugins", name))
      assert.equal(actual, expected)
    }
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test("reinstall creates no backup and rejects legacy manifests without removing installed links", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-setup-reinstall-"))
  try {
    const first = await install(target, { yes: true, backupRoot: backupRoot(target) })
    const next = await install(target, { yes: true, backupRoot: backupRoot(target), now: new Date("2030-01-01") })
    assert.equal(next.backup, undefined)
    assert.deepEqual(next.changes, [])
    const legacy = join(target, "legacy-backup")
    await mkdir(legacy)
    await writeFile(join(legacy, "manifest.json"), JSON.stringify({ target, moved: [], managed: MANAGED_TARGETS }))
    await assert.rejects(restore(target, { backup: legacy, yes: true }), /Unsupported or malformed/)
    for (const entry of planTargets(target)) assert(await pointsTo(entry.destination, entry.source))
    await restore(target, { backup: first.backup, yes: true })
    for (const entry of planTargets(target)) await assert.rejects(lstat(entry.destination), { code: "ENOENT" })
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test("rejects retired-target manifests without changing managed links", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-setup-legacy-retired-"))
  try {
    const installed = await install(target, { yes: true, backupRoot: backupRoot(target) })
    const oldManifest = join(target, "old-manifest")
    await mkdir(oldManifest)
    await writeFile(join(oldManifest, "manifest.json"), JSON.stringify({
      target,
      moved: [],
      created: ["opencode.json"],
      managed: MANAGED_TARGETS,
      retired: [{ entry: "skills/context-mode-research", source: "/legacy/context-mode-research" }],
    }))
    await assert.rejects(restore(target, { backup: oldManifest, yes: true }), /Unsupported or malformed/)
    for (const entry of planTargets(target)) assert(await pointsTo(entry.destination, entry.source))
    const manifest = JSON.parse(await readFile(join(installed.backup, "manifest.json"), "utf8"))
    assert.equal(manifest.created.length, MANAGED_TARGETS.length)
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test("restores a displaced original target without changing its backup", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-setup-moved-"))
  try {
    await writeFile(join(target, "opencode.json"), "original")
    const installed = await install(target, { yes: true, backupRoot: backupRoot(target) })
    await restore(target, { backup: installed.backup, yes: true })
    assert.equal(await readFile(join(target, "opencode.json"), "utf8"), "original")
    assert.equal(await readFile(join(installed.backup, "opencode.json"), "utf8"), "original")
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test("refuses restore over user-replaced files before changing any managed target", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-setup-user-replaced-"))
  try {
    const installed = await install(target, { yes: true, backupRoot: backupRoot(target) })
    await rm(join(target, "plugins"))
    await writeFile(join(target, "plugins"), "user replacement")
    await assert.rejects(restore(target, { backup: installed.backup, yes: true }), /unmanaged target: plugins/)
    assert.equal(await readFile(join(target, "plugins"), "utf8"), "user replacement")
    assert(await pointsTo(join(target, "opencode.json"), resolve(import.meta.dirname, "../opencode/opencode.json")))
  } finally {
    await rm(target, { recursive: true, force: true })
  }
})

test("uninstalls the selected target across additive batches without touching untracked links", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "opencode-setup-incremental-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, "target")
  const other = join(root, "other")
  const options = { yes: true, backupRoot: backupRoot(root) }
  const entry = (name) => planTargets(target).find(({ entry }) => entry === name)
  const config = entry("opencode.json")
  const additive = entry("skills/pr-review")
  const untracked = entry("skills/visual-qa")
  await mkdir(join(target, "skills"), { recursive: true })
  await writeFile(config.destination, "first original")
  await symlink(additive.source, additive.destination)
  await symlink(untracked.source, untracked.destination)
  const first = await install(target, options)
  assert.deepEqual(first.untracked, ["skills/visual-qa", "skills/pr-review"])

  await rm(additive.destination)
  await symlink("../local-review", additive.destination)
  await rm(config.destination)
  await writeFile(config.destination, "later replacement")
  const second = await install(target, options)
  assert.deepEqual(second.changes, ["opencode.json", "skills/pr-review"])
  await install(other, options)
  await mkdir(join(options.backupRoot, "v1-to-v2-backup"))
  const legacy = join(options.backupRoot, "legacy")
  await mkdir(legacy)
  await writeFile(join(legacy, "manifest.json"), JSON.stringify({ target, moved: [], managed: MANAGED_TARGETS }))

  await rm(additive.destination)
  await writeFile(additive.destination, "keep me")
  await assert.rejects(restore(target, options), /unmanaged target: skills\/pr-review/)
  assert.equal(await readFile(additive.destination, "utf8"), "keep me")
  assert(await pointsTo(config.destination, config.source))
  assert(await pointsTo(entry("plugins").destination, entry("plugins").source))
  await rm(additive.destination)

  const preview = await restore(target, { ...options, dryRun: true })
  assert.deepEqual(preview.changes, MANAGED_TARGETS.filter((name) => name !== untracked.entry))
  assert.deepEqual(preview.untracked, [untracked.entry])
  assert(await pointsTo(config.destination, config.source))
  const restored = await restore(target, options)
  assert.deepEqual(restored.changes, preview.changes)
  assert.equal(await readFile(config.destination, "utf8"), "first original")
  assert.equal(await readlink(additive.destination), "../local-review")
  assert(await pointsTo(untracked.destination, untracked.source))
  assert.equal(await readFile(join(second.backup, config.entry), "utf8"), "later replacement")
  assert.equal(await readFile(join(first.backup, config.entry), "utf8"), "first original")
  for (const removed of MANAGED_TARGETS.filter((name) => ![config.entry, additive.entry, untracked.entry].includes(name))) {
    await assert.rejects(lstat(entry(removed).destination), { code: "ENOENT" })
  }
  for (const { destination, source } of planTargets(other)) assert(await pointsTo(destination, source))

  const again = await restore(target, options)
  assert.deepEqual(again.changes, [])
  assert.deepEqual(again.untracked, [untracked.entry])
})

test("starts a fresh baseline on reinstall after a complete uninstall", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "opencode-setup-new-cycle-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, "target")
  const options = { yes: true, backupRoot: backupRoot(root) }
  const config = join(target, "opencode.json")
  await mkdir(target)
  await writeFile(config, "previous original")
  const first = await install(target, options)
  await restore(target, options)
  await rm(config)

  await install(target, options)
  await assert.rejects(restore(target, { ...options, backup: first.backup }), /latest active batch/)
  await restore(target, options)
  await assert.rejects(lstat(config), { code: "ENOENT" })
  assert.equal(await readFile(join(first.backup, "opencode.json"), "utf8"), "previous original")
})

test("blocks subsequent operations if uninstall restored files but could not clear history", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "opencode-setup-failed-uninstall-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, "target")
  const options = { yes: true, backupRoot: backupRoot(root) }
  const config = join(target, "opencode.json")
  await mkdir(target)
  await writeFile(config, "original")
  const installed = await install(target, options)
  const files = await readdir(options.backupRoot)
  const history = join(options.backupRoot, files.find((file) => file.startsWith("active-")))

  const originalRm = fs.rm
  fs.rm = async (path, ...args) => {
    if (path === history) throw new Error("injected history cleanup failure")
    return originalRm(path, ...args)
  }
  syncBuiltinESMExports()
  try {
    await assert.rejects(restore(target, options), /injected history cleanup failure/)
  } finally {
    fs.rm = originalRm
    syncBuiltinESMExports()
  }

  const marker = `${history}.operation`
  assert.deepEqual(JSON.parse(await readFile(marker, "utf8")).backups, [installed.backup])
  assert.equal(await readFile(config, "utf8"), "original")
  await writeFile(config, "new user file")
  await assert.rejects(install(target, options), (error) => error.message.includes(marker))
  await assert.rejects(restore(target, options), /operation marker/)
  await assert.rejects(restore(target, { ...options, dryRun: true }), /operation marker/)
  assert.equal(await readFile(config, "utf8"), "new user file")
  assert.equal(await readFile(join(installed.backup, "opencode.json"), "utf8"), "original")
  assert.deepEqual((await readdir(options.backupRoot)).sort(), [...files, basename(marker)].sort())
  await install(join(root, "other"), options)
})

test("preflights saved originals before install and releases the marker on preflight failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "opencode-setup-missing-original-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, "target")
  const options = { yes: true, backupRoot: backupRoot(root) }
  await mkdir(target)
  await writeFile(join(target, "opencode.json"), "original")
  const installed = await install(target, options)
  const saved = join(installed.backup, "opencode.json")
  await rm(saved)
  const { destination, source } = planTargets(target).find(({ entry }) => entry === "plugins")
  await rm(destination)
  await writeFile(destination, "leave untouched")

  await assert.rejects(install(target, options), /Backup target is missing: opencode.json/)
  assert.equal(await readFile(destination, "utf8"), "leave untouched")
  await writeFile(saved, "original")
  await install(target, options)
  assert(await pointsTo(destination, source))
})

test("preflights nested install destinations without following an external skills directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "opencode-setup-symlink-parent-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const target = join(root, "target")
  const external = join(root, "external")
  await mkdir(target)
  await mkdir(external)
  await symlink(external, join(target, "skills"))
  await assert.rejects(install(target, { yes: true, backupRoot: backupRoot(root) }), /symlink parent/)
  await assert.rejects(lstat(join(target, "opencode.json")), { code: "ENOENT" })
  await assert.rejects(lstat(join(external, "visual-qa")), { code: "ENOENT" })
})

test("recognizes only symlinks to the exact repository source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-setup-"))
  const source = join(directory, "source")
  const target = join(directory, "target")
  await mkdir(source)
  await writeFile(join(source, "file"), "source")
  await writeFile(target, "not a link")
  assert.equal(await pointsTo(target, join(source, "file")), false)
  await rm(target)
  await symlink(join(source, "file"), target)
  assert.equal(await pointsTo(target, join(source, "file")), true)
  assert.equal(await readlink(target), join(source, "file"))
  await rm(directory, { recursive: true, force: true })
})

test("allows a non-mutating install preview without confirmation", async () => {
  const target = await mkdtemp(join(tmpdir(), "opencode-setup-preview-"))
  const result = await install(target, { dryRun: true, backupRoot: backupRoot(target) })
  assert.equal(result.action, "install")
  assert.equal(result.changes.length, MANAGED_TARGETS.length)
  assert.deepEqual(await readdir(target), [])
  await rm(target, { recursive: true, force: true })
})
