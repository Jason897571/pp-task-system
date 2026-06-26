import { useState } from 'react'
import { Button, ColorPicker, Modal, Upload, App as AntApp } from 'antd'
import { updateMySettings, uploadAvatar } from '../api/endpoints'
import { errMessage } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { UserAvatar } from './UserAvatar'

// Personal settings: custom avatar image + the background colour applied to the
// cards this user is assigned to (visible to everyone). Mounted on demand so it
// always opens with the latest values.
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { user, refreshMe } = useAuth()
  const { message } = AntApp.useApp()
  const [color, setColor] = useState<string | null>(user?.card_color ?? null)
  const [savingColor, setSavingColor] = useState(false)
  const [uploading, setUploading] = useState(false)

  const onUpload = async (file: File) => {
    setUploading(true)
    try {
      await uploadAvatar(file)
      refreshMe()
      message.success('头像已更新')
    } catch (e) {
      message.error(errMessage(e, '头像上传失败'))
    } finally {
      setUploading(false)
    }
  }

  const saveColor = async (next: string | null) => {
    setColor(next)
    setSavingColor(true)
    try {
      await updateMySettings({ card_color: next })
      refreshMe()
      message.success(next ? '卡片颜色已更新' : '已恢复默认卡片颜色')
    } catch (e) {
      message.error(errMessage(e, '保存失败'))
    } finally {
      setSavingColor(false)
    }
  }

  return (
    <Modal open onCancel={onClose} title="个人设置" footer={null} width={420}>
      <div className="settings">
        <div className="set-row">
          <div className="set-label">头像</div>
          <div className="set-ctl">
            <UserAvatar user={user} size={56} />
            <Upload
              showUploadList={false}
              accept="image/png,image/jpeg,image/webp,image/gif"
              beforeUpload={(f) => {
                onUpload(f)
                return false
              }}
            >
              <Button size="small" loading={uploading}>
                上传图片
              </Button>
            </Upload>
          </div>
        </div>

        <div className="set-row">
          <div className="set-label">我的卡片颜色</div>
          <div className="set-ctl">
            <ColorPicker
              value={color ?? undefined}
              onChangeComplete={(c) => saveColor(c.toHexString())}
            />
            <span className="set-hint">负责人是你的卡片会用这个背景色（所有人可见）</span>
            {color && (
              <Button
                size="small"
                type="text"
                danger
                loading={savingColor}
                onClick={() => saveColor(null)}
              >
                清除
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
