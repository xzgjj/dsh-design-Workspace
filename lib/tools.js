// 模型可见的工具。只做"开一个交付物"，产物内容由模型用技能与文件工具写。
// 不做 generate/refine，不接管渲染——画布只读结果。
import { createWork, readState } from './store.js'

const text = (value) => [{ type: 'text', text: value }]

const START_PARAMS = {
  type: 'object',
  additionalProperties: false,
  required: ['root', 'title'],
  properties: {
    root: { type: 'string', description: '当前会话工作区的绝对路径（会话 cwd）' },
    title: { type: 'string', description: '这次要交付的东西，一句话，例如“深色 SaaS 落地页”' },
  },
}

export const workStartTool = {
  name: 'design_work_start',
  description:
    '在当前工作区开一个设计交付物（目录 .design-work/ + work.json），返回 absolute path。之后把产物写进这个目录（网页写 index.html，PPT/Word 写源文件），每次交付用 present 声明。一个会话只开一次。',
  parameters: START_PARAMS,
  timeoutMs: 30_000,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['workId', 'root', 'workFile', 'created'],
      properties: {
        workId: { type: 'string' },
        root: { type: 'string' },
        workFile: { type: 'string' },
        created: { type: 'boolean' },
      },
    },
    render: (_args, v) => text(`交付物就绪：${v.workFile}\n把产物写进 ${v.root}，画布会跟着刷新。`),
  },
  async execute(args) {
    for (const key of START_PARAMS.required) {
      if (typeof args?.[key] !== 'string' || !args[key].trim()) throw new Error(`缺少 ${key}`)
    }
    const { work, file, created } = createWork({ root: args.root, title: args.title })
    return { workId: work.id, root: args.root, workFile: file, created }
  },
}

export const workStateTool = {
  name: 'design_work_state',
  description: '读交付物状态：标题、产物数量、最新产物。改稿前先读，避免重复开新目录。',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['workFile'],
    properties: {
      workFile: { type: 'string', description: '.design-work/work.json 的绝对路径' },
    },
  },
  timeoutMs: 10_000,
  output: {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'artifactsCount', 'latest'],
      properties: {
        title: { type: 'string' },
        artifactsCount: { type: 'number' },
        latest: {
          type: ['object', 'null'],
          properties: { rel: { type: 'string' }, kind: { type: 'string' } },
        },
      },
    },
    render: (_args, v) =>
      text(`${v.title}：${v.artifactsCount} 个产物${v.latest ? `，最新 ${v.latest.rel}（${v.latest.kind}）` : ''}`),
  },
  async execute(args) {
    if (typeof args?.workFile !== 'string' || !args.workFile) throw new Error('缺少 workFile')
    const s = readState(args.workFile)
    return { title: s.work.title, artifactsCount: s.artifactsCount, latest: s.latest }
  },
}

export const TOOLS = [workStartTool, workStateTool]
