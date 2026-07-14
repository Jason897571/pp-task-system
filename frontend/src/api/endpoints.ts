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
  Comment,
  LinkedTask,
  RecurringTask,
  CreateRecurringBody,
  UpdateRecurringBody,
  Notification,
  StatsOverview,
  MemberStats,
  WeeklyExport,
} from './types'

// --- Auth ---
export const login = (body: LoginBody) =>
  api.post<AuthResponse>('/auth/login', body).then((r) => r.data)

export const register = (body: RegisterBody) =>
  api.post<AuthResponse>('/auth/register', body).then((r) => r.data)

export const getMe = () => api.get<MeUser>('/auth/me').then((r) => r.data)

// --- Personal settings (current user) ---
export const updateMySettings = (body: { card_color: string | null }) =>
  api.put<MeUser>('/me/settings', body).then((r) => r.data)

export const uploadAvatar = (file: File) => {
  const fd = new FormData()
  fd.append('file', file)
  return api.post<MeUser>('/me/avatar', fd).then((r) => r.data)
}

// --- Boards / Columns ---
export const getBoards = () => api.get<Board[]>('/boards').then((r) => r.data)

export const createBoard = (name: string) =>
  api.post<Board>('/boards', { name }).then((r) => r.data)

export const updateBoard = (id: number, body: { name?: string; icon?: string }) =>
  api.put<Board>(`/boards/${id}`, body).then((r) => r.data)

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
  body: { name?: string; kind?: ColumnKind; position?: number; is_final?: boolean; requires_review?: boolean },
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

// --- Recycle bin (admin/super) ---
export const deleteTask = (id: number) =>
  api.delete<{ ok: boolean }>(`/tasks/${id}`).then((r) => r.data)

export const getTrash = () => api.get<Task[]>('/trash').then((r) => r.data)

export const restoreCard = (id: number) =>
  api.post<Task>(`/tasks/${id}/restore`).then((r) => r.data)

export const purgeTask = (id: number) =>
  api.delete<{ ok: boolean }>(`/tasks/${id}/purge`).then((r) => r.data)

export const moveTaskToBoard = (id: number, board_id: number, column_id: number) =>
  api.post<Task>(`/tasks/${id}/move-to-board`, { board_id, column_id }).then((r) => r.data)

// One-click: restore an archived card to its origin board's final-acceptance column.
export const restoreTaskToOrigin = (id: number) =>
  api.post<Task>(`/tasks/${id}/restore-to-origin`).then((r) => r.data)

export const startTask = (id: number) =>
  api.post<Task>(`/tasks/${id}/start`).then((r) => r.data)

export const submitTask = (id: number, note: string) =>
  api.post<Task>(`/tasks/${id}/submit`, { note }).then((r) => r.data)

export const reviewTask = (id: number, body: { approve: boolean; comment?: string }) =>
  api.post<Task>(`/tasks/${id}/review`, body).then((r) => r.data)

export const commentTask = (id: number, comment: string) =>
  api.post<Comment>(`/tasks/${id}/comment`, { comment }).then((r) => r.data)

export const duplicateTask = (id: number, assignee_id: number) =>
  api.post<Task>(`/tasks/${id}/duplicate`, { assignee_id }).then((r) => r.data)

// --- Related tasks (links) ---
export const linkTask = (id: number, linked_task_id: number) =>
  api.post<LinkedTask>(`/tasks/${id}/links`, { linked_task_id }).then((r) => r.data)

export const unlinkTask = (id: number, linked_id: number) =>
  api.delete<{ ok: boolean }>(`/tasks/${id}/links/${linked_id}`).then((r) => r.data)

export const assignTask = (id: number, assignee_id: number) =>
  api.post<Task>(`/tasks/${id}/assign`, { assignee_id }).then((r) => r.data)

// Send an on-board task back to the pool (clears assignee, keeps the board).
export const toPoolTask = (id: number) =>
  api.post<Task>(`/tasks/${id}/to-pool`).then((r) => r.data)

export const approveTask = (id: number, body: { approve: boolean; assignee_id?: number }) =>
  api.post<Task>(`/tasks/${id}/approve`, body).then((r) => r.data)

// Manually push the task as a card to the Feishu group (managers only).
export const pushTaskToFeishu = (id: number) =>
  api.post<{ ok: boolean }>(`/tasks/${id}/push-feishu`).then((r) => r.data)

// --- Task pool ---
// Omit boardId to fetch the pool across all visible boards (一次看全部需求池).
export const getPool = (boardId?: number) =>
  api
    .get<Task[]>('/pool', { params: boardId ? { board_id: boardId } : {} })
    .then((r) => r.data)

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

// Bulk-resolve every user's Feishu open_id from their email/phone.
export const resolveFeishu = () =>
  api
    .post<{ total: number; resolved: number; failed: number }>('/admin/users/resolve-feishu')
    .then((r) => r.data)

// --- Tags ---
export const getTags = () => api.get<Tag[]>('/tags').then((r) => r.data)

export const createTag = (body: { name: string; color: TagColor; link?: string | null }) =>
  api.post<Tag>('/tags', body).then((r) => r.data)

export const updateTag = (
  id: number,
  body: { name?: string; color?: TagColor; link?: string | null },
) => api.put<Tag>(`/tags/${id}`, body).then((r) => r.data)

export const deleteTag = (id: number) =>
  api.delete<{ ok: boolean }>(`/tags/${id}`).then((r) => r.data)

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
  ownerType: 'task' | 'deliverable' | 'comment',
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

// Weekly export (super_admin): completed-this-week / in-progress-or-todo snapshot /
// completed-last-week task lists as a JSON object the client saves to a file.
export const exportWeekly = () =>
  api.get<WeeklyExport>('/export/weekly').then((r) => r.data)

// Sync every site task into the Feishu bitable (super_admin).
export const syncFeishu = () =>
  api
    .post<{ total: number; created: number; updated: number }>('/sync/feishu')
    .then((r) => r.data)
