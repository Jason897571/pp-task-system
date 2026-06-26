import { useEffect, useState, type CSSProperties } from 'react'
import { downloadFile } from '../api/endpoints'
import { avatarColor, initial } from '../lib/badges'
import type { User } from '../api/types'

// Avatar images need an auth header, so we fetch the blob and reuse an object URL.
// Keyed by attachment id, which is immutable per upload (a new avatar = new id),
// so the cache busts itself when someone changes their picture.
const cache = new Map<number, string>()
const inflight = new Map<number, Promise<string>>()

function loadAvatar(attId: number): Promise<string> {
  const hit = cache.get(attId)
  if (hit) return Promise.resolve(hit)
  const existing = inflight.get(attId)
  if (existing) return existing
  const p = downloadFile(attId)
    .then(({ blob }) => {
      const url = URL.createObjectURL(blob)
      cache.set(attId, url)
      inflight.delete(attId)
      return url
    })
    .catch((e) => {
      inflight.delete(attId)
      throw e
    })
  inflight.set(attId, p)
  return p
}

type AvatarUser = Pick<User, 'id' | 'full_name' | 'avatar_attachment_id'>

export function UserAvatar({
  user,
  size = 28,
  className = '',
}: {
  user: AvatarUser | null | undefined
  size?: number
  className?: string
}) {
  const attId = user?.avatar_attachment_id ?? null
  const [url, setUrl] = useState<string | null>(attId ? cache.get(attId) ?? null : null)

  useEffect(() => {
    let active = true
    if (attId) {
      loadAvatar(attId)
        .then((u) => active && setUrl(u))
        .catch(() => active && setUrl(null))
    } else {
      setUrl(null)
    }
    return () => {
      active = false
    }
  }, [attId])

  const dims: CSSProperties = { width: size, height: size }
  if (url) {
    return (
      <img
        src={url}
        alt={user?.full_name ?? ''}
        title={user?.full_name}
        className={`av-sm av-img ${className}`}
        style={dims}
      />
    )
  }
  return (
    <span
      className={`av-sm ${className}`}
      style={{ ...dims, background: avatarColor(user?.id ?? 0) }}
      title={user?.full_name}
    >
      {initial(user?.full_name ?? '?')}
    </span>
  )
}
