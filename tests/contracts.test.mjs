import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  ERR,
  REASON,
  OpError,
  opError,
  optionalBoolean,
  optionalNumber,
  requireInside,
  requireRelative,
  requireString,
} from '../lib/contracts.js'

test('错误码恰好 6 个，reason 恰好 9 个，不外扩', () => {
  assert.deepEqual(Object.values(ERR).sort(), ['BAD_ARGS', 'CONFLICT', 'FORBIDDEN', 'INTERNAL', 'LIMIT', 'NOT_FOUND'])
  assert.equal(Object.values(REASON).length, 9)
  for (const reason of Object.values(REASON)) assert.equal(REASON[reason], reason)
  assert.equal(Object.isFrozen(REASON), true)
})

test('OpError 带 6 码与可选 reason，message 保留中文', () => {
  const plain = new OpError(ERR.NOT_FOUND, '没有这块画布')
  assert.equal(plain.code, ERR.NOT_FOUND)
  assert.equal(plain.reason, undefined)
  const detailed = opError(ERR.CONFLICT, REASON.CANVAS_MIN, '至少保留一块画布')
  assert.equal(detailed.name, 'OpError')
  assert.equal(detailed.code, ERR.CONFLICT)
  assert.equal(detailed.reason, 'CANVAS_MIN')
  assert.match(detailed.message, /至少保留/)
})

test('requireInside 只放行围栏内路径，越界 FENCE', () => {
  const root = join('D:', 'ws')
  const design = join(root, '.design-work')
  assert.equal(requireInside(design, join(design, 'project.json')), join(design, 'project.json'))
  assert.throws(() => requireInside(design, join(root, 'secret.txt')), (err) => err.code === ERR.FORBIDDEN && err.reason === REASON.FENCE)
  assert.throws(() => requireInside(design, join(root, '..', 'outside'), 'root'), (err) => err.code === ERR.FORBIDDEN)
})

test('requireRelative 拒绝绝对路径、空值与 .. 段', () => {
  assert.equal(requireRelative('artifacts\\index.html'), 'artifacts/index.html')
  assert.equal(requireRelative('./deck.pdf'), 'deck.pdf')
  assert.throws(() => requireRelative('/etc/passwd'), /相对路径/)
  assert.throws(() => requireRelative('C:\\Windows\\x'), /相对路径/)
  assert.throws(() => requireRelative('../x'), /不能为空|\.\./)
  assert.throws(() => requireRelative(''), /缺少/)
})

test('字符串/数字/布尔校验保持可判定', () => {
  assert.equal(requireString('title', ' 品牌官网 ', 80), '品牌官网')
  assert.throws(() => requireString('title', '   '), (err) => err.code === ERR.BAD_ARGS)
  assert.equal(optionalNumber('3', { min: 1, max: 200, fallback: 1 }), 3)
  assert.equal(optionalNumber(undefined, { fallback: 1 }), 1)
  assert.throws(() => optionalNumber(300, { min: 1, max: 200 }), (err) => err.code === ERR.LIMIT)
  assert.equal(optionalBoolean('true'), true)
  assert.equal(optionalBoolean('off'), false)
  assert.throws(() => optionalBoolean('maybe'), (err) => err.code === ERR.BAD_ARGS)
})
