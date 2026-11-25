import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, shell, utilityProcess, type UtilityProcess } from 'electron'
import { decryptSecret, encryptSecret } from './settings'

type EngineEventName = 'cacheChanged' | 'syncProgress' | 'outboxChanged' | 'rulesChanged' | 'newMail' | 'accountsActivity'

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onCallback?: (arg: unknown) => void
}

type ChildMessage =
  | { type: 'ready' }
  | { type: 'initError'; error: string }
  | { type: 'result'; id: number; ok: boolean; value?: unknown; error?: string; code?: unknown }
  | { type: 'callback'; id: number; arg: unknown }
  | { type: 'event'; name: EngineEventName; args: unknown[] }
  | { type: 'hostCall'; id: number; method: string; args?: unknown[] }

let child: UtilityProcess | null = null
let active = false
let startPromise: Promise<boolean> | null = null
let callSeq = 0
const pendingCalls = new Map<number, PendingCall>()
const eventListeners = new Map<EngineEventName, (...args: unknown[]) => void>()
const oauthWindows = new Map<number, BrowserWindow>()

export function isEngineActive(): boolean {
  return active && child !== null
}

export function onEngineEvent(name: EngineEventName, listener: ((...args: unknown[]) => void) | null): void {
  if (listener) eventListeners.set(name, listener)
  else eventListeners.delete(name)
}

function rejectAllPending(reason: string): void {
  const error = new Error(reason)
  for (const pending of pendingCalls.values()) pending.reject(error)
  pendingCalls.clear()
}

function closeAllOAuthWindows(): void {
  for (const window of oauthWindows.values()) {
    if (!window.isDestroyed()) window.close()
  }
  oauthWindows.clear()
}

