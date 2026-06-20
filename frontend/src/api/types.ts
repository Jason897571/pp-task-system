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
}

// Returned by /auth/me and /admin/users (extends User)
export interface MeUser extends User {
  username: string | null
  account_status: AccountStatus
}

export interface AdminUser extends User {
  account_status: AccountStatus
  username: string | null
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
}

export interface BoardColumn {
  id: number
  board_id: number
  name: string
  position: number
  kind: ColumnKind
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
  created_at: string
  updated_at: string
}

export interface Deliverable {
  id: number
  submitter: User
  note: string
  created_at: string
}

export interface Application {
  id: number
  applicant: User
  created_at: string
}

export interface TaskDetail extends Task {
  deliverables: Deliverable[]
  applications: Application[]
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
}

export interface UpdateUserBody {
  role?: Role
  department_id?: number
  is_active?: boolean
}
