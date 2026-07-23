// Typed models matching docs/API_CONTRACT.md exactly. Source of truth for integration.

export type Role = 'super_admin' | 'admin' | 'member'
export type ColumnKind = 'start' | 'doing' | 'review' | 'done' | null
export type Lifecycle = 'open' | 'pending_approval' | 'on_board' | 'declined'
export type Priority = 'low' | 'normal' | 'high'
export type AccountStatus = 'invited' | 'active'

// User (nested-display shape)
export interface User {
  id: number
  full_name: string
  role: Role
  department_id: number | null
  avatar_attachment_id: number | null
  card_color: string | null
}

// Returned by /auth/me and /admin/users (extends User)
export interface MeUser extends User {
  username: string | null
  account_status: AccountStatus
}

export interface AdminUser extends User {
  account_status: AccountStatus
  username: string | null
  invite_code: string | null
  email: string | null
  phone: string | null
  feishu_open_id: string | null
}

// Returned by POST /admin/users — includes the one-time invite code.
export interface CreatedUser extends User {
  account_status: AccountStatus
  invite_code: string
}

export interface Department {
  id: number
  name: string
}

export interface Board {
  id: number
  name: string
  position: number
  icon: string | null
  is_archive: boolean
}

export interface VisibilityMatrix {
  boards: { id: number; name: string }[]
  users: { id: number; full_name: string; role: Role; department_id: number | null }[]
  // board_id -> allowed user ids; a board absent from the map = visible to all
  visibility: Record<number, number[]>
}

export interface BoardColumn {
  id: number
  board_id: number
  name: string
  position: number
  kind: ColumnKind
  is_final: boolean
  requires_review: boolean
}

// Round-2: 9-color label palette (color field uses these keys).
export type TagColor =
  | 'green'
  | 'yellow'
  | 'orange'
  | 'red'
  | 'purple'
  | 'blue'
  | 'sky'
  | 'pink'
  | 'gray'

export interface Tag {
  id: number
  name: string
  color: TagColor
  link: string | null // optional URL; clicking the tag on a card opens it
}

export interface ChecklistStats {
  done: number
  total: number
}

export interface Task {
  id: number
  title: string
  description: string
  creator: User
  assignee: User | null
  department_id: number
  board_id: number
  column_id: number | null // null when open / pending_approval / declined
  lifecycle: Lifecycle
  is_rework: boolean
  priority: Priority
  is_mandatory: boolean
  due_date: string | null
  deleted_at: string | null
  archived_at: string | null // set while on the archive board (归档看板 weekly view)
  completed_at: string | null // set when the card entered the final-acceptance column (stats only)
  created_at: string
  updated_at: string
  // Round-2 additions (present on every Task the backend returns):
  tags: Tag[]
  checklist_stats: ChecklistStats
}

export interface Attachment {
  id: number
  owner_type: 'task' | 'deliverable'
  owner_id: number
  filename: string
  filesize: number
  content_type: string
  uploader: User
  created_at: string
}

export interface Deliverable {
  id: number
  submitter: User
  note: string
  created_at: string
  attachments: Attachment[]
}

export interface Application {
  id: number
  applicant: User
  created_at: string
}

export interface Comment {
  id: number
  author: User
  body: string
  created_at: string
  attachments: Attachment[]
}

export interface ChecklistItem {
  id: number
  content: string
  is_done: boolean
  position: number
}

export interface Checklist {
  id: number
  title: string
  position: number
  items: ChecklistItem[]
}

export interface TaskDetail extends Task {
  deliverables: Deliverable[]
  applications: Application[]
  checklists: Checklist[]
  attachments: Attachment[]
  comments: Comment[]
  links: LinkedTask[]
}

// Round-2: 每周必做 (recurring) templates.
export interface RecurringTask {
  id: number
  title: string
  description: string
  priority: Priority
  day_of_week: number // 0=周一 … 6=周日
  is_active: boolean
  assignees: User[]
}

export interface CreateRecurringBody {
  title: string
  description?: string
  priority?: Priority
  day_of_week?: number
  assignee_ids: number[]
}

export interface UpdateRecurringBody {
  title?: string
  description?: string
  priority?: Priority
  day_of_week?: number
  is_active?: boolean
  assignee_ids?: number[]
}

// Round-2: 通知 (notifications).
export interface Notification {
  id: number
  type: string
  message: string
  related_task_id: number | null
  is_read: boolean
  created_at: string
}

// Round-2: 统计 (stats).
export interface StatsOverview {
  by_column: { column_id: number; name: string; count: number }[]
  pool_count: number
  overdue_count: number
}

export interface MemberStats {
  user: User
  total: number
  done: number
  in_review: number
  overdue: number
}

export interface LinkedTask {
  id: number
  title: string
  lifecycle: string
  status: string
  board: string | null
  column: string | null
  assignee: User | null
  priority: string
  due_date: string | null
}

export interface WeeklyExportTask {
  id: number
  title: string
  description: string | null
  priority: string
  status: string
  board: string | null
  column: string | null
  assignee: string | null
  creator: string | null
  is_mandatory: boolean
  is_rework: boolean
  tags: string[]
  due_date: string | null
  created_at: string | null
  updated_at: string | null
  completed_at?: string | null
}

export interface WeeklyExport {
  generated_at: string
  week: {
    this_week: { start: string; end: string }
    last_week: { start: string; end: string }
  }
  counts: {
    this_week_completed: number
    in_progress_or_todo: number
    last_week_completed: number
  }
  this_week_completed: WeeklyExportTask[]
  in_progress_or_todo: WeeklyExportTask[]
  last_week_completed: WeeklyExportTask[]
}

export interface AuthResponse {
  access_token: string
  token_type: string
  user: User
}

// --- Request bodies ---

export interface LoginBody {
  username: string
  password: string
}

export interface RegisterBody {
  invite_code: string
  username: string
  password: string
}

export interface CreateTaskBody {
  title: string
  description?: string
  board_id: number
  priority?: Priority
  assignee_id?: number
  department_id?: number
  due_date?: string
}

export interface CreateUserBody {
  full_name: string
  department_id: number
  role: Role
  email?: string
  phone?: string
  feishu_open_id?: string
}

export interface UpdateUserBody {
  role?: Role
  department_id?: number
  is_active?: boolean
  email?: string
  phone?: string
  feishu_open_id?: string
}
