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
} from './types'

// --- Auth ---
export const login = (body: LoginBody) =>
  api.post<AuthResponse>('/auth/login', body).then((r) => r.data)

export const register = (body: RegisterBody) =>
  api.post<AuthResponse>('/auth/register', body).then((r) => r.data)

export const getMe = () => api.get<MeUser>('/auth/me').then((r) => r.data)

// --- Boards / Columns ---
export const getBoards = () => api.get<Board[]>('/boards').then((r) => r.data)

export const getColumns = (boardId: number) =>
  api.get<BoardColumn[]>(`/boards/${boardId}/columns`).then((r) => r.data)

export const createColumn = (boardId: number, body: { name: string; kind: ColumnKind }) =>
  api.post<BoardColumn>(`/boards/${boardId}/columns`, body).then((r) => r.data)

export const updateColumn = (
  cid: number,
  body: { name?: string; kind?: ColumnKind; position?: number },
) => api.put<BoardColumn>(`/columns/${cid}`, body).then((r) => r.data)

export const deleteColumn = (cid: number) =>
  api.delete<{ ok: boolean }>(`/columns/${cid}`).then((r) => r.data)

// --- Tasks ---
export const getTasks = (params: { board_id?: number; assignee?: number; lifecycle?: Lifecycle }) =>
  api.get<Task[]>('/tasks', { params }).then((r) => r.data)

export const getTask = (id: number) =>
  api.get<TaskDetail>(`/tasks/${id}`).then((r) => r.data)

export const createTask = (body: CreateTaskBody) =>
  api.post<Task>('/tasks', body).then((r) => r.data)

export const moveTask = (id: number, column_id: number) =>
  api.post<Task>(`/tasks/${id}/move`, { column_id }).then((r) => r.data)

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

export const createUser = (body: CreateUserBody) =>
  api.post<CreatedUser>('/admin/users', body).then((r) => r.data)

export const updateUser = (id: number, body: UpdateUserBody) =>
  api.put<AdminUser>(`/admin/users/${id}`, body).then((r) => r.data)
