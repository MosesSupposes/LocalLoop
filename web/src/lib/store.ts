import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SessionUser } from './types'

export const DEFAULT_LOCATION = { lat: 34.0783, lng: -118.2605, label: 'Echo Park' }

type UIState = {
  locale: 'en' | 'es'
  theme: 'dark' | 'light'
  location: { lat: number; lng: number; label: string }
  radiusM: number
  onboarded: boolean
  user: SessionUser | null
  setLocale: (locale: 'en' | 'es') => void
  setTheme: (theme: 'dark' | 'light') => void
  setLocation: (location: { lat: number; lng: number; label: string }) => void
  setRadius: (radiusM: number) => void
  setOnboarded: (onboarded: boolean) => void
  setUser: (user: SessionUser | null) => void
}

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      locale: 'en',
      theme: 'dark',
      location: DEFAULT_LOCATION,
      radiusM: 1600,
      onboarded: false,
      user: null,
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      setLocation: (location) => set({ location }),
      setRadius: (radiusM) => set({ radiusM }),
      setOnboarded: (onboarded) => set({ onboarded }),
      setUser: (user) => set({ user }),
    }),
    {
      name: 'localloop-ui',
      partialize: (state) => ({
        locale: state.locale,
        theme: state.theme,
        location: state.location,
        radiusM: state.radiusM,
        onboarded: state.onboarded,
      }),
    },
  ),
)
