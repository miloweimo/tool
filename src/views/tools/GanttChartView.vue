<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  eachDateStrInRange,
  formatISODateLocal,
  isValidISODate,
  parseISODateLocal
} from '@/utils/ganttDates'
import {
  buildCsv,
  buildXlsxBuffer,
  downloadBlob,
  parseCsvGantt,
  parseXlsxGantt
} from '@/utils/ganttIo'

const CELL = 34
const STORAGE_KEY = 'tool-gantt-v1'
const LEGACY_STORAGE_KEY = 'tools-gantt-v1'
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const
/** 初次进入时视口：今天向左、向右各延伸天数（可继续滚动扩展） */
const VIEWPORT_BACK_DAYS = 45
const VIEWPORT_FORWARD_DAYS = 200
/** 滚到左右边缘时一次追加的天数 */
const EXTEND_CHUNK_DAYS = 45
/** 任务条、导入后视口比任务多留的空档 */
const TASK_PAD_DAYS = 14
const SCROLL_EDGE_PX = CELL * 10
/** 拖拽时指针贴近滚动区左右缘则自动滚时间轴（px） */
const DRAG_AUTOSCROLL_MARGIN_PX = 48
const DRAG_AUTOSCROLL_STEP_PX = 16

interface Task {
  id: string
  title: string
  start: string
  end: string
  color: string
}

interface DragState {
  taskId: string
  mode: 'move' | 'resize-left' | 'resize-right'
  /** 保留：与其它逻辑兼容；平移模式主要用 grabOffsetCells + 指针映射 */
  startClientX: number
  origStartIdx: number
  origEndIdx: number
  pointerId: number
  /** 平移：按下时指针所在列索引 − 任务条起点列索引 */
  grabOffsetCells?: number
}

function randomTaskColor(): string {
  const h = Math.floor(Math.random() * 360)
  return `hsl(${h} 52% 62% / 0.88)`
}

function addDaysStr(s: string, n: number): string {
  const d = parseISODateLocal(s)
  d.setDate(d.getDate() + n)
  return formatISODateLocal(d)
}

function todayIso(): string {
  return formatISODateLocal(new Date())
}

function initViewportAroundToday() {
  const t = todayIso()
  viewportStart.value = addDaysStr(t, -VIEWPORT_BACK_DAYS)
  viewportEnd.value = addDaysStr(t, VIEWPORT_FORWARD_DAYS)
}

const viewportStart = ref('')
const viewportEnd = ref('')
initViewportAroundToday()
const showWeekday = ref(true)
const tasks = ref<Task[]>([])
const fileImport = ref<HTMLInputElement | null>(null)
const ioMessage = ref('')
/** 导航「本条结束 / 下一条开始」所参照的任务；为 null 时视为第一条 */
const navContextTaskId = ref<string | null>(null)
/** 横向时间轴滚动容器（用于默认滚到「今天」或首个任务起点） */
const scrollXRef = ref<HTMLElement | null>(null)
/** 防止滚动触边时连续重复扩展视口 */
const scrollExtendBusy = ref(false)

/** 任务行上下排序（仅手柄可拖） */
const rowReorderFromIndex = ref<number | null>(null)
const rowReorderOverIndex = ref<number | null>(null)

