import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const config = JSON.parse(readFileSync(new URL("../opencode.json", import.meta.url), "utf8"))

test("compaction uses the known default model and medium variant", () => {
  assert.equal(config.model, "openai/gpt-6.2-sol")
  assert.equal(config.agents.compaction.model, "openai/gpt-6.2-sol#medium")
  assert.ok(config.providers.openai.models["gpt-6.2-sol"])
  assert.equal(config.default_agent, "plan")
})

test("Plan can delegate only to the three read profiles", () => {
  const permissions = config.agents.plan.permissions
  assert.deepEqual(
    permissions.filter(({ action }) => action === "subagent").map(({ resource, effect }) => [resource, effect]),
    [["*", "deny"], ["quick-read", "allow"], ["general-read", "allow"], ["deep-read", "allow"]],
  )
  assert.equal(config.agents.general.disabled, true)
})

test("read workers deny writes and limit delegation to read-only research", () => {
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
  browse_tabs: allow
  browse_status: allow
  browse_navigate: allow
  browse_snapshot: allow
  browse_wait_for: allow
  browse_emulate: allow
  browse_click: allow
  browse_fill: allow
  browse_select: allow
  browse_press: allow
  browse_hover: allow
  browse_drag: allow
  browse_scroll: allow
  browse_screenshot: allow
  edit: deny
  bash:
    "*": deny
    "gh pr view *": allow
    "gh pr diff *": allow
    "gh pr list *": allow
    "gh pr checks *": allow
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

  for (const name of ["quick-read", "general-read", "deep-read"]) {
    const source = readFileSync(new URL(`../agents/${name}.md`, import.meta.url), "utf8")
    const expected = name === "deep-read"
      ? expectedPermissionBlock.replace("  task: deny", '  task:\n    "*": deny\n    quick-read: allow')
      : expectedPermissionBlock
    assertCanonicalPermissions(source, name, expected)
  }

  const validFrontmatter = `---\n${expectedPermissionBlock}\n---`
  assert.throws(() => assertCanonicalPermissions(validFrontmatter.replace("permission:\n", ""), "missing-header"))
  assert.throws(() => assertCanonicalPermissions(validFrontmatter.replace("task: deny", "task: deny\n  chrome-devtools_evaluate_script: allow"), "extra-mcp-allow"))
})

test("automatic compaction preserves the configured recent tail", () => {
  assert.equal(config.compaction.auto, true)
  assert.equal(config.compaction.keep.tokens, 15000)
  assert.equal(config.compaction.buffer, 32000)
})
