import type { DustForgeAPI } from '../../../preload/index'

declare global {
  interface Window {
    dustforge: DustForgeAPI
  }
}

export const api = window.dustforge
