import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WeeklyTagReport } from './WeeklyTagReport'
import type { WeeklyExportTask } from '../api/types'

const mk = (id: number, tags: string[]): WeeklyExportTask => ({
  id,
  title: `任务${id}`,
  description: null,
  priority: 'normal',
  status: '已完成',
  board: '研发看板',
  column: '已完成',
  assignee: '王工',
  creator: 'A',
  is_mandatory: false,
  is_rework: false,
  tags,
  due_date: null,
  created_at: null,
  updated_at: null,
})

describe('WeeklyTagReport', () => {
  it('groups by tag; a multi-tag task appears under each tag; untagged bucket exists', () => {
    render(
      <WeeklyTagReport
        tasks={[mk(1, ['线上', '紧急']), mk(2, ['线上']), mk(3, [])]}
        tagColor={() => '#579dff'}
      />,
    )
    // untagged bucket
    expect(screen.getByText('未分类')).toBeTruthy()
    // task #1 has two tags -> it renders once under 线上 and once under 紧急
    expect(screen.getAllByText('#1').length).toBe(2)
    // within the 线上 group, #1's other tag is annotated
    expect(screen.getByText('也属于 紧急')).toBeTruthy()
  })

  it('shows an empty message when nothing was completed', () => {
    render(<WeeklyTagReport tasks={[]} tagColor={() => '#579dff'} />)
    expect(screen.getByText('这一周暂无完成的任务')).toBeTruthy()
  })
})