async function handleHostCall(method: string, args: unknown[]): Promise<unknown> {
  if (method === 'secret.encrypt') return encryptSecret(args[0] as string)
  if (method === 'secret.decrypt') return decryptSecret(args[0] as string)
  if (method === 'shell.openExternal') {
    await shell.openExternal(args[0] as string)
    return undefined
  }
  if (method === 'oauth.openWindow') {
    const url = args[0] as string
    const windowId = args[1] as number
    const window = new BrowserWindow({
      width: 520,
      height: 760,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#0f131c',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        devTools: false,
        partition: 'oauth'
      }
    })
    oauthWindows.set(windowId, window)
    window.once('ready-to-show', () => window.show())
    window.on('closed', () => {
      oauthWindows.delete(windowId)
      child?.postMessage({ type: 'hostEvent', name: 'oauthWindowClosed', windowId })
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const allowNavigation = (target: string): boolean => {
      try {
        const parsed = new URL(target)
        return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      } catch {
        return false
      }
    }
    window.webContents.on('will-navigate', (event, target) => {
      if (!allowNavigation(target)) event.preventDefault()
    })
    window.webContents.on('will-redirect', (event, target) => {
      if (!allowNavigation(target)) event.preventDefault()
    })
    void window.loadURL(url).catch((error: unknown) => {
      oauthWindows.delete(windowId)
      if (!window.isDestroyed()) window.close()
      child?.postMessage({
        type: 'hostEvent',
        name: 'oauthWindowError',
        windowId,
        error: error instanceof Error ? error.message : String(error)
      })
    })
    return undefined
  }
  if (method === 'oauth.closeWindow') {
    const windowId = args[0] as number
    const window = oauthWindows.get(windowId)
    oauthWindows.delete(windowId)
    if (window && !window.isDestroyed()) window.close()
    return undefined
  }
  throw new Error(`Unknown host method: ${method}`)
}

export function startEngineHost(): Promise<boolean> {
  if (active && child) return Promise.resolve(true)
  if (startPromise) return startPromise

  const entry = join(__dirname, 'engine.js')
  if (typeof utilityProcess?.fork !== 'function' || !existsSync(entry)) {
    return Promise.resolve(false)
  }

  startPromise = new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!ok) {
        active = false
        startPromise = null
      }
      resolve(ok)
    }

    const timer = setTimeout(() => {
      console.error('[engine] timed out waiting for utilityProcess startup, falling back to in-process')
      try {
        child?.kill()
      } catch {
        // ignore
      }
      child = null
      finish(false)
    }, 15_000)

    try {
      const forked = utilityProcess.fork(entry, [], { serviceName: 'NamiO Mail Engine' })
      child = forked

      forked.on('message', (raw: unknown) => {
        const msg = raw as ChildMessage
        if (!msg || typeof msg !== 'object') return

        if (msg.type === 'ready') {
          active = true
          ;(globalThis as { __namioReadMailboxes?: () => Promise<unknown> }).__namioReadMailboxes = () =>
            callEngine('readMailboxes')
          finish(true)
          return
        }

        if (msg.type === 'initError') {
          console.error('[engine] utilityProcess init failed:', msg.error)
          finish(false)
          return
        }

        if (msg.type === 'callback') {
          pendingCalls.get(msg.id)?.onCallback?.(msg.arg)
          return
        }

        if (msg.type === 'result') {
          const pending = pendingCalls.get(msg.id)
          if (!pending) return
          pendingCalls.delete(msg.id)
          if (msg.ok) {
            pending.resolve(msg.value)
          } else {
            const error = new Error(msg.error ?? 'Engine call failed') as Error & { code?: unknown }
            if (msg.code !== undefined) error.code = msg.code
            pending.reject(error)
          }
          return
        }

        if (msg.type === 'event') {
          const listener = eventListeners.get(msg.name)
          if (listener) listener(...msg.args)
          return
        }

        if (msg.type === 'hostCall') {
          void handleHostCall(msg.method, msg.args ?? []).then(
            (value) => forked.postMessage({ type: 'hostResult', id: msg.id, ok: true, value }),
            (error: unknown) =>
              forked.postMessage({
                type: 'hostResult',
                id: msg.id,
                ok: false,
                error: error instanceof Error ? error.message : String(error)
              })
          )
        }
      })

      forked.on('exit', (code) => {
        if (child === forked) {
          child = null
          active = false
          startPromise = null
          delete (globalThis as { __namioReadMailboxes?: unknown }).__namioReadMailboxes
          closeAllOAuthWindows()
          rejectAllPending(`Mail engine exited (${code})`)
        }
        finish(false)
      })

      forked.postMessage({
        type: 'init',
        userDataDir: app.getPath('userData'),
        isPackaged: app.isPackaged
      })
    } catch (error) {
      console.error('[engine] failed to fork utilityProcess:', error)
      child = null
      finish(false)
    }
  })

  return startPromise
}

export function callEngine<T = unknown>(
  method: string,
  args: unknown[] = [],
  onCallback?: (arg: unknown) => void
): Promise<T> {
  if (!active || !child) {
    return Promise.reject(new Error('Mail engine is not active'))
  }
  const id = ++callSeq
  return new Promise<T>((resolve, reject) => {
    pendingCalls.set(id, {
      resolve: (value) => resolve(value as T),
      reject,
      onCallback
    })
    child!.postMessage({ type: 'call', id, method, args, hasCallback: Boolean(onCallback) })
  })
}

export function stopEngineHost(): void {
  const current = child
  child = null
  active = false
  startPromise = null
  delete (globalThis as { __namioReadMailboxes?: unknown }).__namioReadMailboxes
  closeAllOAuthWindows()
  rejectAllPending('Mail engine shutting down')
  if (!current) return
  try {
    current.postMessage({ type: 'shutdown', id: ++callSeq })
    setTimeout(() => {
      try {
        current.kill()
      } catch {
        // ignore
      }
    }, 500)
  } catch {
    try {
      current.kill()
    } catch {
      // ignore
    }
  }
}
