import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const config = JSON.parse(readFileSync(new URL("../opencode.json", import.meta.url), "utf8"))
const openai = config.providers.openai

test("OpenAI defaults and model capabilities are configured", () => {
  assert.deepEqual(openai.settings, {
    reasoningEffort: "medium",
    reasoningSummary: "auto",
    textVerbosity: "low",
  })
  assert.deepEqual(openai.body, {
    include: ["reasoning.encrypted_content"],
    store: false,
  })
  assert.equal(config.model, "openai/gpt-6.2-sol")

  for (const name of ["gpt-6.2-sol", "gpt-6-luna", "gpt-6.2-astra"]) {
    const model = openai.models[name]
    assert.ok(model, `${name} is configured`)
    assert.deepEqual(model.limit, { context: 272000, input: 272000, output: 128000 }, name)
    assert.deepEqual(model.capabilities, { input: ["text", "image"], output: ["text"] }, name)
  }
})
