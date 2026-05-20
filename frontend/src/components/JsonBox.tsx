export default function JsonBox({ value }: { value: unknown }) {
  let text = ''
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  return <pre className="pre mono">{text}</pre>
}
