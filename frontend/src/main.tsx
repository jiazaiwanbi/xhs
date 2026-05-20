import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'

import App from './App'
import './style.css'
import { AuthProvider } from './stores/auth'
import { SocialProvider } from './stores/social'
import { ToastProvider } from './stores/toast'
import { reportError } from './utils/error-reporter'

window.addEventListener('error', (event) => {
  reportError(event.error instanceof Error ? event.error : new Error(String(event.message)))
})

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <AuthProvider>
      <ToastProvider>
        <SocialProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </SocialProvider>
      </ToastProvider>
    </AuthProvider>
  </React.StrictMode>,
)
