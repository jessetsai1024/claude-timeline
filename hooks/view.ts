/** 一行裡的一小段字，帶自己的顏色與粗細。 */
export type Segment = {
  /** 要顯示的字。 */
  text: string
  /** 顏色，`#rrggbb`；沒給就是終端機預設字色。 */
  color?: string
  /** 粗體。 */
  bold?: boolean
  /** 暗一階，給次要資訊用。 */
  dim?: boolean
  /** 放不下要裁的時候留結尾、開頭補「…」（檔案路徑用）；只影響排版，畫的時候不看。 */
  keepTail?: boolean
}

/** 畫面上的一行：由左到右排的幾段字；空陣列是空白行。 */
export type Line = Segment[]

/** 時間的類別。 */
export type Category = 'wait' | 'think' | 'write' | 'command' | 'network' | 'file' | 'helper' | 'user' | 'other'

/** 一段時間：屬於哪一類、從什麼時候到什麼時候（毫秒）；還沒結束的 end 是 null。 */
export type Span = {
  /** 類別。 */
  category: Category
  /** 開始的時間。 */
  start: number
  /** 結束的時間；還在進行是 null。 */
  end: number | null
}

/** 一步：一次送給模型的請求，或一次工具呼叫。 */
export type Step =
  | {
      /** 模型的一步。 */
      type: 'model'
      /** 送出請求的時間。 */
      start: number
      /** 回覆傳完的時間；還在傳是 null。 */
      end: number | null
      /** 等第一個字等了多久、想了多久、寫了多久（毫秒）。 */
      wait: number
      think: number
      write: number
    }
  | {
      /** 工具的一步。 */
      type: 'tool'
      /** 開始的時間。 */
      start: number
      /** 結束的時間；還在跑是 null。 */
      end: number | null
      /** 工具名稱，已經寫短（MCP 工具是「伺服器/工具」）。 */
      name: string
      /** 一小段說明它在做什麼；沒有是空字串。 */
      detail: string
      /** 算在哪一類。 */
      category: Category
    }

/** 一輪：開始、結束、所有時間段和步驟。 */
export type Turn = {
  /** 開始的時間。 */
  start: number
  /** 結束的時間；還在進行是 null。 */
  end: number | null
  /** 所有時間段，照開始時間的先後加進來。 */
  spans: Span[]
  /** 所有步驟，照開始時間的先後加進來。 */
  steps: Step[]
}

/** 每一類的中文名字、顏色。照這個順序列在「花在哪裡」。 */
export const CATEGORIES: readonly { category: Category; label: string; color: string }[] = [
  { category: 'wait', label: '等模型開始回', color: '#9aa7b8' },
  { category: 'think', label: '模型在想', color: '#b48cff' },
  { category: 'write', label: '模型在寫', color: '#e0c8ff' },
  { category: 'command', label: '跑指令', color: '#ff9f43' },
  { category: 'network', label: '網路', color: '#4fc3f7' },
  { category: 'file', label: '讀寫檔案', color: '#5ad67d' },
  { category: 'helper', label: '等幫手', color: '#ff7eb6' },
  { category: 'user', label: '等主人回答', color: '#f7d154' },
  { category: 'other', label: '其他工具', color: '#c9a27e' },
]

const DIM = '#6b7280'
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'Grep', 'Glob', 'NotebookEdit', 'LS'])
const NETWORK_TOOLS = new Set(['WebFetch', 'WebSearch'])
const HELPER_TOOLS = new Set(['Agent', 'Task'])
const NETWORK_COMMANDS = /^(curl|wget|gh|wrangler|scp|rsync|ssh|ping)\b|^git\s+(clone|push|pull|fetch)\b|^(npm|pnpm|yarn|bun)\s+(i|install|add)\b|^(pip3?|uv\s+pip)\s+install\b|^brew\s+(install|upgrade)\b/
const DETAIL_KEYS = ['command', 'file_path', 'notebook_path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt', 'path']

/**
 * 【行為】一段字在終端機佔幾格寬：中日韓文字、全形標點、表情符號算 2 格，其他算 1 格。
 *   跟 ctx-panel、files 的同名函式一樣。
 */
export function widthOf(text: string): number {
  let width = 0

  for (const glyph of text) {
    const code = glyph.codePointAt(0) ?? 0
    const isWide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x20000 && code <= 0x3fffd)
    width += isWide ? 2 : 1
  }

  return width
}

/**
 * 【行為】把一段字裁到最多 max 格寬。超過時留開頭、結尾補「…」；keepTail 為 true 時改成留結尾、開頭補「…」。
 *   本來就放得下就原樣回傳。max 小於 1 回空字串。
 */
