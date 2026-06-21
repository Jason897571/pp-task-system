import { Button, Upload, App as AntApp } from 'antd'
import { useMutation } from '@tanstack/react-query'
import { downloadFile, uploadFile } from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Attachment } from '../api/types'

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// Triggers a browser download for an attachment (auth header added by axios interceptor).
async function triggerDownload(att: Attachment, onError: (msg: string) => void) {
  try {
    const { blob } = await downloadFile(att.id)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = att.filename
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    onError(errMessage(e, '下载失败'))
  }
}

// Read-only list of attachments with download links. Reused for deliverable attachments.
export function AttachmentList({ attachments }: { attachments: Attachment[] }) {
  const { message } = AntApp.useApp()
  if (attachments.length === 0) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      {attachments.map((att) => (
        <a
          key={att.id}
          onClick={() => triggerDownload(att, message.error)}
          style={{ fontSize: 13 }}
        >
          📎 {att.filename} <span style={{ color: 'var(--subtle)' }}>({fmtSize(att.filesize)})</span>
        </a>
      ))}
    </div>
  )
}

interface Props {
  taskId: number
  attachments: Attachment[]
  canEdit: boolean
  onChanged: () => void
}

export function AttachmentsSection({ taskId, attachments, canEdit, onChanged }: Props) {
  const { message } = AntApp.useApp()

  const uploadM = useMutation({
    mutationFn: (file: File) => uploadFile(file, 'task', taskId),
    onSuccess: () => {
      message.success('已上传')
      onChanged()
    },
    onError: (e) => message.error(errMessage(e)),
  })

  return (
    <section style={{ marginTop: 18 }}>
      <h4>📎 附件</h4>
      {attachments.length === 0 && (
        <span style={{ color: 'var(--subtle)', fontSize: 13 }}>暂无附件</span>
      )}
      <AttachmentList attachments={attachments} />
      {canEdit && (
        <Upload
          showUploadList={false}
          beforeUpload={(file) => {
            uploadM.mutate(file)
            return false // prevent antd's own XHR upload
          }}
        >
          <Button size="small" type="dashed" loading={uploadM.isPending} style={{ marginTop: 8 }}>
            + 上传文件
          </Button>
        </Upload>
      )}
    </section>
  )
}
