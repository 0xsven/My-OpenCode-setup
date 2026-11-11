import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const config = JSON.parse(readFileSync(new URL("../opencode.json", import.meta.url), "utf8"))

test("compaction configures GPT-6.1 Sol/medium without replacing the native prompt or permissions", () => {
  assert.deepEqual(config.agent.compaction, {
    model: "openai/gpt-6.1-sol",
    variant: "medium",
    options: { reasoningEffort: "medium" },
  })
  assert.equal(config.default_agent, "plan")
  assert.equal(Object.hasOwn(config.agent.plan, "prompt"), false)
  assert.equal(Object.hasOwn(config.agent.plan, "model"), false)
  // Both readers apply singular agent.permission; a permission nested under
  // native agents is silently discarded instead of constraining delegation.
  assert.deepEqual(Object.entries(config.agent.plan.permission.task), [
    ["*", "deny"], ["quick-plan", "allow"], ["deep-plan", "allow"], ["visual", "allow"],
  ])
  assert.deepEqual(config.agent.general.permission, { task: "deny" })
  assert.equal(Object.hasOwn(config, "agents"), false)
})

test("planning workers deny writes and limit delegation to read-only research", () => {
  const expectedPermissionBlock = `permission:
  "*": deny
  read:
    "*": allow
    "*.env": ask
    "*.env.*": ask
    "*.env.example": allow
  glob: allow
  grep: allow
  list: allow
  webfetch: allow
  websearch: allow
  skill: allow
  edit: deny
  bash: deny
  task: deny`

  const assertCanonicalPermissions = (source, label, expected = expectedPermissionBlock) => {
    const frontmatter = source.match(/^---\n([\s\S]*?)\n---/)
    assert.ok(frontmatter, `${label} has frontmatter`)
    const lines = frontmatter[1].split("\n")
    const start = lines.indexOf("permission:")
    assert.notEqual(start, -1, `${label} has a permission mapping`)
    let end = start + 1
    while (end < lines.length && lines[end].startsWith("  ")) end++
    assert.equal(lines.slice(start, end).join("\n"), expected, label)
  }

  for (const name of ["quick-plan", "deep-plan"]) {
    const source = readFileSync(new URL(`../agents/${name}.md`, import.meta.url), "utf8")
    const expected = name === "deep-plan"
      ? expectedPermissionBlock.replace("  task: deny", '  task:\n    "*": deny\n    quick-plan: allow')
      : expectedPermissionBlock
    assertCanonicalPermissions(source, name, expected)
  }

  const validFrontmatter = `---\n${expectedPermissionBlock}\n---`
  assert.throws(() => assertCanonicalPermissions(validFrontmatter.replace("permission:\n", ""), "missing-header"))
  assert.throws(() => assertCanonicalPermissions(validFrontmatter.replace("task: deny", "task: deny\n  chrome-devtools_evaluate_script: allow"), "extra-mcp-allow"))
})

test("automatic compaction preserves a 15k recent tail without changing pruning or turn limits", () => {
  assert.deepEqual(config.compaction, {
    auto: true,
    reserved: 32000,
    preserve_recent_tokens: 15000,
  })
})

test("every configured model has the 272k context/input cap and a 240k compaction threshold", () => {
  const models = Object.entries(config.provider).flatMap(([provider, config]) =>
    Object.entries(config.models ?? {}).map(([name, model]) => [`${provider}/${name}`, model]))
  assert.equal(models.length, 3)
  for (const [name, model] of models) {
    const expectedLimit = { context: 272000, input: 272000, output: 128000 }
    const expectedThreshold = expectedLimit.input - config.compaction.reserved
    assert.equal(expectedThreshold, 240000, name)
    assert.deepEqual(model.limit, expectedLimit, name)

    // Simulate an inherited upstream catalog limit to verify the explicit override.
    const catalog = { context: 1050000, input: 922000, output: 128000 }
    const resolved = { ...catalog, ...model.limit }
    const threshold = Math.max(0, resolved.input - config.compaction.reserved)
    assert.equal(threshold, expectedThreshold, name)
    assert.equal(expectedThreshold - 1 >= threshold, false, name)
    assert.equal(expectedThreshold >= threshold, true, name)
  }
})
