import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { Role, Staff } from '../src/lib/types'
import { mapStaff, q } from './db'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export const newToken = () => randomBytes(24).toString('hex')
export const hashToken = sha

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(sha(a))
  const y = Buffer.from(sha(b))
  return timingSafeEqual(x, y)
}

const OTP_TTL = 10 * 60_000
const SESSION_TTL = 12 * 3600_000
const MAX_ATTEMPTS = 5
export const COOKIE = 'smk_session'

/** Returns the code to send, or null when the phone isn't staff (caller still answers ok). */
export function issueOtp(phone: string): string | null {
  const s = q.get('SELECT id FROM staff WHERE phone = ?', phone)
  if (!s) return null
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  q.run('INSERT OR REPLACE INTO otp (phone, code_hash, expires, attempts) VALUES (?,?,?,0)', phone, sha(`${phone}:${code}`), Date.now() + OTP_TTL)
  return code
}

export function verifyOtp(phone: string, code: string): string | null {
  const row = q.get('SELECT * FROM otp WHERE phone = ?', phone)
  if (!row || (row.expires as number) < Date.now() || (row.attempts as number) >= MAX_ATTEMPTS) return null
  q.run('UPDATE otp SET attempts = attempts + 1 WHERE phone = ?', phone)
  if (!safeEqual(row.code_hash as string, sha(`${phone}:${code}`))) return null
  q.run('DELETE FROM otp WHERE phone = ?', phone)
  const staff = q.get('SELECT id FROM staff WHERE phone = ?', phone)
  if (!staff) return null
  const token = newToken()
  q.run('INSERT INTO sessions VALUES (?,?,?)', sha(token), staff.id as string, Date.now() + SESSION_TTL)
  return token
}

export const endSession = (token: string) => q.run('DELETE FROM sessions WHERE token_hash = ?', sha(token))

export function readCookie(req: Request, name: string): string | undefined {
  const m = (req.headers.cookie ?? '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)
  return m?.[1]
}

declare module 'express-serve-static-core' {
  interface Request {
    staff?: Staff
  }
}

export function attachStaff(req: Request, _res: Response, next: NextFunction) {
  const t = readCookie(req, COOKIE)
  if (t) {
    const row = q.get('SELECT st.* FROM sessions s JOIN staff st ON st.id = s.staff_id WHERE s.token_hash = ? AND s.expires > ?', sha(t), Date.now())
    if (row) req.staff = mapStaff(row)
  }
  next()
}

export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.staff) return void res.status(401).json({ error: 'Sign in required.' })
  if (!roles.includes(req.staff.role)) return void res.status(403).json({ error: 'Not allowed.' })
  next()
}
