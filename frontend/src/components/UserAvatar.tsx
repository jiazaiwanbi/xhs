type Props = {
  username: string
  id?: number
  size?: number
  src?: string
}

function hashToHue(input: string) {
  let h = 0
  for (let i = 0; i < input.length; i += 1) h = (h * 31 + input.charCodeAt(i)) >>> 0
  return h % 360
}

export default function UserAvatar({ username, id, size = 40, src }: Props) {
  const initial = username.trim() ? username.trim().slice(0, 1).toUpperCase() : '?'
  const hue = hashToHue(typeof id === 'number' ? String(id) : username || '0')
  const style = {
    width: `${size}px`,
    height: `${size}px`,
    backgroundImage: `linear-gradient(135deg, hsl(${hue} 90% 55%), hsl(${(hue + 40) % 360} 90% 55%))`,
  }
  if (src) return <img src={src} className="avatar" style={{ width: style.width, height: style.height }} alt="" />
  return (
    <div className="avatar" style={style} aria-hidden="true">
      {initial}
    </div>
  )
}
