import { describe, it, expect, beforeEach } from 'vitest'
import {
  THEME_STORAGE_KEY,
  getStoredTheme,
  isEffectiveDark,
  applyThemeToDocument,
  setStoredTheme
} from '../theme'

const LEGACY_THEME_KEY = 'tools-theme'

describe('theme', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.removeAttribute('data-theme')
  })

  it('getStoredTheme reads valid keys', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(getStoredTheme()).toBe('dark')
    localStorage.setItem(THEME_STORAGE_KEY, 'light')
    expect(getStoredTheme()).toBe('light')
  })

  it('getStoredTheme returns null for unknown', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'auto')
    expect(getStoredTheme()).toBe(null)
  })

  it('getStoredTheme reads legacy key when new key missing', () => {
    localStorage.setItem(LEGACY_THEME_KEY, 'dark')
    expect(getStoredTheme()).toBe('dark')
  })

  it('setStoredTheme writes new key and removes legacy', () => {
    localStorage.setItem(LEGACY_THEME_KEY, 'light')
    setStoredTheme('dark')
    expect(localStorage.getItem(LEGACY_THEME_KEY)).toBeNull()
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
  })

  it('applyThemeToDocument sets data-theme', () => {
    applyThemeToDocument('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    applyThemeToDocument('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    applyThemeToDocument(null)
    expect(document.documentElement.getAttribute('data-theme')).toBeNull()
  })

  it('isEffectiveDark respects explicit stored preference', () => {
    expect(isEffectiveDark('dark')).toBe(true)
    expect(isEffectiveDark('light')).toBe(false)
  })
})
