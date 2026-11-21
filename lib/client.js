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
    }

    exports.name = 'design-workspace'
    exports.inject = ['slots', 'sidebarRightTabs']
    exports.apply = apply
    return module.exports
  },
})