function onRowDragStart(e: DragEvent, index: number) {
  rowReorderFromIndex.value = index
  e.dataTransfer?.setData('text/plain', String(index))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onRowDragOver(index: number) {
  if (rowReorderFromIndex.value === null) return
  rowReorderOverIndex.value = index
}

function onRowDrop(toIndex: number) {
  const from = rowReorderFromIndex.value
  if (from === null) {
    rowReorderOverIndex.value = null
    return
  }
  if (from === toIndex) {
    rowReorderFromIndex.value = null
    rowReorderOverIndex.value = null
    return
  }
  const list = tasks.value.slice()
  const [item] = list.splice(from, 1)
  list.splice(toIndex, 0, item!)
  tasks.value = list
  saveState()
  rowReorderFromIndex.value = null
  rowReorderOverIndex.value = null
}

function onRowDragEnd() {
  rowReorderFromIndex.value = null
  rowReorderOverIndex.value = null
}

function setNavContextTask(id: string) {
  navContextTaskId.value = id
}

function resolveNavContextTask(): Task | null {
  if (tasks.value.length === 0) return null
  const id = navContextTaskId.value
  if (id) {
    const t = tasks.value.find((x) => x.id === id)
    if (t) return t
  }
  return tasks.value[0] ?? null
}

function navContextTaskIndex(): number {
  const t = resolveNavContextTask()
  if (!t) return -1
  return tasks.value.findIndex((x) => x.id === t.id)
}

function isNavContextRow(taskId: string): boolean {
  if (tasks.value.length === 0) return false
  const id = navContextTaskId.value ?? tasks.value[0]!.id
  return taskId === id
}

const days = computed(() => {
  const list = eachDateStrInRange(viewportStart.value, viewportEnd.value)
  return list.map((dateStr) => {
    const d = parseISODateLocal(dateStr)
    return {
      dateStr,
      /** 统一为 月/日，如 3/24、12/1（不补零） */
      monthDay: `${d.getMonth() + 1}/${d.getDate()}`,
      weekZh: WEEK_ZH[d.getDay()]!
    }
  })
})

const timelineWidthPx = computed(() => Math.max(days.value.length * CELL, CELL))

const dateStrList = computed(() => days.value.map((x) => x.dateStr))

function dayIndex(dateStr: string): number {
  return dateStrList.value.indexOf(dateStr)
}

function barLeftPx(task: Task): number {
  const i = dayIndex(task.start)
  return i >= 0 ? i * CELL : 0
}

function barWidthPx(task: Task): number {
  const a = dayIndex(task.start)
  const b = dayIndex(task.end)
  if (a < 0 || b < 0) return CELL
  return Math.max(1, b - a + 1) * CELL
}

const dragState = ref<DragState | null>(null)
const lastDragPointer = ref<PointerEvent | null>(null)
let dragAutoscrollRaf = 0

function formatMdFromIso(iso: string): string {
  const d = parseISODateLocal(iso)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function orderedTaskBounds(task: Task): { lo: string; hi: string } {
  return task.start <= task.end
    ? { lo: task.start, hi: task.end }
    : { lo: task.end, hi: task.start }
}

function barTooltip(task: Task): string {
  const { lo, hi } = orderedTaskBounds(task)
  const title = task.title.trim() || '（未命名任务）'
  return `${title}  ${formatMdFromIso(lo)} — ${formatMdFromIso(hi)}`
}

function barInlineLabel(task: Task): string {
  const { lo, hi } = orderedTaskBounds(task)
  return `${formatMdFromIso(lo)}–${formatMdFromIso(hi)} ${task.title}`
}

/** 在时间轴左侧追加若干天，并补偿滚动与拖拽中的索引，避免视口跳动 */
function prependTimelineDays(count: number) {
  if (count <= 0) return
  viewportStart.value = addDaysStr(viewportStart.value, -count)
  const st = dragState.value
  if (st) {
    st.origStartIdx += count
    st.origEndIdx += count
  }
  nextTick(() => {
    const el = scrollXRef.value
    if (el) el.scrollLeft += count * CELL
  })
}

function appendTimelineDays(count: number) {
  if (count <= 0) return
  viewportEnd.value = addDaysStr(viewportEnd.value, count)
}

/** 指针相对时间轴滚动内容区的列索引（0 = 视口内第一列） */
function clientXToTimelineDayIndex(clientX: number): number {
  const el = scrollXRef.value
  if (!el) return 0
  const r = el.getBoundingClientRect()
  const x = clientX - r.left + el.scrollLeft
  return Math.floor(x / CELL)
}

function cancelDragAutoscroll() {
  if (dragAutoscrollRaf) {
    cancelAnimationFrame(dragAutoscrollRaf)
    dragAutoscrollRaf = 0
  }
}

function isPointerInDragAutoscrollZone(clientX: number): 'left' | 'right' | null {
  const el = scrollXRef.value
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (clientX <= r.left + DRAG_AUTOSCROLL_MARGIN_PX) return 'left'
  if (clientX >= r.right - DRAG_AUTOSCROLL_MARGIN_PX) return 'right'
  return null
}

/** 贴边时持续滚时间轴；同一指针不动也能因 scrollLeft 变化而更新落点列 */
function dragAutoscrollTick() {
  dragAutoscrollRaf = 0
  const st = dragState.value
  const ev = lastDragPointer.value
  if (!st || !ev) return

  applyDrag(ev)

  const el = scrollXRef.value
  if (!el) return

  const zone = isPointerInDragAutoscrollZone(ev.clientX)
  let needNext = false

  /** 左缘、右缘贴边均触发滚动：三种拖拽（左柄、右柄、整块）在两侧都能继续拖出视口 */
  if (zone === 'left') {
    if (el.scrollLeft > 0) {
      el.scrollLeft = Math.max(0, el.scrollLeft - DRAG_AUTOSCROLL_STEP_PX)
      needNext = true
    } else {
      prependTimelineDays(12)
      needNext = true
    }
  } else if (zone === 'right') {
    const maxSl = el.scrollWidth - el.clientWidth
    if (el.scrollLeft < maxSl - 1) {
      el.scrollLeft = Math.min(maxSl, el.scrollLeft + DRAG_AUTOSCROLL_STEP_PX)
      needNext = true
    } else {
      appendTimelineDays(12)
      needNext = true
    }
  }

  if (needNext && dragState.value) {
    dragAutoscrollRaf = requestAnimationFrame(dragAutoscrollTick)
  }
}

function scheduleDragAutoscroll() {
  if (dragAutoscrollRaf || !dragState.value || !lastDragPointer.value) return
  const z = isPointerInDragAutoscrollZone(lastDragPointer.value.clientX)
  if (z === 'left' || z === 'right') {
    dragAutoscrollRaf = requestAnimationFrame(dragAutoscrollTick)
  }
}

function applyDrag(e: PointerEvent) {
  const st = dragState.value
  if (!st) return
  let guard = 0
  while (guard++ < 48) {
    const task = tasks.value.find((t) => t.id === st.taskId)
    if (!task) return
    const list = dateStrList.value
    const n = list.length
    if (n === 0) return

    const { mode, origStartIdx, origEndIdx } = st

    if (mode === 'move') {
      const dur = origEndIdx - origStartIdx
      const grab = st.grabOffsetCells ?? 0
      let ns = clientXToTimelineDayIndex(e.clientX) - grab
      if (ns < 0) {
        prependTimelineDays(-ns + 5)
        continue
      }
      if (ns + dur > n - 1) {
        appendTimelineDays(ns + dur - (n - 1) + 5)
        continue
      }
      ns = Math.max(0, Math.min(ns, n - 1 - dur))
      const ne = ns + dur
      task.start = list[ns]!
      task.end = list[ne]!
      return
    }
    if (mode === 'resize-left') {
      let ns = clientXToTimelineDayIndex(e.clientX)
      if (ns < 0) {
        prependTimelineDays(-ns + 5)
        continue
      }
      ns = Math.max(0, Math.min(ns, origEndIdx))
      task.start = list[ns]!
      return
    }
    let ne = clientXToTimelineDayIndex(e.clientX)
    if (ne > n - 1) {
      appendTimelineDays(ne - (n - 1) + 5)
      continue
    }
    ne = Math.max(origStartIdx, Math.min(ne, n - 1))
    task.end = list[ne]!
    return
  }
}

function onPointerMove(e: PointerEvent) {
  lastDragPointer.value = e
  applyDrag(e)
  cancelDragAutoscroll()
  scheduleDragAutoscroll()
}

function onPointerUp(e: PointerEvent) {
  const st = dragState.value
  const el = e.currentTarget as HTMLElement
  cancelDragAutoscroll()
  lastDragPointer.value = null
  if (st) {
    try {
      el.releasePointerCapture(st.pointerId)
    } catch {
      /* ignore */
    }
  }
  el.removeEventListener('pointermove', onPointerMove)
  dragState.value = null
  saveState()
}

function onBarPointerDown(e: PointerEvent, task: Task, mode: DragState['mode']) {
  if (e.button !== 0) return
  e.preventDefault()
  navContextTaskId.value = task.id
  ensureViewportCoversTasks()
  const si = dayIndex(task.start)
  const ei = dayIndex(task.end)
  if (si < 0 || ei < 0) return

  const ptrCol = clientXToTimelineDayIndex(e.clientX)
  dragState.value = {
    taskId: task.id,
    mode,
    startClientX: e.clientX,
    origStartIdx: si,
    origEndIdx: ei,
    pointerId: e.pointerId,
    grabOffsetCells: mode === 'move' ? ptrCol - si : undefined
  }
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp, { once: true })
  el.addEventListener('pointercancel', onPointerUp, { once: true })
}

function addTask() {
  const tday = todayIso()
  if (tday < viewportStart.value) viewportStart.value = addDaysStr(tday, -TASK_PAD_DAYS)
  if (tday > viewportEnd.value) viewportEnd.value = addDaysStr(tday, TASK_PAD_DAYS)
  ensureViewportCoversTasks()
  const list = dateStrList.value
  if (list.length === 0) return
  const si = dayIndex(tday)
  const s = si >= 0 ? tday : viewportStart.value
  const si2 = dayIndex(s)
  const span = Math.min(2, Math.max(0, list.length - 1 - si2))
  let e = addDaysStr(s, span)
  if (s > e) e = s
  const nid = crypto.randomUUID()
  tasks.value.push({
    id: nid,
    title: '新任务',
    start: s,
    end: e,
    color: randomTaskColor()
  })
  navContextTaskId.value = nid
  saveState()
}

function removeTask(id: string) {
  tasks.value = tasks.value.filter((t) => t.id !== id)
  saveState()
}

/** 仅扩展视口以包含所有任务（不收缩），避免任务条落在网格外 */
function ensureViewportCoversTasks() {
  if (tasks.value.length === 0) return
  let minD = tasks.value[0]!.start
  let maxD = tasks.value[0]!.end
  for (const t of tasks.value) {
    const lo = t.start <= t.end ? t.start : t.end
    const hi = t.start <= t.end ? t.end : t.start
    if (lo < minD) minD = lo
    if (hi > maxD) maxD = hi
  }
  const padStart = addDaysStr(minD, -TASK_PAD_DAYS)
  const padEnd = addDaysStr(maxD, TASK_PAD_DAYS)
  if (padStart < viewportStart.value) viewportStart.value = padStart
  if (padEnd > viewportEnd.value) viewportEnd.value = padEnd
}

function initDefaults() {
  const today = todayIso()
  initViewportAroundToday()
  tasks.value = [
    {
      id: crypto.randomUUID(),
      title: '需求分析',
      start: today,
      end: addDaysStr(today, 4),
      color: randomTaskColor()
    },
    {
      id: crypto.randomUUID(),
      title: '开发与联调',
      start: addDaysStr(today, 5),
      end: addDaysStr(today, 14),
      color: randomTaskColor()
    }
  ]
  navContextTaskId.value = tasks.value[0]!.id
}

function loadState(): boolean {
  try {
    const fromNew = localStorage.getItem(STORAGE_KEY)
    const fromLegacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    const raw = fromNew ?? fromLegacy
    if (!raw) return false
    const o = JSON.parse(raw) as {
      viewportStart?: string
      viewportEnd?: string
      rangeStart?: string
      rangeEnd?: string
      showWeekday?: boolean
      tasks?: Task[]
    }
    if (o.viewportStart && o.viewportEnd) {
      viewportStart.value = o.viewportStart
      viewportEnd.value = o.viewportEnd
    } else if (o.rangeStart && o.rangeEnd) {
      viewportStart.value = o.rangeStart
      viewportEnd.value = o.rangeEnd
    } else {
      initViewportAroundToday()
    }
    if (!isValidISODate(viewportStart.value) || !isValidISODate(viewportEnd.value)) {
      initViewportAroundToday()
    }
    if (typeof o.showWeekday === 'boolean') showWeekday.value = o.showWeekday
    const fallbackStart = o.viewportStart ?? o.rangeStart ?? viewportStart.value
    const fallbackEnd = o.viewportEnd ?? o.rangeEnd ?? viewportEnd.value
    if (Array.isArray(o.tasks) && o.tasks.length > 0) {
      tasks.value = o.tasks.map((t) => ({
        id: typeof t.id === 'string' ? t.id : crypto.randomUUID(),
        title: typeof t.title === 'string' ? t.title : '任务',
        start: typeof t.start === 'string' ? t.start : fallbackStart,
        end: typeof t.end === 'string' ? t.end : fallbackEnd,
        color: typeof t.color === 'string' ? t.color : randomTaskColor()
      }))
    } else {
      tasks.value = []
    }
    navContextTaskId.value = tasks.value[0]?.id ?? null
    if (!fromNew && fromLegacy) {
      localStorage.setItem(STORAGE_KEY, raw)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    }
    return true
  } catch {
    return false
  }
}

function saveState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        viewportStart: viewportStart.value,
        viewportEnd: viewportEnd.value,
        showWeekday: showWeekday.value,
        tasks: tasks.value
      })
    )
  } catch {
    /* 存储满或禁用 */
  }
}

