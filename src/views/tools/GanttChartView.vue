<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  clampDateStr,
  eachDateStrInRange,
  formatISODateLocal,
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
const STORAGE_KEY = 'tools-gantt-v1'
const WEEK_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const

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
  startClientX: number
  origStartIdx: number
  origEndIdx: number
  pointerId: number
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

function defaultRange(): { start: string; end: string } {
  const today = formatISODateLocal(new Date())
  const endD = parseISODateLocal(today)
  endD.setDate(endD.getDate() + 20)
  return { start: today, end: formatISODateLocal(endD) }
}

const dr = defaultRange()
const rangeStart = ref(dr.start)
const rangeEnd = ref(dr.end)
const showWeekday = ref(true)
const tasks = ref<Task[]>([])
const fileImport = ref<HTMLInputElement | null>(null)
const ioMessage = ref('')
/** 横向时间轴滚动容器（用于默认滚到「今天」或首个任务起点） */
const scrollXRef = ref<HTMLElement | null>(null)

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

const days = computed(() => {
  const list = eachDateStrInRange(rangeStart.value, rangeEnd.value)
  return list.map((dateStr) => {
    const d = parseISODateLocal(dateStr)
    return {
      dateStr,
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

function applyDrag(e: PointerEvent) {
  const st = dragState.value
  if (!st) return
  const task = tasks.value.find((t) => t.id === st.taskId)
  if (!task) return
  const list = dateStrList.value
  const n = list.length
  if (n === 0) return

  const dDays = Math.round((e.clientX - st.startClientX) / CELL)
  const { mode, origStartIdx, origEndIdx } = st

  if (mode === 'move') {
    const dur = origEndIdx - origStartIdx
    let ns = origStartIdx + dDays
    ns = Math.max(0, Math.min(ns, n - 1 - dur))
    const ne = ns + dur
    task.start = list[ns]!
    task.end = list[ne]!
  } else if (mode === 'resize-left') {
    let ns = origStartIdx + dDays
    ns = Math.max(0, Math.min(ns, origEndIdx))
    task.start = list[ns]!
  } else {
    let ne = origEndIdx + dDays
    ne = Math.max(origStartIdx, Math.min(ne, n - 1))
    task.end = list[ne]!
  }
}

function onPointerMove(e: PointerEvent) {
  applyDrag(e)
}

function onPointerUp(e: PointerEvent) {
  const st = dragState.value
  const el = e.currentTarget as HTMLElement
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
  const si = dayIndex(task.start)
  const ei = dayIndex(task.end)
  if (si < 0 || ei < 0) return

  dragState.value = {
    taskId: task.id,
    mode,
    startClientX: e.clientX,
    origStartIdx: si,
    origEndIdx: ei,
    pointerId: e.pointerId
  }
  const el = e.currentTarget as HTMLElement
  el.setPointerCapture(e.pointerId)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp, { once: true })
  el.addEventListener('pointercancel', onPointerUp, { once: true })
}

function addTask() {
  const min = rangeStart.value
  const max = rangeEnd.value
  const list = dateStrList.value
  if (list.length === 0) return
  let s = min
  let e = addDaysStr(s, Math.min(2, list.length - 1))
  e = clampDateStr(e, min, max)
  if (s > e) e = s
  tasks.value.push({
    id: crypto.randomUUID(),
    title: '新任务',
    start: s,
    end: e,
    color: randomTaskColor()
  })
  saveState()
}

function removeTask(id: string) {
  tasks.value = tasks.value.filter((t) => t.id !== id)
  saveState()
}

/** 无任务时用今天起约三周；有任务时用所有任务日期的最小/最大边界 */
function syncRangeFromTasks() {
  if (tasks.value.length === 0) {
    const r = defaultRange()
    rangeStart.value = r.start
    rangeEnd.value = r.end
    return
  }
  let minD = tasks.value[0]!.start
  let maxD = tasks.value[0]!.end
  for (const t of tasks.value) {
    const lo = t.start <= t.end ? t.start : t.end
    const hi = t.start <= t.end ? t.end : t.start
    if (lo < minD) minD = lo
    if (hi > maxD) maxD = hi
  }
  rangeStart.value = minD
  rangeEnd.value = maxD
}

function initDefaults() {
  const today = formatISODateLocal(new Date())
  const endD = parseISODateLocal(today)
  endD.setDate(endD.getDate() + 20)
  rangeStart.value = today
  rangeEnd.value = formatISODateLocal(endD)
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
}

function loadState(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const o = JSON.parse(raw) as {
      rangeStart?: string
      rangeEnd?: string
      showWeekday?: boolean
      tasks?: Task[]
    }
    if (o.rangeStart && o.rangeEnd) {
      rangeStart.value = o.rangeStart
      rangeEnd.value = o.rangeEnd
    } else {
      return false
    }
    if (typeof o.showWeekday === 'boolean') showWeekday.value = o.showWeekday
    if (Array.isArray(o.tasks) && o.tasks.length > 0) {
      tasks.value = o.tasks.map((t) => ({
        id: typeof t.id === 'string' ? t.id : crypto.randomUUID(),
        title: typeof t.title === 'string' ? t.title : '任务',
        start: typeof t.start === 'string' ? t.start : o.rangeStart!,
        end: typeof t.end === 'string' ? t.end : o.rangeEnd!,
        color: typeof t.color === 'string' ? t.color : randomTaskColor()
      }))
    } else {
      tasks.value = []
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
        rangeStart: rangeStart.value,
        rangeEnd: rangeEnd.value,
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

function exportCsvFile() {
  const csv = buildCsv(
    rangeStart.value,
    rangeEnd.value,
    showWeekday.value,
    exportTasksPayload()
  )
  downloadBlob(
    `gantt-${rangeStart.value}_${rangeEnd.value}.csv`,
    new Blob([csv], { type: 'text/csv;charset=utf-8' })
  )
  ioMessage.value = ''
}

function exportXlsxFile() {
  const buf = buildXlsxBuffer(
    rangeStart.value,
    rangeEnd.value,
    showWeekday.value,
    exportTasksPayload()
  )
  downloadBlob(
    `gantt-${rangeStart.value}_${rangeEnd.value}.xlsx`,
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
  syncRangeFromTasks()
  saveState()
  ioMessage.value = `已导入 ${res.rows.length} 条任务。`
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

function clampAllTasksToRange() {
  const min = rangeStart.value
  const max = rangeEnd.value
  for (const t of tasks.value) {
    let s = clampDateStr(t.start, min, max)
    let e = clampDateStr(t.end, min, max)
    if (s > e) e = s
    t.start = s
    t.end = e
  }
}

watch([rangeStart, rangeEnd], () => {
  const a = rangeStart.value
  const b = rangeEnd.value
  if (a && b && a > b) {
    rangeEnd.value = a
  }
  if (a && b) clampAllTasksToRange()
  saveState()
  nextTick(() => scrollTimelineToAnchor())
})

watch(showWeekday, () => saveState())

/** 今天在范围内则滚到今天，否则滚到第一个任务的开始日（无任务则到范围起点） */
function scrollTimelineToAnchor() {
  const el = scrollXRef.value
  if (!el) return
  const list = dateStrList.value
  if (list.length === 0) return

  const today = formatISODateLocal(new Date())
  const rs = rangeStart.value
  const re = rangeEnd.value
  let target: string
  if (today >= rs && today <= re) {
    target = today
  } else if (tasks.value.length > 0) {
    const t0 = tasks.value[0]!
    target = t0.start <= t0.end ? t0.start : t0.end
  } else {
    target = rs
  }

  const idx = list.indexOf(target)
  el.scrollLeft = idx >= 0 ? idx * CELL : 0
}

/** 任务起止日变化时收紧/扩展横轴范围（与手动改日期输入无关） */
watch(
  () => tasks.value.map((t) => `${t.start}|${t.end}`).join(';'),
  () => {
    syncRangeFromTasks()
    nextTick(() => scrollTimelineToAnchor())
  },
  { flush: 'post' }
)

/** 仅调整任务顺序时，锚点「第一个任务」可能变化，需重算滚动 */
watch(
  () => tasks.value.map((t) => t.id).join(','),
  () => {
    nextTick(() => scrollTimelineToAnchor())
  },
  { flush: 'post' }
)

onMounted(() => {
  if (!loadState()) {
    initDefaults()
    saveState()
  } else {
    syncRangeFromTasks()
    clampAllTasksToRange()
  }
  nextTick(() => scrollTimelineToAnchor())
})
</script>

<template>
  <div class="gantt">
    <header class="head">
      <h1>甘特图</h1>
      <p class="lead">
        横轴为日期、纵轴为任务；可拖拽色块整体平移或拉左右边调整起止日；任务行左侧手柄可拖动排序。支持导出/导入 CSV 与 Excel；数据保存在本机浏览器。
      </p>
    </header>

    <section class="toolbar" aria-label="时间范围与选项">
      <label class="field">
        <span class="label">起始</span>
        <input v-model="rangeStart" type="date" class="date-inp" />
      </label>
      <label class="field">
        <span class="label">结束</span>
        <input v-model="rangeEnd" type="date" class="date-inp" />
      </label>
      <label class="field check">
        <input v-model="showWeekday" type="checkbox" />
        <span>显示星期</span>
      </label>
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

    <div v-if="days.length === 0" class="empty">请设置有效的起始与结束日期。</div>

    <div v-else class="gantt-body">
      <div class="label-col">
        <div class="corner">任务</div>
        <div
          v-for="(task, idx) in tasks"
          :key="task.id"
          class="label-row"
          :class="{
            'is-row-dragging': rowReorderFromIndex === idx,
            'row-drag-over': rowReorderOverIndex === idx && rowReorderFromIndex !== idx
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
            @blur="saveState"
          />
          <button type="button" class="icon-btn" aria-label="删除任务" @click="removeTask(task.id)">
            ×
          </button>
        </div>
      </div>
      <div ref="scrollXRef" class="scroll-x">
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
            'row-drag-over': rowReorderOverIndex === idx && rowReorderFromIndex !== idx
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
            <span class="bar-label">{{ task.title }}</span>
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
