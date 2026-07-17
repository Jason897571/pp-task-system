import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'

dayjs.extend(utc)
dayjs.extend(timezone)

// The whole team is in China, so every date is shown and computed in China time —
// independent of the viewer's browser/OS timezone. Change this one constant if the
// team's timezone ever changes.
export const APP_TZ = 'Asia/Shanghai'

// --- display (an ISO instant -> a string in APP_TZ) ---
export const fmtDateTime = (iso: string): string => dayjs(iso).tz(APP_TZ).format('YYYY-MM-DD HH:mm')
export const fmtMonthDayTime = (iso: string): string => dayjs(iso).tz(APP_TZ).format('M/D HH:mm')

// --- DatePicker <-> stored value ---
// Show a stored UTC instant as its APP_TZ wall-clock in the picker.
export const toPickerValue = (iso: string | null | undefined): dayjs.Dayjs | null =>
  iso ? dayjs(iso).tz(APP_TZ) : null
// Interpret the wall-clock the user picked as APP_TZ, and return a UTC ISO string.
export const fromPickerValue = (d: dayjs.Dayjs | null): string | null =>
  d ? dayjs.tz(d.format('YYYY-MM-DD HH:mm'), APP_TZ).toISOString() : null

// --- calendar-day diff in APP_TZ (matrix "today / this week" bucketing) ---
export const dayDiffTZ = (iso: string | null): number | null => {
  if (!iso) return null
  const due = dayjs(iso).tz(APP_TZ).startOf('day')
  const today = dayjs().tz(APP_TZ).startOf('day')
  return due.diff(today, 'day')
}

// Current moment as an APP_TZ dayjs (for week grouping, etc.).
export const nowTZ = (): dayjs.Dayjs => dayjs().tz(APP_TZ)

// An instant -> a plain Date whose Y/M/D are that instant's APP_TZ calendar day
// (so day/week bucketing is by China's calendar, not the browser's).
export const toTZDate = (d: string | Date): Date => {
  const j = dayjs(d).tz(APP_TZ)
  return new Date(j.year(), j.month(), j.date())
}