function exportTasksPayload() {
  return tasks.value.map((t) => ({
    title: t.title,
    start: t.start,
    end: t.end,
    color: t.color
  }))
}

function exportMetaRange(): { start: string; end: string } {
  if (tasks.value.length === 0) {
    return { start: viewportStart.value, end: viewportEnd.value }
  }
  let minD = tasks.value[0]!.start
  let maxD = tasks.value[0]!.end
  for (const t of tasks.value) {
    const lo = t.start <= t.end ? t.start : t.end
    const hi = t.start <= t.end ? t.end : t.start
    if (lo < minD) minD = lo
    if (hi > maxD) maxD = hi
  }
  return {
    start: addDaysStr(minD, -TASK_PAD_DAYS),
    end: addDaysStr(maxD, TASK_PAD_DAYS)
  }
}

function exportCsvFile() {
  const { start, end } = exportMetaRange()
  const csv = buildCsv(start, end, showWeekday.value, exportTasksPayload())
  downloadBlob(`gantt-${start}_${end}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  ioMessage.value = ''
}

function exportXlsxFile() {
  const { start, end } = exportMetaRange()
  const buf = buildXlsxBuffer(start, end, showWeekday.value, exportTasksPayload())
  downloadBlob(
    `gantt-${start}_${end}.xlsx`,
    new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
  )
  ioMessage.value = ''
}

function triggerImport() {
  fileImport.value?.click()
}

function applyImported(
  res: ReturnType<typeof parseCsvGantt>
) {
  if (res.rows.length === 0) {
    ioMessage.value = '文件中没有有效的任务数据行。'
    return
  }
  if (typeof res.meta.showWeekday === 'boolean') {
    showWeekday.value = res.meta.showWeekday
  }
  tasks.value = res.rows.map((r) => ({
    id: crypto.randomUUID(),
    title: r.title,
    start: r.start,
    end: r.end,
    color: r.color || randomTaskColor()
  }))
  ensureViewportCoversTasks()
  navContextTaskId.value = tasks.value[0]?.id ?? null
  saveState()
  ioMessage.value = `已导入 ${res.rows.length} 条任务。`
  nextTick(() => scrollTimelineToAnchor())
}

async function onImportFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const f = input.files?.[0]
  ioMessage.value = ''
  if (!f) return
  const name = f.name.toLowerCase()
  try {
    if (name.endsWith('.csv')) {
      const text = await f.text()
      applyImported(parseCsvGantt(text))
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const buf = await f.arrayBuffer()
      applyImported(parseXlsxGantt(buf))
    } else {
      ioMessage.value = '请选择 .csv、.xlsx 或 .xls 文件。'
    }
  } catch {
    ioMessage.value = '无法读取文件，请检查格式或是否损坏。'
  }
  input.value = ''
}

watch([viewportStart, viewportEnd], () => {
  const a = viewportStart.value
  const b = viewportEnd.value
  if (a && b && a > b) {
    viewportEnd.value = a
  }
  saveState()
})

function onScrollTimeline() {
  if (scrollExtendBusy.value) return
  const el = scrollXRef.value
  if (!el) return
  if (el.scrollLeft < SCROLL_EDGE_PX) {
    scrollExtendBusy.value = true
    prependTimelineDays(EXTEND_CHUNK_DAYS)
    nextTick(() => {
      scrollExtendBusy.value = false
    })
  } else if (el.scrollLeft + el.clientWidth > el.scrollWidth - SCROLL_EDGE_PX) {
    scrollExtendBusy.value = true
    appendTimelineDays(EXTEND_CHUNK_DAYS)
    nextTick(() => {
      scrollExtendBusy.value = false
    })
  }
}

watch(showWeekday, () => saveState())

/** 将某日期滚入视口（先扩展视口以包含该日） */
function scrollTimelineToDate(iso: string) {
  if (!isValidISODate(iso)) return
  if (iso < viewportStart.value) viewportStart.value = addDaysStr(iso, -TASK_PAD_DAYS)
  if (iso > viewportEnd.value) viewportEnd.value = addDaysStr(iso, TASK_PAD_DAYS)
  ensureViewportCoversTasks()
  nextTick(() => {
    const list = dateStrList.value
    const el = scrollXRef.value
    if (!el || list.length === 0) return
    const idx = list.indexOf(iso)
    if (idx < 0) return
    el.scrollLeft = Math.max(0, idx * CELL - el.clientWidth * 0.22)
  })
}

/** 默认锚定到今天；若今天在视口外则先扩展再滚动 */
function scrollTimelineToAnchor() {
  scrollTimelineToDate(todayIso())
}

function scrollToEarliestTaskStart() {
  if (tasks.value.length === 0) {
    ioMessage.value = '暂无任务。'
    return
  }
  let best = tasks.value[0]!
  let bestLo = orderedTaskBounds(best).lo
  for (const t of tasks.value) {
    const lo = orderedTaskBounds(t).lo
    if (lo < bestLo) {
      bestLo = lo
      best = t
    }
  }
  navContextTaskId.value = best.id
  scrollTimelineToDate(bestLo)
  ioMessage.value = ''
}

function scrollToContextTaskEnd() {
  const t = resolveNavContextTask()
  if (!t) {
    ioMessage.value = '暂无任务。'
    return
  }
  const { hi } = orderedTaskBounds(t)
  scrollTimelineToDate(hi)
  ioMessage.value = ''
}

function scrollToNextTaskStart() {
  const i = navContextTaskIndex()
  if (i < 0 || i >= tasks.value.length - 1) {
    ioMessage.value = '没有下一条任务。'
    return
  }
  const next = tasks.value[i + 1]!
  navContextTaskId.value = next.id
  scrollTimelineToDate(orderedTaskBounds(next).lo)
  ioMessage.value = ''
}

function canScrollToNextTaskStart(): boolean {
  const i = navContextTaskIndex()
  return i >= 0 && i < tasks.value.length - 1
}

watch(
  () => tasks.value.map((t) => `${t.start}|${t.end}`).join(';'),
  () => {
    ensureViewportCoversTasks()
  },
  { flush: 'post' }
)

watch(
  () => tasks.value.map((t) => t.id).join(','),
  () => {
    if (navContextTaskId.value && !tasks.value.some((t) => t.id === navContextTaskId.value)) {
      navContextTaskId.value = tasks.value[0]?.id ?? null
    }
  }
)

onMounted(() => {
  if (!loadState()) {
    initDefaults()
    saveState()
  } else {
    ensureViewportCoversTasks()
  }
  nextTick(() => scrollTimelineToAnchor())
})
</script>

<template>
  <div class="gantt">
    <header class="head">
      <h1>甘特图</h1>
      <p class="lead">
        横轴为日期（向左右滚动可不断延伸时间轴），纵轴为任务；可拖拽色块整体平移或拉左右边调整起止日；任务行左侧手柄可拖动排序。支持导出/导入 CSV 与
        Excel；数据保存在本机浏览器。
      </p>
    </header>

    <section class="toolbar" aria-label="选项与导航">
      <label class="field check">
        <input v-model="showWeekday" type="checkbox" />
        <span>显示星期</span>
      </label>
      <button type="button" class="btn" @click="scrollTimelineToAnchor">回到今天</button>
      <button
        type="button"
        class="btn"
        title="滚动到所有任务里最早的开始日，并将该任务设为导航上下文"
        :disabled="tasks.length === 0"
        @click="scrollToEarliestTaskStart"
      >
        最早开始
      </button>
      <button
        type="button"
        class="btn"
        title="滚动到当前上下文任务的结束日（点击任务名或任务条可切换上下文）"
        :disabled="tasks.length === 0"
        @click="scrollToContextTaskEnd"
      >
        本条结束
      </button>
      <button
        type="button"
        class="btn"
        title="滚动到列表中下一任务的开始日，并把上下文切到该任务"
        :disabled="!canScrollToNextTaskStart()"
        @click="scrollToNextTaskStart"
      >
        下一条开始
      </button>
      <button type="button" class="btn primary" @click="addTask">添加任务</button>
    </section>

    <section class="io-bar" aria-label="导入导出">
      <button type="button" class="btn" @click="exportCsvFile">导出 CSV</button>
      <button type="button" class="btn" @click="exportXlsxFile">导出 Excel</button>
      <button type="button" class="btn" @click="triggerImport">导入…</button>
      <input
        ref="fileImport"
        type="file"
        class="visually-hidden"
        accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        @change="onImportFileChange"
      />
    </section>
    <p v-if="ioMessage" class="io-msg" role="status">{{ ioMessage }}</p>

    <div v-if="days.length === 0" class="empty">时间轴暂不可用，请刷新页面重试。</div>

    <div v-else class="gantt-body">
      <div class="label-col">
        <div class="corner">任务</div>
        <div
          v-for="(task, idx) in tasks"
          :key="task.id"
          class="label-row"
          :class="{
            'is-row-dragging': rowReorderFromIndex === idx,
            'row-drag-over': rowReorderOverIndex === idx && rowReorderFromIndex !== idx,
            'is-nav-context': isNavContextRow(task.id)
          }"
          @dragover.prevent="onRowDragOver(idx)"
          @drop.prevent="onRowDrop(idx)"
        >
          <button
            type="button"
            class="drag-row-handle"
            draggable="true"
            aria-label="拖动调整任务顺序"
            title="按住拖动排序"
            @dragstart="onRowDragStart($event, idx)"
            @dragend="onRowDragEnd"
          >
            <span class="drag-row-handle-bars" aria-hidden="true" />
          </button>
          <input
            v-model="task.title"
            type="text"
            class="title-inp"
            placeholder="任务名称"
            @focus="setNavContextTask(task.id)"
            @blur="saveState"
          />
          <button type="button" class="icon-btn" aria-label="删除任务" @click="removeTask(task.id)">
            ×
          </button>
        </div>
      </div>
      <div ref="scrollXRef" class="scroll-x" @scroll.passive="onScrollTimeline">
        <div class="timeline-header" :style="{ width: `${timelineWidthPx}px` }">
          <div
            v-for="d in days"
            :key="d.dateStr"
            class="day-head"
            :style="{ width: `${CELL}px` }"
          >
            <span class="dm">{{ d.monthDay }}</span>
            <span v-if="showWeekday" class="wd">周{{ d.weekZh }}</span>
          </div>
        </div>
        <div
          v-for="(task, idx) in tasks"
          :key="task.id"
          class="track-row"
          :class="{
            'is-row-dragging': rowReorderFromIndex === idx,
            'row-drag-over': rowReorderOverIndex === idx && rowReorderFromIndex !== idx,
            'is-nav-context': isNavContextRow(task.id)
          }"
          :style="{ width: `${timelineWidthPx}px` }"
          @dragover.prevent="onRowDragOver(idx)"
          @drop.prevent="onRowDrop(idx)"
        >
          <div class="grid-bg">
            <div
              v-for="d in days"
              :key="d.dateStr"
              class="grid-cell"
              :style="{ width: `${CELL}px` }"
            />
          </div>
          <div
            class="bar"
            :title="barTooltip(task)"
            :style="{
              left: `${barLeftPx(task)}px`,
              width: `${barWidthPx(task)}px`,
              background: task.color
            }"
            @pointerdown="(e) => onBarPointerDown(e, task, 'move')"
          >
            <button
              type="button"
              class="handle left"
              aria-label="拖动调整开始日期"
              @pointerdown.stop="(e) => onBarPointerDown(e, task, 'resize-left')"
            />
            <span class="bar-label">{{ barInlineLabel(task) }}</span>
            <button
              type="button"
              class="handle right"
              aria-label="拖动调整结束日期"
              @pointerdown.stop="(e) => onBarPointerDown(e, task, 'resize-right')"
            />
          </div>
        </div>
        <p v-if="tasks.length === 0" class="hint-empty">暂无任务，点击「添加任务」开始。</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gantt {
  max-width: 100%;
  margin: 0 auto;
  padding: 0.75rem 0 2rem;
}

@media (min-width: 640px) {
  .gantt {
    padding-top: 1rem;
  }
}

.head {
  margin-bottom: 1rem;
}

.head h1 {
  font-size: 1.35rem;
  color: var(--color-heading);
  margin: 0 0 0.35rem;
}

.lead {
  margin: 0;
  font-size: 0.88rem;
  line-height: 1.5;
  color: var(--color-text);
  opacity: 0.9;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.65rem 1rem;
  margin-bottom: 1rem;
  padding: 0.65rem 0;
  border-top: 1px solid var(--color-border);
  border-bottom: 1px solid var(--color-border);
}

.field {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.88rem;
  color: var(--color-text);
}

.field.check {
  cursor: pointer;
  user-select: none;
}

.label {
  opacity: 0.85;
}

.date-inp {
  padding: 0.35rem 0.45rem;
  border: 1px solid var(--color-border);
  border-radius: 6px;
  background: var(--color-background);
  color: var(--color-text);
  font-size: 0.88rem;
}

.btn {
  padding: 0.4rem 0.85rem;
  font-size: 0.88rem;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-background-soft);
  color: var(--color-text);
  cursor: pointer;
}

.btn.primary {
  font-weight: 600;
  border-color: var(--color-border-hover);
}

.btn:hover {
  background: var(--color-background-mute);
}

.btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn:disabled:hover {
  background: var(--color-background-soft);
}

.io-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 0.65rem;
  margin-bottom: 0.5rem;
}

.io-msg {
  margin: 0 0 1rem;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.88;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.empty {
  padding: 1.5rem 0;
  color: var(--color-text);
  opacity: 0.85;
}

.gantt-body {
  display: flex;
  align-items: flex-start;
  gap: 0;
  min-width: 0;
  border: 1px solid var(--color-border);
  border-radius: 10px;
  overflow: hidden;
  background: var(--color-background-soft);
}

.label-col {
  flex: 0 0 clamp(8rem, 30vw, 11.5rem);
  border-right: 1px solid var(--color-border);
  background: var(--color-background-mute);
  z-index: 2;
}

.corner {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 0.5rem;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--color-heading);
  border-bottom: 1px solid var(--color-border);
}

.label-row {
  height: 44px;
  display: flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0 0.25rem 0 0.15rem;
  border-bottom: 1px solid var(--color-border);
}

.label-row.is-row-dragging,
.track-row.is-row-dragging {
  opacity: 0.55;
}

.label-row.row-drag-over,
.track-row.row-drag-over {
  box-shadow: inset 0 3px 0 0 var(--color-border-hover);
  background: var(--color-background-mute);
}

.label-row.is-nav-context,
.track-row.is-nav-context {
  box-shadow: inset 3px 0 0 0 var(--color-border-hover);
}

.drag-row-handle {
  flex-shrink: 0;
  width: 1.45rem;
  height: 1.65rem;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  opacity: 0.42;
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
  user-select: none;
}

.drag-row-handle-bars {
  display: block;
  width: 11px;
  height: 2px;
  border-radius: 1px;
  background: currentColor;
  box-shadow:
    0 4px 0 currentColor,
    0 8px 0 currentColor;
}

.drag-row-handle:hover {
  opacity: 0.85;
  background: var(--color-background);
}

.drag-row-handle:active {
  cursor: grabbing;
}

.title-inp {
  flex: 1;
  min-width: 0;
  padding: 0.3rem 0.4rem;
  font-size: 0.82rem;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
}

.title-inp:focus {
  outline: none;
  border-color: var(--color-border-hover);
  background: var(--color-background);
}

.icon-btn {
  flex-shrink: 0;
  width: 1.65rem;
  height: 1.65rem;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text);
  opacity: 0.55;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
}

.icon-btn:hover {
  opacity: 1;
  background: var(--color-background);
}

.scroll-x {
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.timeline-header {
  display: flex;
  height: 52px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-mute);
}

.day-head {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--color-border);
  font-size: 0.68rem;
  line-height: 1.2;
  color: var(--color-text);
  opacity: 0.92;
}

.day-head .dm {
  font-weight: 600;
}

.day-head .wd {
  opacity: 0.75;
  font-size: 0.62rem;
}

.track-row {
  position: relative;
  height: 44px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
}

.grid-bg {
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;
}

.grid-cell {
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  opacity: 0.35;
}

.bar {
  position: absolute;
  top: 5px;
  height: calc(100% - 10px);
  min-width: 12px;
  border-radius: 6px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12);
  cursor: grab;
  display: flex;
  align-items: center;
  justify-content: center;
  touch-action: none;
  color: var(--gantt-bar-text);
  border: 1px solid rgba(0, 0, 0, 0.12);
}

.bar:active {
  cursor: grabbing;
}

.bar-label {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 0 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  text-shadow: var(--gantt-bar-text-shadow);
}

.handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 12px;
  padding: 0;
  border: none;
  background: rgba(0, 0, 0, 0.12);
  cursor: ew-resize;
  touch-action: none;
}

.handle.left {
  left: 0;
  border-radius: 6px 0 0 6px;
}

.handle.right {
  right: 0;
  border-radius: 0 6px 6px 0;
}

.handle:hover {
  background: rgba(0, 0, 0, 0.2);
}

.hint-empty {
  padding: 0.75rem 1rem;
  font-size: 0.85rem;
  color: var(--color-text);
  opacity: 0.75;
}
</style>
