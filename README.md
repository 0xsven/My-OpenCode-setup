# My Agent Setup

Requires OpenCode Desktop or CLI and Node.js 22+.

## Install

```sh
git clone git@github.com:0xsven/My-OpenCode-setup.git
cd My-OpenCode-setup
node scripts/install.mjs --install --yes
```

The installer symlinks the configuration into `~/.config/opencode`
and backs up existing managed files. Use `--target /absolute/path` to select
a different directory, and `--dry-run` to preview changes.

OpenCode V2 reloads configuration changes automatically. Use `/reload` if the
new configuration isn't picked up.

## Worker profiles

| Tier | Project edits denied | Project edits permitted |
| --- | --- | --- |
| Quick (Luna) | `quick-read` | `quick-write` |
| General (Sol) | `general-read` | `general-write` |
| Deep (Astra) | `deep-read` | `deep-write` |

Plan delegates only to read workers. Build can use either column. Skills define
how to do the work; the parent picks the tier, context, and when to run in parallel.

Deep workers can delegate bounded evidence gathering to `quick-read` at a
second level. Quick and General workers cannot delegate. The Deep worker
still owns the judgment and verifies decisive evidence.

## Visual QA

Unattended checks use `browse` in background Chrome tabs, from either the
terminal or Desktop. Install `browse` at `~/.local/bin/browse` and connect its
Chrome extension; OpenCode Desktop does not need to be attached. Use
`@visual-qa` to request a rendered check explicitly. If a worker gets stuck on
a step only you can perform, the parent agent will ask you for help and resume
the check afterward.

## Uninstall

```sh
node scripts/install.mjs --uninstall --yes
```

Uninstall covers all active install batches for the selected target. It restores
the state recorded the first time each path was changed in that install cycle,
leaves the backups intact, and refuses to overwrite a user replacement.
Existing links to this repository without active installer history (including
manual links and links from older installs) are reported and left untouched:
the installer cannot reliably tell what they replaced.

If install or uninstall reports an operation marker, wait if another installer
is running. After a failure or interruption, keep the backups and inspect the
marker, batch manifests, target files, and active history at the reported paths.
An interrupted install's batch manifest lists planned moves; verify which
actually happened. Reconcile the files and history before removing the marker
and retrying. For example, if uninstall restored all files but failed to clear
the active history, archive that history before clearing the marker. Partial
operations are not automatically rolled back.
