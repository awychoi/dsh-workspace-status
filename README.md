# dsh-workspace-status

Colors each workspace folder glyph in the DeepSeek Harness sidebar by rolling
up what its sessions are doing:

| folder color | meaning |
|---|---|
| red | a session waits for you — approval, plan review, or a question |
| pulsing amber | at least one session, or one of its direct subagents, is working |
| green | a session finished while you were not looking; clears once every finished session in that workspace has been opened |
| unchanged (gray / blue) | idle, or everything already read |

Precedence is red → amber → green. The ungrouped bucket behaves the same for
sessions that belong to no workspace. Archived, blank, and subagent
conversations do not speak for a workspace; subagent work reaches its parent
through the running child count (the same direct children the header subagent
dropdown lists). Busy pulses are suppressed under `prefers-reduced-motion`.

## Install

Use **Plugins → Add plugin** with this directory, or:

```sh
dsh plugin add /path/to/dsh-workspace-status
```

Requires the shipped `ui-workspace` and `ui-session` client plugins, which the
standard Web composition mounts.

## Turn it off

Settings → General → **Workspace Status** has one switch. It defaults to on and
is stored in this browser's localStorage
(`dsh.workspace-status.settings.v1`). On first load it inherits the previous
value from `dsh.workspace-colors.settings.v1` or the combined
`dsh.workspace-open.settings.v1` key, if any.

## Implementation note

DSH does not yet expose a slot for decorating a workspace header row, so the
layer keys off the shipped row attribute `data-row-key="workspace:<id>"`. If a
future DSH release changes that markup, the layer stops painting and the folder
simply returns to its normal colors — nothing else breaks. A supported
`sidebar.workspaces.workspace.leading` seat would let this move to the normal
slot API.

The colors use the theme's own status tokens, so light and dark themes both
work. The existing glyph is recolored in place — the open/closed folder shape
and the hover chevron stay intact.
