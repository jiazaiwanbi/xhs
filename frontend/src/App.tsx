import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { useAuth } from './stores/auth'
import AccountView from './views/AccountView'
import ChangePasswordView from './views/ChangePasswordView'
import HomeView from './views/HomeView'
import HotView from './views/HotView'
import MessageView from './views/MessageView'
import RegisterView from './views/RegisterView'
import SettingsView from './views/SettingsView'
import UserProfileView from './views/UserProfileView'
import VideoDetailView from './views/VideoDetailView'
import VideoView from './views/VideoView'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuth()
  const location = useLocation()
  if (!auth.isLoggedIn) return <Navigate to={`/account?redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return children
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeView />} />
      <Route path="/feed" element={<Navigate to="/" replace />} />
      <Route path="/hot" element={<HotView />} />
      <Route
        path="/video"
        element={
          <RequireAuth>
            <VideoView />
          </RequireAuth>
        }
      />
      <Route path="/video/:id" element={<VideoDetailView />} />
      <Route path="/account" element={<AccountView />} />
      <Route path="/account/register" element={<RegisterView />} />
      <Route path="/account/change-password" element={<ChangePasswordView />} />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsView />
          </RequireAuth>
        }
      />
      <Route path="/u/:id" element={<UserProfileView />} />
      <Route
        path="/messages"
        element={
          <RequireAuth>
            <MessageView />
          </RequireAuth>
        }
      />
      <Route
        path="/messages/:peerId"
        element={
          <RequireAuth>
            <MessageView />
          </RequireAuth>
        }
      />
    </Routes>
  )
}