export function fit(text: string, max: number, keepTail = false): string {
  if (widthOf(text) <= max) {
    return text
  }

  if (max < 1) {
    return ''
  }

  const glyphs = Array.from(text)
  let kept = ''

  if (keepTail) {
    for (let at = glyphs.length - 1; at >= 0; at -= 1) {
      const next = (glyphs[at] ?? '') + kept

      if (widthOf(next) > max - 1) {
        break
      }

      kept = next
    }

    return `…${kept}`
  }

  for (const glyph of glyphs) {
    if (widthOf(kept + glyph) > max - 1) {
      break
    }

    kept += glyph
  }

  return `${kept}…`
}

/** 【行為】把毫秒寫成時鐘的樣子：不到一小時是「分:秒」（1:05），一小時以上是「時:分:秒」（1:02:03）。負數當 0。 */
export function clockOf(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  const s = `${seconds % 60}`.padStart(2, '0')
  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) {
    return `${minutes}:${s}`
  }

  return `${Math.floor(minutes / 60)}:${`${minutes % 60}`.padStart(2, '0')}:${s}`
}

/** 【行為】把工具名稱寫短：mcp__xapi__search 變成 xapi/search，其他照原樣。 */
export function toolNameOf(tool: string): string {
  const match = /^mcp__(.+?)__(.+)$/.exec(tool)

  return match === null ? tool : `${match[1]}/${match[2]}`
}

/**
 * 【行為】從工具的參數挑一段最能說明它在做什麼的字：依序找 command、file_path、notebook_path、pattern、url、
 *   query、skill、description、prompt、path，第一個不是空字串的就用它。換行和連續空白壓成一個空白，
 *   開頭是家目錄的換成「~」（Windows 的「\\」先換成「/」再比對）。都沒有就回空字串。
 */
export function detailOf(args: Readonly<Record<string, unknown>>, home: string): string {
  for (const key of DETAIL_KEYS) {
    const value = args[key]

    if (typeof value === 'string' && value.trim() !== '') {
      const text = value.replace(/\s+/g, ' ').trim()

      return tildeOf(text, home)
    }
  }

  return ''
}

/** 【行為】開頭是家目錄的換成「~」；Windows 的「\\」先換成「/」再比對，不在家目錄底下的原樣回傳。home 要是「/」隔開的。 */
export function tildeOf(text: string, home: string): string {
  const posix = text.replace(/\\/g, '/')

  return home !== '' && (posix === home || posix.startsWith(`${home}/`)) ? `~${posix.slice(home.length)}` : text
}

/**
 * 【行為】一次工具呼叫算哪一類：Read、Write、Edit、Grep、Glob、NotebookEdit 是讀寫檔案；WebFetch、WebSearch、
 *   MCP 工具是網路；Agent 是等幫手；AskUserQuestion 是等主人回答；Bash 看指令，用「&&」「;」「|」切開的任何一段
 *   開頭是 curl、wget、gh、wrangler、git clone/push/pull/fetch、npm/pip install 這類上網的就算網路，否則算跑指令；
 *   其他都算其他工具。
 */
export function categoryOf(tool: string, args: Readonly<Record<string, unknown>>): Category {
  if (FILE_TOOLS.has(tool)) {
    return 'file'
  }

  if (NETWORK_TOOLS.has(tool) || tool.startsWith('mcp__')) {
    return 'network'
  }

  if (HELPER_TOOLS.has(tool)) {
    return 'helper'
  }

  if (tool === 'AskUserQuestion') {
    return 'user'
  }

  if (tool === 'Bash') {
    const command = typeof args.command === 'string' ? args.command : ''
    const parts = command.split(/&&|\|\||[;|\n]/).map(part => part.trim().replace(/^(\w+=\S*\s+)+/, ''))

    return parts.some(part => NETWORK_COMMANDS.test(part)) ? 'network' : 'command'
  }

  return 'other'
}

/** 【行為】一串時間段在 from 到 to 之間實際蓋到多少毫秒；重疊的只算一次，還沒結束的算到 to。 */
export function coveredOf(spans: readonly Span[], from: number, to: number): number {
  const pieces = spans
    .map(span => [Math.max(from, span.start), Math.min(to, span.end ?? to)] as const)
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let reach = from

  for (const [a, b] of pieces) {
    if (b > reach) {
      total += b - Math.max(a, reach)
      reach = b
    }
  }

  return total
}

