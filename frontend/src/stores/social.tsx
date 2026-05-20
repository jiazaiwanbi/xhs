import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import { ApiError } from '../api/client'
import type { Account } from '../api/types'
import * as socialApi from '../api/social'
import { useAuth } from './auth'

type SocialContextValue = {
  followers: Account[]
  vloggers: Account[]
  followerCount: number
  followingCount: number
  followersLoading: boolean
  vloggersLoading: boolean
  followersError: string
  vloggersError: string
  clear: () => void
  isFollowing: (accountId: number) => boolean
  refreshMine: () => Promise<void>
  refreshFollowers: (vloggerId?: number) => Promise<void>
  refreshVloggers: (followerId?: number) => Promise<void>
  follow: (vloggerId: number) => Promise<void>
  unfollow: (vloggerId: number) => Promise<void>
}

const SocialContext = createContext<SocialContextValue | null>(null)

export function SocialProvider({ children }: { children: ReactNode }) {
  const auth = useAuth()
  const [followers, setFollowers] = useState<Account[]>([])
  const [vloggers, setVloggers] = useState<Account[]>([])
  const [followersLoading, setFollowersLoading] = useState(false)
  const [vloggersLoading, setVloggersLoading] = useState(false)
  const [followersError, setFollowersError] = useState('')
  const [vloggersError, setVloggersError] = useState('')

  const clear = useCallback(() => {
    setFollowers([])
    setVloggers([])
    setFollowersError('')
    setVloggersError('')
    setFollowersLoading(false)
    setVloggersLoading(false)
  }, [])

  const refreshFollowers = useCallback(
    async (vloggerId?: number) => {
      if (!authStoreLoggedIn()) {
        clear()
        return
      }
      setFollowersLoading(true)
      setFollowersError('')
      try {
        const res = await socialApi.getAllFollowers(vloggerId)
        setFollowers(res.followers)
      } catch (e) {
        setFollowersError(e instanceof ApiError ? e.message : String(e))
        setFollowers([])
      } finally {
        setFollowersLoading(false)
      }
    },
    [clear],
  )

  const refreshVloggers = useCallback(
    async (followerId?: number) => {
      if (!authStoreLoggedIn()) {
        clear()
        return
      }
      setVloggersLoading(true)
      setVloggersError('')
      try {
        const res = await socialApi.getAllVloggers(followerId)
        setVloggers(res.vloggers)
      } catch (e) {
        setVloggersError(e instanceof ApiError ? e.message : String(e))
        setVloggers([])
      } finally {
        setVloggersLoading(false)
      }
    },
    [clear],
  )

  const refreshMine = useCallback(async () => {
    await Promise.all([refreshFollowers(), refreshVloggers()])
  }, [refreshFollowers, refreshVloggers])

  const isFollowing = useCallback((accountId: number) => vloggers.some((a) => a.id === accountId), [vloggers])

  const follow = useCallback(
    async (vloggerId: number) => {
      if (!auth.isLoggedIn) throw new ApiError('需要先登录', 401)
      await socialApi.follow(vloggerId)
      await refreshVloggers()
    },
    [auth.isLoggedIn, refreshVloggers],
  )

  const unfollow = useCallback(
    async (vloggerId: number) => {
      if (!auth.isLoggedIn) throw new ApiError('需要先登录', 401)
      await socialApi.unfollow(vloggerId)
      await refreshVloggers()
    },
    [auth.isLoggedIn, refreshVloggers],
  )

  const value = useMemo<SocialContextValue>(
    () => ({
      followers,
      vloggers,
      followerCount: followers.length,
      followingCount: vloggers.length,
      followersLoading,
      vloggersLoading,
      followersError,
      vloggersError,
      clear,
      isFollowing,
      refreshMine,
      refreshFollowers,
      refreshVloggers,
      follow,
      unfollow,
    }),
    [
      clear,
      follow,
      followers,
      followersError,
      followersLoading,
      isFollowing,
      refreshFollowers,
      refreshMine,
      refreshVloggers,
      unfollow,
      vloggers,
      vloggersError,
      vloggersLoading,
    ],
  )

  return <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
}

function authStoreLoggedIn() {
  try {
    return !!localStorage.getItem('access_token')
  } catch {
    return false
  }
}

export function useSocial() {
  const value = useContext(SocialContext)
  if (!value) throw new Error('useSocial must be used within SocialProvider')
  return value
}
