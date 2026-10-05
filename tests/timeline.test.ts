import { expect, mock, test } from 'claude-code/testing'

import { barOf, categoryOf, coveredOf, detailOf, linesOf, totalsOf, widthOf } from '../hooks/view'
import type { Line, Turn } from '../hooks/view'

function textOf(line: Line): string {
  return line.map(segment => segment.text).join('')
}

/** 跟草圖一樣的一輪：等 5 秒、想 9 秒、寫 3 秒、npm test 72 秒、想 21 秒、WebFetch 16 秒。 */
function sampleTurn(): Turn {
  return {
    start: 0,
    end: null,
    spans: [
      { category: 'wait', start: 0, end: 5_000 },
      { category: 'think', start: 5_000, end: 14_000 },
      { category: 'write', start: 14_000, end: 17_000 },
      { category: 'command', start: 17_000, end: 89_000 },
      { category: 'think', start: 89_000, end: 110_000 },
      { category: 'network', start: 110_000, end: 126_000 },
      { category: 'file', start: 126_000, end: null },
    ],
    steps: [
      { type: 'model', start: 0, end: 17_000, wait: 5_000, think: 9_000, write: 3_000 },
      { type: 'tool', start: 17_000, end: 89_000, name: 'Bash', detail: 'npm test', category: 'command' },
      { type: 'model', start: 89_000, end: 110_000, wait: 0, think: 21_000, write: 0 },
      { type: 'tool', start: 110_000, end: 126_000, name: 'WebFetch', detail: 'https://docs.claude.com/very/long/page', category: 'network' },
      { type: 'tool', start: 126_000, end: null, name: 'Read', detail: '~/work/hooks/view.ts', category: 'file' },
    ],
  }
}

test('工具分類：檔案、網路、幫手、等主人、指令裡上網的算網路', async () => {
  expect(categoryOf('Read', {})).toBe('file')
  expect(categoryOf('WebFetch', {})).toBe('network')
  expect(categoryOf('mcp__xapi__search', {})).toBe('network')
  expect(categoryOf('Agent', {})).toBe('helper')
  expect(categoryOf('AskUserQuestion', {})).toBe('user')
  expect(categoryOf('Skill', {})).toBe('other')
  expect(categoryOf('Bash', { command: 'npm test' })).toBe('command')
  expect(categoryOf('Bash', { command: 'cd /tmp && curl -sL https://x.com -o a.html' })).toBe('network')
  expect(categoryOf('Bash', { command: 'FOO=1 git push origin main' })).toBe('network')
  expect(categoryOf('Bash', { command: 'git status; npm install left-pad' })).toBe('network')
  expect(categoryOf('Bash', { command: 'git commit -m "curl later"' })).toBe('command')
})

test('重疊的時間只算一次，時間條每格取最多的那一類', async () => {
  expect(
    coveredOf(
      [
        { category: 'command', start: 0, end: 10 },
        { category: 'command', start: 5, end: 20 },
        { category: 'command', start: 30, end: null },
      ],
      0,
      40,
    ),
  ).toBe(30)
  expect(barOf([{ category: 'think', start: 0, end: 50 }], 0, 100, 4)).toEqual(['think', 'think', null, null])

  const totals = totalsOf(sampleTurn(), 130_000)

  expect(totals.map(total => total.category)).toEqual(['wait', 'think', 'write', 'command', 'network', 'file'])
  expect(totals.find(total => total.category === 'think')?.ms).toBe(30_000)
  expect(totals.find(total => total.category === 'file')?.ms).toBe(4_000)
})

test('每一行都不超過寬度，草圖上的字都在', async () => {
  const previous: Turn = {
    start: 0,
    end: 252_000,
    spans: [{ category: 'command', start: 10_000, end: 164_000 }],
    steps: [],
  }

  for (const columns of [30, 47, 73]) {
    for (const line of linesOf(sampleTurn(), previous, 130_000, columns, 40)) {
      expect(widthOf(textOf(line))).toBeLessThanOrEqual(columns)
    }
  }

  const lines = linesOf(sampleTurn(), previous, 130_000, 47, 40)
  const all = lines.map(textOf).join('\n')

  expect(all).toContain('進行中 2:10')
  expect(widthOf(textOf(lines[2] ?? []))).toBe(47)
  expect(all).toMatch(/模型在想 +0:30 +23%/)
  expect(all).toMatch(/跑指令 +1:12 +55%/)
  expect(all).toContain('一步一步（最近 5 步，共 5 步）')
  expect(all).toContain('等 0:05・想 0:09・寫 0:03')
  expect(all).toMatch(/Bash +npm test +1:12 最久/)
  expect(all).toContain('● Read')
  expect(all).toContain('上一輪：4:12（跑指令佔 61%）')

  const few = linesOf(sampleTurn(), null, 130_000, 47, 10).map(textOf).join('\n')

  expect(few).toContain('最近 3 步，共 5 步')
  expect(linesOf(null, null, 0, 47, 40).map(textOf).join('\n')).toContain('還沒有開始任何一輪')
})

