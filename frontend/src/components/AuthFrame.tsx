import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import Icon from './Icon'

export default function AuthFrame({
  title,
  subtitle,
  children,
  footer,
  closeTo = '/',
}: {
  title: string
  subtitle: string
  children: ReactNode
  footer?: ReactNode
  closeTo?: string
}) {
  const navigate = useNavigate()
  return (
    <div className="login-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <div className="login-card">
        <button className="login-close" type="button" onClick={() => void navigate(closeTo)} aria-label="关闭"><Icon name="close" /></button>
        <section className="login-brand">
          <div className="login-logo">内容社区</div>
          <h2>发现真实、有趣的生活</h2>
          <div className="login-orbit"><span>穿搭</span><span>美食</span><span>旅行</span><span>灵感</span></div>
          <p>分享和发现生活里的每一个闪光时刻</p>
        </section>
        <section className="login-form-panel auth-form-panel">
          <h1>{title}</h1>
          <p className="login-lead">{subtitle}</p>
          <div className="auth-fields">{children}</div>
          {footer ? <div className="auth-footer">{footer}</div> : null}
        </section>
      </div>
    </div>
  )
}