/**
 * 【行為】把一輪從 from 到 to 切成 width 格，每一格回傳蓋得最多的那一類；那一格什麼都沒蓋到就是 null。
 *   同樣多時照 CATEGORIES 的順序取前面的。
 */
export function barOf(spans: readonly Span[], from: number, to: number, width: number): (Category | null)[] {
  const cells: (Category | null)[] = []
  const slice = (to - from) / Math.max(1, width)

  for (let at = 0; at < width; at += 1) {
    const a = from + at * slice
    const b = a + slice
    let best: Category | null = null
    let most = 0

    for (const { category } of CATEGORIES) {
      const covered = coveredOf(
        spans.filter(span => span.category === category),
        a,
        b,
      )

      if (covered > most) {
        most = covered
        best = category
      }
    }

    cells.push(best)
  }

  return cells
}

/** 【行為】一輪裡各類各花了多少毫秒（同一類重疊的只算一次），照 CATEGORIES 的順序，0 的不列。 */
export function totalsOf(turn: Turn, now: number): { category: Category; ms: number }[] {
  const to = turn.end ?? now

  return CATEGORIES.map(({ category }) => ({
    category,
    ms: coveredOf(
      turn.spans.filter(span => span.category === category),
      turn.start,
      to,
    ),
  })).filter(total => total.ms > 0)
}

/** 寬度不一定的字，左邊補空白補到 width 格寬。 */
function padStartWidth(text: string, width: number): string {
  return ' '.repeat(Math.max(0, width - widthOf(text))) + text
}

/** 寬度不一定的字，右邊補空白補到 width 格寬。 */
function padEndWidth(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - widthOf(text)))
}

/** 左邊幾段字由左到右排、超過就裁；有 right 就靠右放，中間補空白，整行剛好 columns 格寬。 */
function line(left: Segment[], right: Segment | undefined, columns: number): Line {
  const room = right === undefined ? columns : Math.max(0, columns - widthOf(right.text) - 1)
  const kept: Segment[] = []
  let used = 0

  for (const segment of left) {
    if (room - used <= 0) {
      break
    }

    const text = fit(segment.text, room - used, segment.keepTail === true)

    if (text !== '') {
      kept.push({ ...segment, text })
      used += widthOf(text)
    }
  }

  if (right === undefined) {
    return kept
  }

  return [...kept, { text: ' '.repeat(Math.max(1, columns - used - widthOf(right.text))) }, right]
}

function colorOf(category: Category): string {
  return CATEGORIES.find(item => item.category === category)?.color ?? DIM
}

function labelOf(category: Category): string {
  return CATEGORIES.find(item => item.category === category)?.label ?? category
}

function percentOf(part: number, whole: number): string {
  if (whole <= 0 || part <= 0) {
    return '0%'
  }

  const percent = (part / whole) * 100

  return percent < 0.5 ? '<1%' : `${Math.round(percent)}%`
}

function stepLine(step: Step, now: number, isLongest: boolean, columns: number): Line {
  const ms = (step.end ?? now) - step.start
  const isRunning = step.end === null
  const right: Segment = { text: `${clockOf(ms)}${isLongest ? ' 最久' : ''}`, ...(isLongest ? { bold: true } : {}) }
  const head: Segment = isRunning ? { text: '● ', color: '#5ad67d' } : { text: '  ' }

  if (step.type === 'model') {
    const parts = [
      step.wait >= 2000 ? `等 ${clockOf(step.wait)}` : '',
      step.think > 0 ? `想 ${clockOf(step.think)}` : '',
      step.write > 0 ? `寫 ${clockOf(step.write)}` : '',
    ].filter(Boolean)

    return line(
      [head, { text: padEndWidth('模型', 10), color: colorOf('think') }, { text: parts.join('・') || '等回應', dim: true }],
      right,
      columns,
    )
  }

  const isPath = step.detail.startsWith('/') || step.detail.startsWith('~') || /^[A-Za-z]:[\\/]/.test(step.detail)

  return line(
    [head, { text: padEndWidth(step.name, 10), color: colorOf(step.category) }, { text: step.detail, keepTail: isPath, dim: true }],
    right,
    columns,
  )
}

