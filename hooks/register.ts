import type { EngineInterface, Register } from 'claude-code'

import { categoryOf, detailOf, linesOf, toolNameOf } from './view'
import type { Category, Line, Span, Step, Turn } from './view'

const PANE = 'timeline'
const REFRESH_MS = 1000
// 側邊欄縮在輸入框上面時拿不到真正的高度，用這個當作可用列數
const INLINE_ROWS = 34

/** mod 在記憶體裡記的全部東西；register 每次載入建一份新的。 */
type State = {
  home: string
  current: Turn | null
  previous: Turn | null
}

/** 側邊欄現在有沒有開著、看得到。 */
async function isShown($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE && pane.isShown)
}

/** 開始新的一輪：現在這一輪變成上一輪。 */
function begin(state: State, at: number): Turn {
  if (state.current !== null) {
    state.previous = state.current
    state.previous.end ??= at
  }

  state.current = { start: at, end: null, spans: [], steps: [] }

  return state.current
}

/** 模型回覆的一小段屬於哪一類；不是內容的（引擎自己的段落、結尾）回 null。 */
function phaseOf(kind: string): Category | null {
  if (kind === 'thinking') {
    return 'think'
  }

  if (kind === 'text' || kind === 'tool' || kind === 'input') {
    return 'write'
  }

  return null
}

/**
 * 【職責】把時間軸面板接上 Claude Code：提供 /timeline，在側邊欄畫出主對話這一輪的時間花在哪：
 *   等模型開始回、模型在想、模型在寫、跑指令、網路、讀寫檔案、等幫手、等主人回答、其他工具。
 *   看模型回覆每一小段的種類與到達時間（內容不看、不留）、工具呼叫的名稱與參數；
 *   不改任何東西、不連網路、不寫檔。
 * 【何時能呼叫】引擎載入這個 mod 時呼叫一次；重新載入會再呼叫，紀錄從空的開始。
 * 【行為】有人在用的 session（不是 claude -p）一開始就自己打開側邊欄；終端機不夠寬時先等著，
 *   寬度夠了才出現（主人自己開過的 110 格，沒開過的 144 格，這是系統的規定）。
 *   /timeline：側邊欄沒開就開、開著就關。/timeline close：關掉。/timeline 數字：用那個寬度（格數）開。
 *   主對話在上一輪結束後第一次送請求給模型或用工具時，換新的時間軸（從那一刻算起），上一輪留著做最下面那一行的摘要；
 *   一輪結束後畫面停在那裡，下一輪開始才換。
 *   主對話每次送請求給模型：送出到第一段內容到達算「等模型開始回」，之後思考的段落算「想」，回覆文字和工具參數算「寫」。
 *   主對話每次用工具：開始到結束算一段，類別照工具決定。幫手內部的請求和工具不記，主對話等幫手的時間算「等幫手」。
 *   模型回覆的每一段都原封不動往下傳；記錄出錯時不影響傳輸，只是那一段時間不準。
 *   側邊欄開著而且這一輪還在進行時，每 1 秒重畫一次。/clear 之後清空。
 */
