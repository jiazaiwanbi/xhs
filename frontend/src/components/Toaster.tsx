import { useToast } from '../stores/toast'

export default function Toaster() {
  const toast = useToast()
  return (
    <div className="toast-wrap" aria-live="polite" aria-relevant="additions removals">
      {toast.toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`}>
          <div className="toast-msg">{t.message}</div>
          <button className="toast-x" type="button" aria-label="关闭" onClick={() => toast.remove(t.id)}>
            x
          </button>
        </div>
      ))}
    </div>
  )
}
