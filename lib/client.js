/* dsh-design-workspace · 浏览器半片
 * 手写 __ModuleLoader__ 包装（与 dsh-drawai / dsh-media-desk 同一格式），不经过打包器。
 * 只注册一个会话右栏页签：一个交付物 = 一块画布，没有项目库、没有页条、没有模式下拉。
 */
window.__ModuleLoader__.load({
  id: 'dsh-design-workspace',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports

    const React = require('react')
    const h = React.createElement

    const ID = 'design-workbench'
    const KIND = 'design-workbench'
    const API = '/design-workspace/api/state'

    const C = {
      ink: '#1b1b1b',
      mid: '#6b6b66',
      line: '#dcdcd6',
      soft: '#f6f6f2',
      accent: '#2b5fa3',
    }

    function tabAddress(props) {
      return props?.address || props?.tab?.address || props?.scope?.address || null
    }

    function Title() {
      return h('span', null, '设计工作台')
    }

    function Pill({ children, dim }) {
      return h(
        'span',
        {
          style: {
            fontSize: 10,
            padding: '2px 7px',
            border: `1px solid ${dim ? C.line : C.ink}`,
            color: dim ? C.mid : C.ink,
            borderRadius: 999,
            whiteSpace: 'nowrap',
          },
        },
        children,
      )
    }

    function Empty() {
      return h(
        'div',
        {
          style: {
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 10,
            textAlign: 'center',
            padding: 24,
          },
        },
        h('div', { style: { fontSize: 13, color: C.ink } }, '这里出结果，不出过程。'),
        h(
          'div',
          { style: { fontSize: 11.5, color: C.mid, lineHeight: 1.8, maxWidth: 320 } },
          '在对话里说清楚要交付什么。产物写进 .design-work/，这块画布跟着刷新；要改就选中一块，回对话里说。',
        ),
      )
    }

    function Body(props) {
      const address = tabAddress(props)
      const [state, setState] = React.useState({ loading: !!address, error: null, data: null })
      const [nonce, setNonce] = React.useState(0)

      React.useEffect(() => {
        if (!address) return undefined
        let alive = true
        setState((s) => ({ ...s, loading: true, error: null }))
        fetch(`${API}?path=${encodeURIComponent(address)}`, { headers: { accept: 'application/json' } })
          .then(async (r) => {
            const body = await r.json()
            if (!r.ok || !body.ok) throw new Error(body.error || `HTTP ${r.status}`)
            if (alive) setState({ loading: false, error: null, data: body })
          })
          .catch((err) => {
            if (alive) setState({ loading: false, error: String(err.message || err), data: null })
          })
        return () => {
          alive = false
        }
      }, [address, nonce])

      const data = state.data
      const title = data?.work?.title || '设计工作台'
      const latest = data?.latest

      return h(
        'div',
        {
          style: {
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            background: '#fff',
            color: C.ink,
            font: '12px/1.5 "Microsoft YaHei", "Segoe UI", sans-serif',
          },
        },
        // 一条头：交付物身份 + 导出；不再有“项目头 + 设备档 + 全部页”三层
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderBottom: `1px solid ${C.line}`,
            },
          },
          h('div', { style: { minWidth: 0, flex: 1 } },
            h('div', { style: { fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, title),
            h('div', { style: { fontSize: 9.5, color: C.mid, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, data?.root || '.design-work/'),
          ),
          h(Pill, { dim: true }, state.loading ? '读取中' : data ? '草稿' : '未开始'),
          h('button', {
            type: 'button',
            disabled: true,
            title: '导出在 P1 接线',
            style: {
              font: 'inherit', fontSize: 10, padding: '3px 9px', border: `1px solid ${C.line}`,
              background: '#fff', color: C.mid, cursor: 'not-allowed',
            },
          }, '导出'),
        ),
        // 画布：只放产物本身（P1 接 workspaceFiles 预览通道）
        h('div', { style: { flex: 1, minHeight: 0, padding: 10, background: C.soft } },
          h('div', {
            style: {
              height: '100%',
              border: `1px solid ${C.line}`,
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            },
          },
            state.error
              ? h('div', { style: { padding: 16, color: '#a8352b', fontSize: 11, lineHeight: 1.7 } },
                  `读不到交付物：${state.error}`,
                  h('div', { style: { marginTop: 8 } },
                    h('button', {
                      type: 'button',
                      onClick: () => setNonce((n) => n + 1),
                      style: { font: 'inherit', fontSize: 10, padding: '3px 9px', border: `1px solid ${C.ink}`, background: '#fff', cursor: 'pointer' },
                    }, '重试'),
                  ),
                )
              : !address || !data
                ? h(Empty)
                : h('div', { style: { padding: 12, display: 'flex', flexDirection: 'column', gap: 8 } },
                    latest
                      ? h('div', { style: { border: `1px solid ${C.line}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 4 } },
                          h('div', { style: { fontSize: 9, letterSpacing: '.6px', color: '#9a9a92' } }, '最新产物'),
                          h('div', { style: { fontSize: 12, fontWeight: 600 } }, latest.rel),
                          h('div', { style: { fontSize: 10, color: C.mid } }, `${latest.kind} · ${(latest.size / 1024).toFixed(1)} KB`),
                        )
                      : h(Empty),
                    h('div', { style: { fontSize: 10, color: C.mid, lineHeight: 1.7 } },
                      '预览通道 P1 接线：HTML 用沙箱 iframe，PPT/Word 用页图。现在先只读状态。'),
                  ),
          ),
        ),
        // 一条底：版本 / 产物数 / 缩放；多页产物才出现页条，这里没有
        h(
          'div',
          {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: 8, padding: '5px 10px', borderTop: `1px solid ${C.line}`, fontSize: 9.5, color: C.mid,
            },
          },
          h('span', null, data ? `${data.artifactsCount} 个产物 · 最新 ${new Date(latest?.mtime || Date.now()).toLocaleTimeString().slice(0, 5)}` : '还没有产物'),
          h('span', null, 'v1 · 上一版（未接） · 100%'),
        ),
      )
    }

    // ---- 左栏入口 + 整页工作台（main 面板）----
    // 入口与媒体工作台同槽位：sidebar.panellist 的 id 必须等于 main 的 key。
    const PANEL_ID = 'design-workspace'

    // 03-6 设计系统：纸白底、墨色字、1px 线、无阴影、克莱因蓝强调。
    const T = {
      paper: '#FBFAF7',
      ink: '#1B1B1B',
      mid: '#6E6E6E',
      line: '#DEDEDE',
      green: '#1F7A4D',
      serif: 'Songti SC, Source Han Serif, serif',
      sans: '"Microsoft YaHei", "Segoe UI", sans-serif',
    }

    const S = {
      page: { height: '100%', display: 'flex', flexDirection: 'column', background: T.paper, color: T.ink, font: `12px/1.5 ${T.sans}` },
      nav: { height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', borderBottom: `1px solid ${T.line}` },
      body: { flex: '1 1 auto', minHeight: 0, overflow: 'auto', padding: '40 28 28' },
      pill: { fontSize: 11, padding: '3px 10px', border: `1px solid ${T.line}`, borderRadius: 999, color: T.ink, background: '#fff' },
      section: { marginTop: 32, maxWidth: 900 },
      sectionTitle: { fontSize: 10, letterSpacing: 1.5, color: T.mid },
      note: { marginTop: 10, fontSize: 11.5, color: T.mid, lineHeight: 1.8 },
      card: { width: 240, background: '#fff', border: `1px solid ${T.line}`, padding: 12 },
      cardThumb: { height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.paper, border: `1px solid ${T.line}` },
      cardTitle: { fontSize: 12, fontWeight: 600, marginTop: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      cardMeta: { fontSize: 10, color: T.mid, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      foot: { height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', borderTop: `1px solid ${T.line}`, fontSize: 9.5, color: T.mid },
    }

    function objectValues(value) {
      if (!value || typeof value !== 'object') return []
      return Array.isArray(value) ? value : Object.values(value)
    }

    function pickWorkspace(snapshot) {
      if (!snapshot) return null
      const lists = [snapshot.workspaces, snapshot.items, snapshot.list, snapshot.byId, snapshot.map]
      const views = lists
        .flatMap((list) => objectValues(list))
        .filter((item) => item && typeof item.path === 'string' && item.path.length > 1)
      if (!views.length) return null
      const activeId = snapshot.activeWorkspaceId || snapshot.activeId || snapshot.currentId
      return (activeId && views.find((view) => view.workspaceId === activeId)) || null
    }

    function PanelIcon({ size }) {
      const edge = Math.max(12, Number(size) || 16)
      return h('svg', { width: edge, height: edge, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' },
        h('rect', { x: 2, y: 2.5, width: 12, height: 11 }),
        h('line', { x1: 2, y1: 6.5, x2: 14, y2: 6.5 }),
        h('line', { x1: 6.5, y1: 6.5, x2: 6.5, y2: 13.5 }))
    }

    function NavBar() {
      return h('div', { style: S.nav },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { width: 6, height: 6, borderRadius: 999, background: T.green } }),
          h('span', { style: { fontSize: 15, fontFamily: T.serif, letterSpacing: 1 } }, '设计工作台')),
        h('span', { style: { fontSize: 10.5, color: T.mid } }, '一个会话一个交付物'))
    }

    function Hero() {
      return h('div', { style: { maxWidth: 900 } },
        h('div', { style: { fontSize: 32, fontFamily: T.serif, letterSpacing: 1.5, lineHeight: 1.3 } }, '做出能交付的东西'),
        h('div', { style: { fontSize: 12, color: T.mid, marginTop: 10 } }, '从想法到可交付，一次会话一个交付物。在左侧对话里说清楚要什么，结果会出现在这里。'),
        h('div', { style: { display: 'flex', gap: 8, marginTop: 16 } },
          ['网页', 'PPT', '长文档'].map((label) => h('span', { key: label, style: S.pill }, label))))
    }

    function CaseCards({ wsView, state }) {
      const data = state.data
      const latest = data?.latest
      const empty = h('div', { style: S.note }, wsView
        ? '这个工作区还没有交付物。在左侧对话里说清楚要做什么，结果会出现在这里。'
        : '在左侧选择一个工作区，然后在对话里开始。')
      return h('div', { style: S.section },
        h('div', { style: S.sectionTitle }, '本次会话'),
        state.loading ? h('div', { style: S.note }, '读取交付物…')
          : state.error && !state.empty ? h('div', { style: S.note }, `读不到交付物：${state.error}`)
            : data
              ? h('div', { style: { display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 } },
                  h('div', { style: S.card },
                    h('div', { style: S.cardThumb }, h('span', { style: { fontSize: 10, color: T.mid } }, String(data.work?.kind || '交付物').toUpperCase())),
                    h('div', { style: S.cardTitle }, data.work?.title || '未命名交付物'),
                    h('div', { style: S.cardMeta }, `${data.artifactsCount} 个产物${latest ? ` · 最新 ${latest.rel}` : ''}`)))
              : empty)
    }

    const HOW = [
      ['定主题', '一句话说清给谁、做什么。'],
      ['出内容', '技能按媒介写：网页、PPT 或长文档。'],
      ['定稿导出', 'HTML / PDF / PNG 落盘，回对话继续改。'],
    ]

    function HowRow() {
      return h('div', { style: S.section },
        h('div', { style: S.sectionTitle }, '怎么做'),
        h('div', { style: { display: 'flex', gap: 28, marginTop: 12 } },
          HOW.map(([title, desc]) => h('div', { key: title, style: { flex: '1 1 0', minWidth: 0 } },
            h('div', { style: { fontSize: 12, fontWeight: 600 } }, title),
            h('div', { style: { fontSize: 10.5, color: T.mid, marginTop: 6, lineHeight: 1.7 } }, desc)))))
    }

    function PageFoot() {
      return h('div', { style: S.foot }, h('span', null, '一个会话一个交付物 · 由本机技能生成'), h('span', null, 'v0.1'))
    }

    function Workbench(props) {
      const wsSnapshot = typeof props.useWorkspaces === 'function' ? props.useWorkspaces() : null
      const wsView = pickWorkspace(wsSnapshot)
      const root = wsView ? wsView.path : null
      const [state, setState] = React.useState({ loading: Boolean(root), data: null, error: null, empty: false })

      React.useEffect(() => {
        if (!root) {
          setState({ loading: false, data: null, error: null, empty: true })
          return undefined
        }
        let alive = true
        setState({ loading: true, data: null, error: null, empty: false })
        const workFile = `${root.replace(/[\\/]+$/, '')}\\.design-work\\work.json`
        fetch(`${API}?path=${encodeURIComponent(workFile)}`, { headers: { accept: 'application/json' } })
          .then(async (response) => {
            const body = await response.json().catch(() => null)
            if (!response.ok || !body?.ok) throw new Error(body?.error || `HTTP ${response.status}`)
            if (alive) setState({ loading: false, data: body, error: null, empty: false })
          })
          .catch((error) => {
            const message = String(error?.message || error)
            if (alive) setState({ loading: false, data: null, error: message, empty: /不存在|NOT_FOUND/.test(message) })
          })
        return () => {
          alive = false
        }
      }, [root])

      return h('div', { style: S.page }, h(NavBar), h('div', { style: S.body }, h(Hero), h(CaseCards, { wsView, state }), h(HowRow)), h(PageFoot))
    }

    function apply(ctx) {
      ctx.effect(() =>
        ctx.sidebarRightTabs.register({
          id: ID,
          kind: KIND,
          patterns: ['**/.design-work/work.json'],
          title: () => '设计工作台',
          guide: [
            {
              order: 40,
              title: () => '设计工作台',
              description: () => '一个会话一个交付物：在对话里生成，右栏出结果，选中回对话改。',
            },
          ],
        }),
      )

      ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, Body)))
      ctx.effect(() =>
        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: ID }, Title)),
      )

      // 左栏「设计工作台」入口（panellist 的 id 必须等于 main 的 key）
      ctx.effect(() =>
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 6, label: () => '设计工作台' }, PanelIcon),
        ),
      )
      // 点开后的整页工作台
      ctx.effect(() =>
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Workbench)),
      )
    }

    exports.name = 'design-workspace'
    exports.inject = ['slots', 'sidebarRightTabs']
    exports.apply = apply
    return module.exports
  },
})
