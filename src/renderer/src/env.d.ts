/// <reference types="vite/client" />

import type { MailApi } from '@shared/ipc'

declare global {
  interface Window {
    /** Expuesto por el preload vía contextBridge. */
    api: MailApi
  }
}