/**
 * 【何時能呼叫】columns 至少 30 才排得好看；更窄也不會壞，只是字會被裁掉。rows 是側邊欄可用的列數。
 * 【行為】把這一輪（turn）排成側邊欄的每一行，每一行都不超過 columns 格寬。
 *   turn 是 null 時只寫一行「還沒有開始任何一輪」。否則：
 *   標題一行（右邊是「進行中 時間」或「花了 時間」）、一條橫跨整個寬度的時間條（每一格塗成那段時間花最多的類別的顏色，
 *   什麼都沒有的塗成暗點）、底下標開始、中間、結尾的時間；「花在哪裡」列出有花到時間的類別、時間、百分比；
 *   「一步一步」照先後列最近幾步（筆數看 rows 剩多少，最少 3 步），正在跑的前面有 ●，這一輪最久的那一步標「最久」；
 *   模型的步寫「等」（2 秒以上才寫）、「想」、「寫」各多久。
 *   previous 不是 null 時最後多一行「上一輪：時間（最多的類別 佔幾%）」。now 是現在的時間，毫秒。
 */
export function linesOf(turn: Turn | null, previous: Turn | null, now: number, columns: number, rows: number): Line[] {
  if (turn === null) {
    return [line([{ text: '這一輪的時間', bold: true }], undefined, columns), [], [{ text: fit('還沒有開始任何一輪', columns), dim: true }]]
  }

  const to = turn.end ?? now
  const total = to - turn.start
  const lines: Line[] = [
    line(
      [{ text: '這一輪的時間', bold: true }],
      { text: `${turn.end === null ? '進行中' : '花了'} ${clockOf(total)}`, ...(turn.end === null ? {} : { dim: true }) },
      columns,
    ),
    [],
  ]

  lines.push(
    barOf(turn.spans, turn.start, to, columns).map(category =>
      category === null ? { text: '·', color: DIM } : { text: '█', color: colorOf(category) },
    ),
  )

  const mid = clockOf(total / 2)
  const end = clockOf(total)
  const gap = Math.max(1, Math.floor((columns - 1 - widthOf(mid) - widthOf(end)) / 2))

  lines.push(line([{ text: `0${' '.repeat(gap)}${mid}`, dim: true }], { text: end, dim: true }, columns))
  lines.push([], [{ text: fit('花在哪裡', columns), bold: true }])

  const totals = totalsOf(turn, now)

  if (totals.length === 0) {
    lines.push([{ text: fit('  還沒有資料', columns), dim: true }])
  }

  for (const { category, ms } of totals) {
    lines.push(
      line(
        [{ text: '■ ', color: colorOf(category) }, { text: labelOf(category) }],
        { text: `${padStartWidth(clockOf(ms), 7)} ${padStartWidth(percentOf(ms, total), 4)}` },
        columns,
      ),
    )
  }

  const footer: Line[] = []

  if (previous !== null && previous.end !== null) {
    const top = totalsOf(previous, previous.end).sort((a, b) => b.ms - a.ms)[0]
    const share = top === undefined ? '' : `（${labelOf(top.category)}佔 ${percentOf(top.ms, previous.end - previous.start)}）`

    footer.push([], line([{ text: `上一輪：${clockOf(previous.end - previous.start)}${share}`, dim: true }], undefined, columns))
  }

  const room = Math.max(3, rows - lines.length - 2 - footer.length)
  const shown = turn.steps.slice(-room)
  const longest = turn.steps.reduce<Step | null>(
    (best, step) => (best === null || (step.end ?? now) - step.start > (best.end ?? now) - best.start ? step : best),
    null,
  )

  lines.push([], [{ text: fit(`一步一步（最近 ${shown.length} 步，共 ${turn.steps.length} 步）`, columns), bold: true }])

  for (const step of shown) {
    lines.push(stepLine(step, now, step === longest && turn.steps.length > 1, columns))
  }

  return [...lines, ...footer]
}

// #region AI-NOTES
// AI-NOTES：agent 專用備忘。當時為真、非契約、非指令；改到相關程式碼時重驗，錯了就刪。
// 2026-10-03 為了原生 Windows：detailOf 經 tildeOf 比對家目錄時先把「\\」換成「/」，isPath 也認磁碟機代號。沒有 Windows 機器實測。
// 2026-10-03 widthOf、fit、clockOf、toolNameOf、detailOf 從 ~/Workspace/projects/ctx-panel 與 files 複製；mod 之間不能互相 import。
// 2026-10-03 「網路」的 Bash 判斷是猜的：只看每一段指令開頭的字，python 腳本裡面打 API（gpt_image.py、jev_ask.py）
//   會被算成跑指令。主人說過要分「卡在網路還是卡在指令」，之後想更準可以把這幾支腳本名字加進 NETWORK_COMMANDS。
// 2026-10-03 百分比的分母是整輪時間；不同類別同時進行（平行的工具）時各自算，所以加起來可能超過 100%。
// #endregion