test('模型的回覆經過 mod 一段都不變、結果也不變；工具和一輪的開始結束畫得出來', async ($, on) => {
  const chunks = [
    { kind: 'thinking', index: 0, text: '想一下' },
    { kind: 'text', index: 1, text: '你好' },
    { kind: 'tool', index: 2, id: 'toolu_1', name: 'Bash' },
    { kind: 'input', index: 2, json: '{"command":"npm test"}' },
    { kind: 'stop', stopReason: 'tool_use', usage: null },
  ]

  mock.clock(on)
  on('env.get', () => ({ value: '/Users/someone' }))
  on('ui.invalidate', (_, e, next) => next(e))
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', () => ({ text: '' }))
  on('turn.step', async function* (_, e) {
    for (const chunk of chunks) {
      yield chunk as never
    }

    return {
      turnId: e.turnId,
      index: e.index,
      answer: '你好',
      toolUses: [{ id: 'toolu_1', name: 'Bash', input: { command: 'npm test' } }],
      stopReason: 'tool_use',
      usage: null,
    } as never
  })
  on('tool.call', () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } as never }))

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({
    plugin: 'timeline',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'timeline',
    props: {
      title: '時間軸',
      isFocused: false,
      bodyColumns: 47,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 38 },
      view: {},
    },
  })

  expect(await ui.find({ type: 'Text', text: /還沒有開始任何一輪/ })).toBeDefined()

  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 })
  const got: unknown[] = []
  let read = await stream.next()

  while (read.done !== true) {
    got.push(read.value)
    read = await stream.next()
  }

  expect(got).toEqual(chunks)
  // 主對話第一次送請求就開始這一輪
  expect(await ui.find({ type: 'Text', text: /進行中/ })).toBeDefined()
  expect(read.value).toMatchObject({ turnId: 't1', index: 0, answer: '你好', stopReason: 'tool_use' } as never)

  // 幫手的請求也原樣通過，但不記進時間軸
  const helper = $.turn.step({ turnId: 't1', index: 0, model: 'x', messageCount: 1, agentId: 'h1' })
  const helperGot: unknown[] = []
  let helperRead = await helper.next()

  while (helperRead.done !== true) {
    helperGot.push(helperRead.value)
    helperRead = await helper.next()
  }

  expect(helperGot).toEqual(chunks)
  expect(helperRead.value).toMatchObject({ answer: '你好' } as never)

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'WebFetch', url: 'https://docs.claude.com', prompt: 'x' } as never)

  expect(await ui.find({ type: 'Text', text: /一步一步（最近 3 步，共 3 步）/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Bash +npm test/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /WebFetch +https:\/\/docs\.claude\.com/ })).toBeDefined()

  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await ui.find({ type: 'Text', text: /花了 0:00/ })).toBeDefined()

  // 下一輪：第一次用工具就換新的時間軸，上一輪變成最下面那一行
  await $.tool.call({ tool: 'Read', file_path: '/tmp/a.txt' } as never)
  expect(await ui.find({ type: 'Text', text: /上一輪：0:00/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /共 1 步/ })).toBeDefined()

  await ui.unmount()
})

test('detailOf 把家目錄換成「~」，Windows 路徑也行，不在家目錄底下的不動', () => {
  expect(detailOf({ file_path: '/Users/someone/work/view.ts' }, '/Users/someone')).toBe('~/work/view.ts')
  expect(detailOf({ file_path: 'C:\\Users\\jesse\\work\\view.ts' }, 'C:/Users/jesse')).toBe('~/work/view.ts')
  expect(detailOf({ file_path: '/Users/someone2/view.ts' }, '/Users/someone')).toBe('/Users/someone2/view.ts')
  expect(detailOf({ command: 'npm   test' }, '/Users/someone')).toBe('npm test')
})
