import { api } from './client'
import type {
  AuthResponse,
  Board,
  BoardColumn,
  ColumnKind,
  CreatedUser,
  CreateTaskBody,
  CreateUserBody,
  Department,
  Lifecycle,
  LoginBody,
  MeUser,
  RegisterBody,
  Task,
  TaskDetail,
  AdminUser,
  UpdateUserBody,
  User,
  VisibilityMatrix,
  Tag,
  TagColor,
  Checklist,
  ChecklistItem,
  Attachment,
  RecurringTask,
  CreateRecurringBody,
  UpdateRecurringBody,
  Notification,
  StatsOverview,
  MemberStats,
} from './types'

// --- Auth ---
export const login = (body: LoginBody) =>
  api.post<AuthResponse>('/auth/login', body).then((r) => r.data)

export const register = (body: RegisterBody) =>
  api.post<AuthResponse>('/auth/register', body).then((r) => r.data)

export const getMe = () => api.get<MeUser>('/auth/me').then((r) => r.data)

// --- Boards / Columns ---
export const getBoards = () => api.get<Board[]>('/boards').then((r) => r.data)

export const createBoard = (name: string) =>
  api.post<Board>('/boards', { name }).then((r) => r.data)

export const deleteBoard = (id: number) =>
  api.delete<{ ok: boolean }>(`/boards/${id}`).then((r) => r.data)

export const reorderBoards = (board_ids: number[]) =>
  api.put<{ ok: boolean }>('/boards/reorder', { board_ids }).then((r) => r.data)

export const getVisibilityMatrix = () =>
  api.get<VisibilityMatrix>('/boards/visibility-matrix').then((r) => r.data)

export const setBoardMemberVisibility = (boardId: number, user_ids: number[]) =>
  api
    .put<{ ok: boolean }>(`/boards/${boardId}/member-visibility`, { user_ids })
    .then((r) => r.data)

export const getColumns = (boardId: number) =>
  api.get<BoardColumn[]>(`/boards/${boardId}/columns`).then((r) => r.data)

export const createColumn = (boardId: number, body: { name: string; kind: ColumnKind }) =>
  api.post<BoardColumn>(`/boards/${boardId}/columns`, body).then((r) => r.data)

export const updateColumn = (
  cid: number,
  body: { name?: string; kind?: ColumnKind; position?: number; is_final?: boolean },
) => api.put<BoardColumn>(`/columns/${cid}`, body).then((r) => r.data)

export const deleteColumn = (cid: number) =>
  api.delete<{ ok: boolean }>(`/columns/${cid}`).then((r) => r.data)

export const archiveNow = () =>
  api.post<{ archived: number }>('/boards/archive-now').then((r) => r.data)

// --- Tasks ---
export const getTasks = (params: { board_id?: number; assignee?: number; lifecycle?: Lifecycle }) =>
  api.get<Task[]>('/tasks', { params }).then((r) => r.data)

export const getTask = (id: number) =>
  api.get<TaskDetail>(`/tasks/${id}`).then((r) => r.data)

export const updateTask = (
  id: number,
  body: { title?: string; description?: string; priority?: string; due_date?: string | null },
) => api.put<TaskDetail>(`/tasks/${id}`, body).then((r) => r.data)

export const createTask = (body: CreateTaskBody) =>
  api.post<Task>('/tasks', body).then((r) => r.data)

export const moveTask = (id: number, column_id: number) =>
  api.post<Task>(`/tasks/${id}/move`, { column_id }).then((r) => r.data)

export const moveTaskToBoard = (id: number, board_id: number, column_id: number) =>
  api.post<Task>(`/tasks/${id}/move-to-board`, { board_id, column_id }).then((r) => r.data)

export const startTask = (id: number) =>
  api.post<Task>(`/tasks/${id}/start`).then((r) => r.data)

export const submitTask = (id: number, note: string) =>
  api.post<Task>(`/tasks/${id}/submit`, { note }).then((r) => r.data)

export const reviewTask = (id: number, body: { approve: boolean; comment?: string }) =>
  api.post<Task>(`/tasks/${id}/review`, body).then((r) => r.data)

export const assignTask = (id: number, assignee_id: number) =>
  api.post<Task>(`/tasks/${id}/assign`, { assignee_id }).then((r) => r.data)

export const approveTask = (id: number, body: { approve: boolean; assignee_id?: number }) =>
  api.post<Task>(`/tasks/${id}/approve`, body).then((r) => r.data)

// --- Task pool ---
export const getPool = (boardId: number) =>
  api.get<Task[]>('/pool', { params: { board_id: boardId } }).then((r) => r.data)

