export class ApiError extends Error {}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
      headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: 'same-origin',
    })
  } catch {
    throw new ApiError('Can\'t reach the server. Check your connection and retry.')
  }
  // A static host answers unknown /api paths with index.html, which must not count as success.
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json')
  const data = (isJson ? await res.json().catch(() => ({})) : {}) as { error?: string }
  if (!res.ok || !isJson) throw new ApiError(data.error ?? (res.ok ? 'The ordering server is unavailable right now. Please call the shop.' : `Request failed (${res.status}).`))
  return data as T
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.')
