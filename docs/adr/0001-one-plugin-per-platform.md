# One plugin and one Channel per Platform

Each Platform gets its own plugin containing its own Channel (MCP server), the way the official discord and telegram plugins are built. We considered a single plugin whose one MCP server loads an adapter per Platform, and rejected it because Claude Code's controls all work at plugin or server granularity:

- An organization's `allowedChannelPlugins` list names plugins, so a unified plugin could not be approved for one Platform without approving all of them.
- `--channels` opts servers into a session one by one, which already gives users per-Platform selection.
- The `claude/channel/permission` capability is declared per server, so one Platform that cannot authenticate senders would force every Platform to give up permission relay.
- The `source` attribute on a `<channel>` tag comes from the server name, so a unified server could only tell Platforms apart through its own `meta` keys.

## Consequences

Code shared between Platforms cannot be imported from outside a plugin's directory, because installing a plugin copies only that directory. Shared code will live in `packages/core` and reach each plugin through a symlink, which Claude Code dereferences at install time for targets inside the same marketplace. Workspace or folder dependencies are not an option: Claude Code skips the dependency install for any plugin that has one.

### Symlink install check (2026-11-10)

The symlink route works. It was checked on macOS with Claude Code 2.1.322, using a throwaway copy of the marketplace that held an empty-shell plugin with `plugins/symlink-shell/core -> ../../packages/core`. The shell plugin never entered this repository.

- Marketplace added as a git source: the installed copy in the plugin cache has `core/` as a real directory holding the target's files.
- Marketplace added from a local path: `claude plugin install` produced the same cache copy, link dereferenced. The documentation says such links are skipped for plugins installed from a local path; that is not what happened. A session reads a local-path plugin from its source directory, where the link resolves by itself.

The same run showed that a plugin's registry dependencies are installed from `bun.lock` into the cache copy with no manual step, for both ways of adding the marketplace.

Not checked: Windows, where creating a symlink needs Developer Mode or an elevated prompt, and a session actually loading code through the copied directory.