export const applyTask = (id: number) =>
  api.post<{ ok: boolean }>(`/tasks/${id}/apply`).then((r) => r.data)

// --- Admin ---
export const getDepartments = () =>
  api.get<Department[]>('/admin/departments').then((r) => r.data)

export const createDepartment = (name: string) =>
  api.post<Department>('/admin/departments', { name }).then((r) => r.data)

export const getAdminUsers = () =>
  api.get<AdminUser[]>('/admin/users').then((r) => r.data)

// Assignable candidates for assign/approve dropdowns — usable by admins
// (own-department members), unlike /admin/users which is super_admin only.
export const getAssignableUsers = () =>
  api.get<User[]>('/users').then((r) => r.data)

export const createUser = (body: CreateUserBody) =>
  api.post<CreatedUser>('/admin/users', body).then((r) => r.data)

export const updateUser = (id: number, body: UpdateUserBody) =>
  api.put<AdminUser>(`/admin/users/${id}`, body).then((r) => r.data)

// --- Tags ---
export const getTags = () => api.get<Tag[]>('/tags').then((r) => r.data)

export const createTag = (body: { name: string; color: TagColor }) =>
  api.post<Tag>('/tags', body).then((r) => r.data)

export const setTaskTags = (taskId: number, tag_ids: number[]) =>
  api.put<Tag[]>(`/tasks/${taskId}/tags`, { tag_ids }).then((r) => r.data)

// --- Checklists ---
export const createChecklist = (taskId: number, title: string) =>
  api.post<Checklist>(`/tasks/${taskId}/checklists`, { title }).then((r) => r.data)

export const updateChecklist = (cid: number, body: { title?: string; position?: number }) =>
  api.put<Checklist>(`/checklists/${cid}`, body).then((r) => r.data)

export const deleteChecklist = (cid: number) =>
  api.delete<{ ok: boolean }>(`/checklists/${cid}`).then((r) => r.data)

export const createChecklistItem = (cid: number, content: string) =>
  api.post<ChecklistItem>(`/checklists/${cid}/items`, { content }).then((r) => r.data)

export const updateChecklistItem = (
  iid: number,
  body: { is_done?: boolean; content?: string; position?: number },
) => api.put<ChecklistItem>(`/checklist-items/${iid}`, body).then((r) => r.data)

export const deleteChecklistItem = (iid: number) =>
  api.delete<{ ok: boolean }>(`/checklist-items/${iid}`).then((r) => r.data)

// --- Files ---
export const uploadFile = (
  file: File,
  ownerType: 'task' | 'deliverable',
  ownerId: number,
) => {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('owner_type', ownerType)
  fd.append('owner_id', String(ownerId))
  return api.post<Attachment>('/files/upload', fd).then((r) => r.data)
}

export const deleteFile = (id: number) =>
  api.delete<{ ok: boolean }>(`/files/${id}`).then((r) => r.data)

// Download URL — used as an <a href>. Auth header is added by the interceptor only
// for axios calls, so we fetch via axios blob and trigger a download.
export const downloadFile = (id: number) =>
  api
    .get<Blob>(`/files/${id}`, { responseType: 'blob' })
    .then((r) => ({ blob: r.data, headers: r.headers }))

// --- Recurring tasks ---
export const getRecurringTasks = () =>
  api.get<RecurringTask[]>('/recurring-tasks').then((r) => r.data)

export const createRecurringTask = (body: CreateRecurringBody) =>
  api.post<RecurringTask>('/recurring-tasks', body).then((r) => r.data)

export const updateRecurringTask = (id: number, body: UpdateRecurringBody) =>
  api.put<RecurringTask>(`/recurring-tasks/${id}`, body).then((r) => r.data)

export const deleteRecurringTask = (id: number) =>
  api.delete<{ ok: boolean }>(`/recurring-tasks/${id}`).then((r) => r.data)

// --- Notifications ---
export const getNotifications = () =>
  api.get<Notification[]>('/notifications').then((r) => r.data)

export const markNotificationRead = (id: number) =>
  api.post<{ ok: boolean }>(`/notifications/${id}/read`).then((r) => r.data)

export const markAllNotificationsRead = () =>
  api.post<{ ok: boolean }>('/notifications/read-all').then((r) => r.data)

// --- Stats ---
export const getStatsOverview = (boardId: number) =>
  api.get<StatsOverview>('/stats/overview', { params: { board_id: boardId } }).then((r) => r.data)

export const getMemberStats = () =>
  api.get<MemberStats[]>('/stats/members').then((r) => r.data)
