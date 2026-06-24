import { useEffect, useState } from 'react'
import { Image, Popconfirm, Upload, App as AntApp } from 'antd'
import { useMutation } from '@tanstack/react-query'
import { deleteFile, downloadFile, uploadFile } from '../api/endpoints'
import { errMessage } from '../api/client'
import type { Attachment } from '../api/types'

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isImage = (att: Attachment) => (att.content_type || '').startsWith('image/')

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

// Image attachment rendered inline: the file endpoint needs an auth header, so we
// fetch the blob and hand antd <Image> an object URL (click = full-screen preview).
function AttachmentThumb({ att }: { att: Attachment }) {
  const [url, setUrl] = useState<string>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let made: string | undefined
    downloadFile(att.id)
      .then(({ blob }) => {
        if (!active) return
        made = URL.createObjectURL(blob)
        setUrl(made)
      })
      .catch(() => active && setFailed(true))
    return () => {
      active = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [att.id])

  if (failed) {
    return <span className="att-thumb-skel">🖼 {att.filename}（加载失败）</span>
  }
  if (!url) {
    return <span className="att-thumb-skel">🖼 {att.filename}…</span>
  }
  return (
    <Image
      src={url}
      alt={att.filename}
      height={84}
      className="att-thumb-img"
      title={`${att.filename} · ${fmtSize(att.filesize)}`}
    />
  )
}

// List of attachments. Images show as preview thumbnails; other files keep the
// download link. `pill` renders compact file pills (used in the 产出 timeline).
// When `deletable`, each file gets a ✕ (uploader / managers).
export function AttachmentList({
  attachments,
  pill = false,
  deletable = false,
  onDeleted,
}: {
  attachments: Attachment[]
  pill?: boolean
  deletable?: boolean
  onDeleted?: () => void
}) {
  const { message } = AntApp.useApp()

  const del = (att: Attachment) =>
    deleteFile(att.id)
      .then(() => {
        message.success('已删除附件')
        onDeleted?.()
      })
      .catch((e) => message.error(errMessage(e)))

  const DeleteX = ({ att, className = 'att-del' }: { att: Attachment; className?: string }) =>
    deletable ? (
      <Popconfirm
        title="删除附件"
        description={`确定删除「${att.filename}」？`}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        onConfirm={() => del(att)}
      >
        <span className={className} onClick={(e) => e.stopPropagation()} title="删除">
          ✕
        </span>
      </Popconfirm>
    ) : null

  if (attachments.length === 0) return null

  const images = attachments.filter(isImage)
  const files = attachments.filter((a) => !isImage(a))

  const thumbs = images.length > 0 && (
    <div className="att-thumbs">
      <Image.PreviewGroup>
        {images.map((att) => (
          <span key={att.id} className="att-thumb">
            <AttachmentThumb att={att} />
            <DeleteX att={att} className="att-del att-thumb-del" />
          </span>
        ))}
      </Image.PreviewGroup>
    </div>
  )

  if (pill) {
    return (
      <div>
        {thumbs}
        {files.map((att) => (
          <span key={att.id} className="cm-file-wrap">
            <button
              type="button"
              className="cm-file"
              onClick={() => triggerDownload(att, message.error)}
              title={`${att.filename} · ${fmtSize(att.filesize)}`}
            >
              📄 {att.filename}
            </button>
            <DeleteX att={att} />
          </span>
        ))}
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      {thumbs}
      {files.map((att) => (
        <div key={att.id} className="att-row">
          <a onClick={() => triggerDownload(att, message.error)} style={{ fontSize: 13 }}>
            📎 {att.filename}{' '}
            <span style={{ color: 'var(--subtle)' }}>({fmtSize(att.filesize)})</span>
          </a>
          <DeleteX att={att} />
        </div>
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
    <section className="cd-sec">
      <div className="cd-sec-h">
        <span className="ic">📎</span>需求附件
      </div>
      {attachments.length === 0 && <span className="cd-empty">暂无附件</span>}
      <AttachmentList attachments={attachments} deletable={canEdit} onDeleted={onChanged} />
      {canEdit && (
        <Upload
          showUploadList={false}
          beforeUpload={(file) => {
            uploadM.mutate(file)
            return false // prevent antd's own XHR upload
          }}
        >
          <button type="button" className="cd-add" style={{ marginTop: 8 }}>
            {uploadM.isPending ? '上传中…' : '+ 上传文件'}
          </button>
        </Upload>
      )}
    </section>
  )
}
