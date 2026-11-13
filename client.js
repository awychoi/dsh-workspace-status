/**
 * Workspace status colors for the left sidebar: each workspace folder glyph
 * rolls up the state of its sessions — red for a pending user decision,
 * pulsing amber while any session (or one of its direct subagents) is working,
 * and green while a finished session's completion is still unread.
 *
 * The layer reads the shipped Session and Workspace snapshots through the
 * standard slot hooks and paints the existing folder glyph in place; it adds
 * no session data of its own. One switch in Settings → General turns it off.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-status',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'workspaceStatus'

    const en = {
      'settings.title': 'Workspace Status',
      'settings.description': 'Red while a session waits for you, pulsing amber while work runs, green until a finished session is read.',
      'settings.toggle': 'Show on workspace folders',
    }
    const zh = {
      'settings.title': '工作区状态',
      'settings.description': '会话等待操作时显示红色，运行中显示琥珀色脉冲，完成后未读显示绿色。',
      'settings.toggle': '在工作区文件夹上显示',
    }

    // #region workspace tone model
    /** Group key of the bucket for Sessions outside every Workspace. */
    const UNGROUPED_KEY = ''
    /** Higher wins when one Workspace holds Sessions in several states. */
    const TONE_RANK = { done: 1, busy: 2, attention: 3 }
    /** Pending interactions that wait on a person; others are background work. */
    const USER_ATTENTION_KINDS = new Set(['approval', 'plan-review', 'question'])

    /**
     * Count running direct subagent children per parent: Host-listed child
     * rows plus the loaded subagent catalog, deduplicated by child id.
     * @param list - Session list snapshot.
     * @param statuses - unified Session UI status by Session.
     * @returns running child count by parent Session id.
     */
    function runningSubagentCounts(list, statuses) {
      const children = new Map()
      const mark = (parentId, childId) => {
        let set = children.get(parentId)
        if (set === undefined) {
          set = new Set()
          children.set(parentId, set)
        }
        set.add(childId)
      }
      for (const row of Object.values(list.byId ?? {})) {
        if (row === undefined || row.origin !== 'subagent' || row.parentId === undefined) continue
        if ((statuses.get(row.id)?.running ?? row.running) === true) mark(row.parentId, row.id)
      }
      for (const [parentId, projection] of Object.entries(list.projectionsBySession ?? {})) {
        const catalog = projection?.values?.subagentCatalog
        if (!Array.isArray(catalog)) continue
        for (const entry of catalog) {
          if (entry.mode === 'external') continue
          if ((statuses.get(entry.id)?.running ?? list.byId?.[entry.id]?.running) === true) mark(parentId, entry.id)
        }
      }
      const counts = new Map()
      for (const [parentId, set] of children) counts.set(parentId, set.size)
      return counts
    }

    /**
     * Busiest tone per Workspace key (the ungrouped bucket uses `''`).
     * Archived, blank, and subagent Sessions do not speak for a Workspace;
     * subagent work reaches its parent through the running child count.
     * @param workspaces - Workspace snapshot with `items` and `archivedSessionIds`.
     * @param list - Session list snapshot.
     * @param statuses - unified Session UI status by Session.
     * @returns tone by Workspace key, omitted where the folder stays default.
     */
    function workspaceTones(workspaces, list, statuses) {
      const tones = new Map()
      const archived = new Set(workspaces?.archivedSessionIds ?? [])
      const counts = runningSubagentCounts(list, statuses)
      const membership = new Set()
      const consider = (key, sessionId) => {
        if (archived.has(sessionId)) return
        const row = list.byId?.[sessionId]
        if (row === undefined || row.blank === true || row.origin === 'subagent') return
        const status = statuses.get(sessionId)
        const pending = status?.pendingInteraction
        const attention = pending !== undefined && USER_ATTENTION_KINDS.has(pending.kind)
        const running = status?.running ?? row.running
        const busy = running === true || (counts.get(sessionId) ?? 0) > 0
        const tone = attention
          ? 'attention'
          : busy ? 'busy'
            : status?.completionUnread === true ? 'done' : undefined
        if (tone === undefined) return
        const previous = tones.get(key)
        if (previous === undefined || TONE_RANK[tone] > TONE_RANK[previous]) tones.set(key, tone)
      }
      for (const workspace of workspaces?.items ?? []) {
        for (const sessionId of workspace.sessionIds ?? []) {
          membership.add(sessionId)
          consider(String(workspace.workspaceId), sessionId)
        }
      }
      for (const sessionId of list.ids ?? []) {
        if (membership.has(sessionId)) continue
        consider(UNGROUPED_KEY, sessionId)
      }
      return tones
    }
    // #endregion

    // #region preference
    const SETTINGS_KEY = 'dsh.workspace-status.settings.v1'
    /** Keys written before the plugin was renamed or split. */
    const LEGACY_SETTINGS_KEYS = [
      'dsh.workspace-colors.settings.v1',
      'dsh.workspace-open.settings.v1',
    ]

    /** @returns the persisted switch, defaulting to on. */
    function readSettings() {
      for (const key of [SETTINGS_KEY, ...LEGACY_SETTINGS_KEYS]) {
        try {
          const raw = window.localStorage.getItem(key)
          if (raw === null) continue
          const parsed = JSON.parse(raw)
          if (parsed !== null && typeof parsed === 'object' && typeof parsed.colors === 'boolean') {
            return { colors: parsed.colors }
          }
        } catch (_error) {
          // Storage disabled or corrupt: try the next key, then the default.
        }
      }
      return { colors: true }
    }

    let settings = readSettings()
    // Pin the value (including one migrated from an older key) so a previous
    // plugin identity cannot overwrite it later.
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch (_error) {
      // An unavailable storage keeps the default for this page only.
    }
    const settingsListeners = new Set()
    // #endregion

    /** Theme palette colors shared with the Session status dots. */
    const TONE_COLOR = {
      attention: 'var(--dsw-alias-state-error-primary)',
      busy: 'var(--dsw-alias-state-warn-primary)',
      done: 'var(--dsw-alias-state-success-primary)',
    }
    const PULSE_NAME = 'dsh-workspace-status-busy-pulse'
    /** Workspace header rows carry `workspace:<workspaceId>`; ungrouped is empty. */
    const WORKSPACE_ROW_SELECTOR = '[data-row-key^="workspace:"]'
    const WORKSPACE_ROW_PREFIX = 'workspace:'
    const EMPTY_TONES = new Map()

    /** Shared stylesheet: the busy pulse and the settings row. */
    const STYLES = `
@keyframes ${PULSE_NAME}{0%,100%{opacity:1}50%{opacity:.45}}
.dsh-workspace-status-row{display:flex;flex-direction:column;gap:12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-workspace-status-row-head{display:flex;flex-direction:column;gap:4px}
.dsh-workspace-status-row-title{font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-primary)}
.dsh-workspace-status-row-desc{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-workspace-status-option{display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer}
.dsh-workspace-status-option-label{font-size:13px;font-weight:400;line-height:20px;color:var(--dsw-alias-label-secondary)}
.dsh-workspace-status-switch{appearance:none;-webkit-appearance:none;flex:none;position:relative;width:34px;height:20px;margin:0;border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);cursor:pointer;transition:background 120ms ease}
.dsh-workspace-status-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary);transition:transform 120ms ease}
.dsh-workspace-status-switch:checked{background:var(--dsw-alias-brand-primary)}
.dsh-workspace-status-switch:checked::after{transform:translateX(14px);background:var(--dsw-alias-bg-base)}
.dsh-workspace-status-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
`

    let reducedMotionQuery
    /** @returns true when the user asked the platform not to animate. */
    function prefersReducedMotion() {
      if (reducedMotionQuery === undefined) {
        reducedMotionQuery = typeof window.matchMedia === 'function'
          ? window.matchMedia('(prefers-reduced-motion: reduce)')
          : null
      }
      return reducedMotionQuery?.matches === true
    }

    /** @param row - workspace header row. @returns its 16px leading glyph cell. */
    function folderCell(row) {
      const cell = row.firstElementChild
      return cell === null || cell === undefined ? undefined : cell
    }

    /**
     * Paint the shipped folder glyph for each current row. Inline `color`
     * overrides the shipped `.slot` / `.folderActive` rules without touching
     * the icon, so the open/closed shape and the hover chevron stay intact.
     * @param tones - tone by Workspace key.
     */
    function applyWorkspaceTones(tones) {
      const animated = !prefersReducedMotion()
      for (const row of document.querySelectorAll(WORKSPACE_ROW_SELECTOR)) {
        const cell = folderCell(row)
        if (cell === undefined) continue
        const key = row.getAttribute('data-row-key')?.slice(WORKSPACE_ROW_PREFIX.length)
        const tone = key === undefined ? undefined : tones.get(key)
        if (tone === undefined) {
          if (row.hasAttribute('data-dsh-workspace-tone')) row.removeAttribute('data-dsh-workspace-tone')
        } else {
          row.setAttribute('data-dsh-workspace-tone', tone)
        }
        const color = tone === undefined ? '' : TONE_COLOR[tone]
        if (cell.style.color !== color) cell.style.color = color
        const animation = tone === 'busy' && animated ? `${PULSE_NAME} 1.6s ease-in-out infinite` : ''
        if (cell.style.animation !== animation) cell.style.animation = animation
      }
    }

    /** Restore the shipped colors when the layer unloads. */
    function clearWorkspaceTones() {
      for (const row of document.querySelectorAll(WORKSPACE_ROW_SELECTOR)) {
        if (row.hasAttribute('data-dsh-workspace-tone')) row.removeAttribute('data-dsh-workspace-tone')
        const cell = folderCell(row)
        if (cell === undefined) continue
        cell.style.color = ''
        cell.style.animation = ''
      }
    }

    /**
     * Renderless frame-wide layer: computes the rollup whenever the Session,
     * status, or Workspace snapshots change, and repaints after the sidebar
     * mounts or replaces a header row.
     * @param props - standard slot hooks.
     */
    function TonePainter({ useWorkspaces, useSessions, useSessionStatus }) {
      const workspaces = useWorkspaces(state => state)
      const list = useSessions(state => state)
      const statuses = useSessionStatus(state => state)
      const latest = React.useRef(EMPTY_TONES)
      const tones = React.useMemo(
        () => workspaceTones(workspaces, list, statuses),
        [workspaces, list, statuses],
      )
      latest.current = tones

      React.useEffect(() => { applyWorkspaceTones(tones) }, [tones])

      React.useEffect(() => {
        // The sidebar can remount the list area on layout changes, so observe
        // the document and repaint only when a workspace row is added.
        const reapply = () => { applyWorkspaceTones(latest.current) }
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.addedNodes) {
              if (node.nodeType !== 1) continue
              if (node.matches?.(WORKSPACE_ROW_SELECTOR) === true
                || node.querySelector?.(WORKSPACE_ROW_SELECTOR) !== null) {
                reapply()
                return
              }
            }
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
        reapply()
        return () => {
          observer.disconnect()
          clearWorkspaceTones()
        }
      }, [])

      return null
    }

    /**
     * Frame-wide seat that always carries the shared stylesheet and mounts the
     * painter only while the preference is on.
     * @param props - slot props.
     */
    function WorkspaceColorsOverlay(props) {
      const settings = useSettings()
      const canPaint = props.useWorkspaces !== undefined
        && props.useSessions !== undefined
        && props.useSessionStatus !== undefined
      return h(React.Fragment, null,
        h('style', { 'data-dsh-workspace-status': 'styles' }, STYLES),
        settings.colors === true && canPaint ? h(TonePainter, props) : null,
      )
    }

    /**
     * General-settings row with the single switch.
     * @param props - localized copy.
     */
    function WorkspaceColorsSettingsRow({ t }) {
      const settings = useSettings()
      return h('div', {
        className: 'dsh-workspace-status-row',
        'data-dsh-workspace-status': 'settings-row',
      },
      h('div', { className: 'dsh-workspace-status-row-head' },
        h('div', { className: 'dsh-workspace-status-row-title' }, t('settings.title')),
        h('div', { className: 'dsh-workspace-status-row-desc' }, t('settings.description'))),
      h('label', { className: 'dsh-workspace-status-option' },
        h('span', { className: 'dsh-workspace-status-option-label' }, t('settings.toggle')),
        h('input', {
          type: 'checkbox',
          className: 'dsh-workspace-status-switch',
          checked: settings.colors === true,
          onChange: (event) => { updateSettings({ colors: event.target.checked }) },
        })))
    }

    return {
      inject: ['locale', 'slots'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'workspace-status: dictionaries')

        ctx.slots.inject('settings.general.item', () => ctx.slots.register({
          name: 'settings.general.item',
          id: 'workspace-status',
          order: 51,
          locale: NS,
        }, WorkspaceColorsSettingsRow))

        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'workspace-status.tone',
          order: 41,
        }, WorkspaceColorsOverlay))
      },
    }
  },
})
