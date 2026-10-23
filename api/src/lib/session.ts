import { SignJWT, jwtVerify } from 'jose'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from '../env.js'

const COOKIE_NAME = 'll_session'
const ALG = 'HS256'
const secret = new TextEncoder().encode(env.sessionSecret)

export type SessionUser = { id: string; email: string }

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: ALG })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(secret)
}

export async function readSession(req: FastifyRequest): Promise<SessionUser | null> {
  const raw = req.cookies?.[COOKIE_NAME]
  if (!raw) return null
  try {
    const { payload } = await jwtVerify(raw, secret, { algorithms: [ALG] })
    if (!payload.sub) return null
    return { id: String(payload.sub), email: String(payload.email ?? '') }
  } catch {
    return null
  }
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(COOKIE_NAME, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.publicWebOrigin.startsWith('https://'),
    maxAge: 60 * 60 * 24 * 30,
  })
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE_NAME, { path: '/' })
}
