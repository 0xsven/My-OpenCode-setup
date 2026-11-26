---
description: Review a GitHub pull request and return short, actionable findings
---

Review this pull request: $ARGUMENTS

Assign the review to a fresh `general-read` worker, or `deep-read` if there is a specific consequential risk that warrants deeper judgment. Include the PR target and instruct the worker to load `pr-review`, make no edits, and report only actionable findings and material verification limits. Relay the concise findings without a second summary.
