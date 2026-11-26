---
name: visual-qa
description: Bounded, read-only rendered UI verification using the browse MCP.
---

# Visual QA

For unattended QA, use the existing browse MCP with tabs you open and own; do not use borrowed/shared tabs. Do not use `keepVisible` or foreground tabs. Test only local/test environments with authorized data; do not perform destructive production actions. Inspect the rendered page at relevant viewports and intended states, exercise assigned interactions, and compare against supplied designs/references where available. Capture screenshots and concise evidence, including measurable discrepancies, focus behavior where relevant, and material verification limits; close every tab you opened. Do not depend on Desktop.

If blocked on a genuine user-only step (such as authentication, MFA, a challenge, or a reproduction or screen you cannot reach), do not try to complete it yourself. As a QA worker, report the blocker, the exact user action needed, and—when relevant—the tab ID, group, and current URL to the parent. Leave your tab open pending the parent's decision; do not call `handoff` or `demonstrate` yourself.

The parent owns escalation. If the assigned tab is accessible and authorized, use browse `handoff` for authentication or other user-only steps and `demonstrate` for non-sensitive reproductions. Otherwise, ask in chat for the exact action or reproduction details; if browser state is needed, ask the user to lend the relevant tab through the Browse extension. Resume the existing worker with only the necessary context and authorized tab details. On completion or cancellation, have the worker close its own tabs and return any borrowed tab without closing the user's browser tab.

Do not change unattended/background behavior or require Desktop for collaborative help. Use native Desktop browser only when appropriate and attached (load the built-in `browser` skill first).

QA-only assignments are read-only: report observed behavior, evidence, and limits; make no edits.
