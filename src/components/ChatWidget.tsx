import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MENU_QUICK } from '../lib/chatbot'
import { useStore } from '../lib/store'
import { btnPrimary } from './ui'

export function ChatWidget({ raised }: { raised: boolean }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const { messages } = useStore((s) => s.chat)
  const sendChat = useStore((s) => s.sendChat)
  const resetChat = useStore((s) => s.resetChat)
  const end = useRef<HTMLDivElement>(null)

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [messages, open])

  const send = (t: string) => {
    if (!t.trim()) return
    sendChat(t)
    setText('')
  }
  const last = messages[messages.length - 1]
  const quick = last?.from === 'bot' ? last.quick ?? (messages.length === 1 ? MENU_QUICK : []) : []

  return (
    <>
      {!open && (
        <button
          aria-label="Open chat"
          onClick={() => setOpen(true)}
          className={`fixed right-4 z-40 h-12 w-12 rounded-full bg-primary text-xl text-primary-foreground shadow-glow ${raised ? 'bottom-20' : 'bottom-6'} md:h-14 md:w-14 md:bottom-6 md:text-2xl`}
        >
          💬
        </button>
      )}
      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label="Smokology chat"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="safe-bottom fixed inset-x-0 bottom-0 z-50 flex h-[88dvh] flex-col rounded-t-[28px] border border-line bg-surface md:inset-x-auto md:bottom-6 md:right-6 md:h-[600px] md:w-[400px] md:rounded-[28px]"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-2">
              <div>
                <p className="font-display text-lg font-bold">Smokology Bot</p>
                <p className="text-xs text-muted">Orders · Questions · Tickets</p>
              </div>
              <div className="flex gap-1">
                <button className="rounded-full px-3 text-sm text-muted" onClick={resetChat}>Reset</button>
                <button className="rounded-full px-3 text-xl" aria-label="Close chat" onClick={() => setOpen(false)}>✕</button>
              </div>
            </header>
            <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3" aria-live="polite">
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : ''}`}>
                  <p className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm ${m.from === 'user' ? 'bg-primary text-primary-foreground' : 'bg-raised'}`}>{m.text}</p>
                </div>
              ))}
              <div ref={end} />
            </div>
            {quick.length > 0 && (
              <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-2">
                {quick.map((q) => (
                  <button key={q} onClick={() => send(q)} className="shrink-0 rounded-full border border-primary/40 px-3 text-sm text-primary">{q}</button>
                ))}
              </div>
            )}
            <form className="flex gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); send(text) }}>
              <input aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" />
              <button className={btnPrimary} type="submit">Send</button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