export const register: Register = on => {
  const state: State = { home: '', current: null, previous: null }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'timeline',
      description: '側邊欄的時間軸：這一輪的時間花在哪；/timeline 開或關',
      immediate: true,
    })
    // Windows 沒有 HOME，家目錄在 USERPROFILE；統一成「/」隔開，detailOf 比對時才對得上
    state.home = ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '').replace(/\\/g, '/')

    // 一開 session 就自己打開；不是主人叫的，終端機要夠寬才放得出來，不夠寬就先等著，不用等它
    if (e.isInteractive) {
      void $.ui.open({ id: PANE, title: '時間軸' })
    }

    $.clock.every(REFRESH_MS, () => {
      if (state.current !== null && state.current.end === null) {
        void isShown($).then(shown => {
          if (shown) {
            $.ui.invalidate('ui.render')
          }
        })
      }
    })

    return next(e)
  })

  on('classic.SessionStart', { source: ['clear'] }, ($, e, next) => {
    state.current = null
    state.previous = null
    $.ui.invalidate('ui.render')

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined) {
      return yield* next(e)
    }

    let step: Extract<Step, { type: 'model' }> | null = null
    let open: Span | null = null

    try {
      const sent = Date.now()
      const turn = state.current === null || state.current.end !== null ? begin(state, sent) : state.current
      step = { type: 'model', start: sent, end: null, wait: 0, think: 0, write: 0 }
      open = { category: 'wait', start: sent, end: null }
      turn.steps.push(step)
      turn.spans.push(open)
      $.ui.invalidate('ui.render')
    } catch {
      step = null
    }

    const stream = next(e)

    for await (const chunk of stream) {
      try {
        const phase = phaseOf(chunk.kind)

        if (step !== null && open !== null && phase !== null && phase !== open.category) {
          const at = Date.now()
          open.end = at
          const spent = at - open.start
          const turn = state.current

          if (open.category === 'wait') {
            step.wait += spent
          } else if (open.category === 'think') {
            step.think += spent
          } else {
            step.write += spent
          }

          open = { category: phase, start: at, end: null }
          turn?.spans.push(open)
          $.ui.invalidate('ui.render')
        }
      } catch {
        // 記錄出錯不影響傳輸
      }

      yield chunk
    }

    try {
      if (step !== null && open !== null) {
        const at = Date.now()
        open.end = at
        const spent = at - open.start

        if (open.category === 'wait') {
          step.wait += spent
        } else if (open.category === 'think') {
          step.think += spent
        } else {
          step.write += spent
        }

        step.end = at
        $.ui.invalidate('ui.render')
      }
    } catch {
      // 記錄出錯不影響傳輸
    }

    // 明確交回底下那個請求的結果（不回傳也會沿用，這樣寫比較看得懂）
    return await stream.result
  })

  on('tool.call', async ($, e, next) => {
    let step: Extract<Step, { type: 'tool' }> | null = null
    let span: Span | null = null

    if (e.agentId === undefined) {
      try {
        const at = Date.now()
        const turn = state.current === null || state.current.end !== null ? begin(state, at) : state.current
        const category = categoryOf(e.tool, e)
        step = { type: 'tool', start: at, end: null, name: toolNameOf(e.tool), detail: detailOf(e, state.home), category }
        span = { category, start: at, end: null }
        turn.steps.push(step)
        turn.spans.push(span)
        $.ui.invalidate('ui.render')
      } catch {
        step = null
      }
    }

    try {
      return await next(e)
    } finally {
      if (step !== null && span !== null) {
        const at = Date.now()
        step.end = at
        span.end = at
        $.ui.invalidate('ui.render')
      }
    }
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined && state.current !== null && state.current.end === null) {
      const at = Date.now()
      state.current.end = at

      // 被打斷時還開著的段落一起收掉
      for (const span of state.current.spans) {
        span.end ??= at
      }

      for (const step of state.current.steps) {
        step.end ??= at
      }

      $.ui.invalidate('ui.render')
    }

    return next(e)
  })

  on('command.run', { command: 'timeline' }, async ($, e) => {
    const arg = e.args.trim()
    const wanted = Number.parseInt(arg, 10)
    const isUp = (await $.ui.panes()).some(pane => pane.id === PANE)

    if (arg === 'close' || (arg === '' && isUp)) {
      await $.ui.close({ id: PANE })

      return {}
    }

    const opened = await $.ui.open(
      Number.isInteger(wanted) && wanted > 0
        ? { id: PANE, title: '時間軸', columns: wanted }
        : { id: PANE, title: '時間軸' },
    )

    if (!opened.isPlaced) {
      return { text: `側邊欄沒有被放出來：${opened.reason}` }
    }

    // 重新打開時引擎可能直接拿上次畫好的結果來用，所以自己要求重畫
    $.ui.invalidate('ui.render')

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const rows = e.props.placement === 'dock' ? e.props.scroll.bodyRows : INLINE_ROWS
    const lineOf = (segments: Line) =>
      Text({
        wrap: 'truncate-end',
        children:
          segments.length === 0
            ? [' ']
            : segments
                .filter(segment => segment.text !== '')
                .map(segment =>
                  Text({
                    ...(segment.color === undefined ? {} : { color: segment.color }),
                    ...(segment.bold === true ? { bold: true } : {}),
                    ...(segment.dim === true ? { dimColor: true } : {}),
                    children: [segment.text],
                  }),
                ),
      })

    return Box({
      flexDirection: 'column',
      children: linesOf(state.current, state.previous, Date.now(), e.props.bodyColumns, rows).map(lineOf),
    })
  })
}

// #region AI-NOTES
// AI-NOTES：agent 專用備忘。當時為真、非契約、非指令；改到相關程式碼時重驗，錯了就刪。
// 2026-10-03 turn.step 是串流事件：hook 一定要是 async function*，每段 chunk 原樣 yield，最後 return await stream.result。
//   不回傳也會沿用底下的結果（2026-10-03 測過兩種都行）。測試要用 stream.next() 讀到 done 拿回傳值；
//   對 $.turn.step 的串流 for await 讀完再 await stream.result，在測試裡拿到的是 undefined。
//   記錄全包在 try 裡；型別檔也說 hook 中途出錯會被拿掉、改由底下接手。
// 2026-10-03 時間用 Date.now() 不用 $.clock.now()：串流每段都要記時間，$.clock.now() 每次要問引擎一趟，會拖慢傳輸。
//   代價是測試的 mock.clock 管不到這裡的時間，測試只驗類別與畫面，不驗準確秒數。
// 2026-10-03 「等模型開始回」是送出請求到第一段內容（思考、文字、工具）到達；引擎自己的段落（kind engine）不算內容。
//   思考內容被隱藏、不串流的模型，想的時間會被算進「等模型開始回」。未在真機驗過。
// 2026-10-03 刻意不用 turn.start 判斷一輪開始：型別檔沒說幫手的輪次會不會觸發它，若會，背景幫手會開出一個
//   永遠不結束的空白一輪（幫手的 turn.complete 帶 agentId、這裡不收）。改由主對話第一個 turn.step 或 tool.call 開始，
//   少算的只有送出第一個請求前那一點時間。
// 2026-10-03 工具的時間是 next(e) 前後：權限詢問也在 next 裡，所以主人按允許前的等待會算進那個工具。
// #endregion
