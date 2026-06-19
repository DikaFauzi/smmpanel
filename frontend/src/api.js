let csrfToken = null

export async function ensureCsrf() {
  if (csrfToken) return csrfToken
  const res = await fetch('/api/csrf', { credentials: 'include' })
  const data = await res.json()
  csrfToken = data.csrfToken
  return csrfToken
}

export async function api(path, options = {}) {
  const headers = new Headers(options.headers || {})
  const isForm = options.body instanceof FormData
  if (!isForm && options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (options.method && options.method !== 'GET') headers.set('x-csrf-token', await ensureCsrf())
  const res = await fetch(path, { credentials: 'include', ...options, headers })
  const type = res.headers.get('content-type') || ''
  const data = type.includes('application/json') ? await res.json() : { ok: res.ok, message: await res.text() }
  if (!res.ok || data.ok === false) throw new Error(data.message || 'Request gagal')
  return data
}

export const money = (value) => `Rp ${Number(value || 0).toLocaleString('id-ID')}`
export const numberId = (value) => Number(value || 0).toLocaleString('id-ID')
