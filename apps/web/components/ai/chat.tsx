'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import {
  Permission as P,
  type PermissionCode,
  type AiStatusResponse,
  type AiConversationResponse,
  type AiMessageResponse,
  type PageResponse,
} from '@saas/types';
import type { AiResult } from '@/lib/ai';
import { aiErrorText } from '@/lib/ai-errors';
import {
  createConversation,
  listConversations,
  readConversation,
  deleteConversation,
  sendMessage,
  refreshAiStatus,
} from '@/app/(identity)/app/[organizationId]/ai/actions';
export function AiChat({
  org,
  permissions,
  initialStatus,
  initialConversations,
}: {
  org: string;
  permissions: PermissionCode[];
  initialStatus: AiResult<AiStatusResponse>;
  initialConversations: AiResult<PageResponse<AiConversationResponse>>;
}) {
  const [status, setStatus] = useState(initialStatus),
    [conversations, setConversations] = useState(
      initialConversations.ok ? initialConversations.data.items : [],
    ),
    [next, setNext] = useState(
      initialConversations.ok ? initialConversations.data.nextCursor : null,
    ),
    [active, setActive] = useState<string | null>(null),
    [messages, setMessages] = useState<AiMessageResponse[]>([]),
    [older, setOlder] = useState<string | null>(null),
    [text, setText] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(
      initialConversations.ok ? '' : aiErrorText(initialConversations.code),
    ),
    [pending, setPending] = useState<{ id: string; content: string } | null>(null),
    [deleteConfirm, setDeleteConfirm] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const allowed = (...p: PermissionCode[]) => p.every((x) => permissions.includes(x));
  const suggestions = [
    ...(allowed(P.ANALYTICS_VIEW, P.SALES_VIEW, P.FINANCE_VIEW)
      ? ['Как идут продажи?', 'Покажи самые продаваемые товары.', 'Сравни продажи за месяц.']
      : []),
    ...(allowed(P.ANALYTICS_VIEW, P.INVENTORY_VIEW) ? ['Какое состояние запасов?'] : []),
    ...(allowed(P.FINANCE_VIEW) ? ['Какой у нас денежный поток?'] : []),
    ...(allowed(P.ACCOUNTS_PAYABLE_VIEW, P.FINANCE_VIEW) ? ['Сколько мы должны поставщикам?'] : []),
  ];
  async function refreshList() {
    const r = await listConversations(org);
    if (r.ok) {
      setConversations(r.data.items);
      setNext(r.data.nextCursor);
    }
  }
  async function open(id: string) {
    setBusy(true);
    setNotice('');
    try {
      const r = await readConversation(org, id);
      if (r.ok) {
        setActive(id);
        setMessages(r.data.items);
        setOlder(r.data.nextCursor);
        setPending(null);
        setDeleteConfirm(false);
      } else setNotice(aiErrorText(r.code));
    } catch {
      setNotice('Unable to load conversation.');
    } finally {
      setBusy(false);
    }
  }
  async function send(retry?: { id: string; content: string }) {
    const content = retry?.content ?? text.trim();
    if (!content || busy || !(status.ok && status.data.available)) return;
    const command = retry ?? { id: crypto.randomUUID(), content };
    setBusy(true);
    setNotice('');
    setPending(command);
    try {
      let id = active;
      if (!id) {
        const r = await createConversation(org);
        if (!r.ok) {
          setNotice(aiErrorText(r.code));
          return;
        }
        id = r.data.id;
        setActive(id);
        setConversations((c) => [r.data, ...c]);
      }
      const r = await sendMessage(org, id, command.id, command.content);
      if (r.ok) {
        setMessages((m) => [
          ...m.filter((x) => x.clientMessageId !== command.id),
          ...r.data.messages,
        ]);
        setText('');
        if (r.data.messages.some((m) => m.status === 'FAILED')) setPending(command);
        else setPending(null);
        await refreshList();
      } else setNotice(aiErrorText(r.code));
    } catch {
      setNotice('Connection interrupted. Retry sends the same message safely.');
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }
  const available = status.ok && status.data.available;
  return (
    <div className="ai-page">
      <header className="ai-heading">
        <div>
          <p className="eyebrow">YOUR BUSINESS / INTELLIGENCE</p>
          <h1>
            AI Copilot <span className="ai-badge">Read only</span>
          </h1>
          <p>Ask a question. Explore the facts. Decide your next step.</p>
        </div>
        {allowed(P.AI_MANAGE) && (
          <Link className="button secondary" href={`/app/${org}/ai/settings`}>
            AI Settings
          </Link>
        )}
      </header>
      {!available && (
        <div className="ai-notice" role="status">
          <strong>Copilot is unavailable</strong>
          <p>{aiErrorText(status.ok ? status.data.code : status.code)}</p>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setStatus(await refreshAiStatus(org));
              } catch {
                setNotice('Unable to check connection. Please retry.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Check connection
          </button>
        </div>
      )}
      <div className="ai-layout">
        <details className="panel ai-history" open>
          <summary>Conversations</summary>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setActive(null);
              setMessages([]);
              setOlder(null);
              setPending(null);
              setNotice('');
              setText('');
              setDeleteConfirm(false);
            }}
          >
            + New conversation
          </button>
          <nav aria-label="Conversation history">
            {conversations.map((c, i) => (
              <button
                key={c.id}
                className={active === c.id ? 'is-active' : ''}
                disabled={busy}
                aria-current={active === c.id ? 'page' : undefined}
                onClick={() => void open(c.id)}
              >
                {c.title}
                <small>
                  {new Date(c.createdAt).toLocaleDateString()} · {i + 1}
                </small>
              </button>
            ))}
          </nav>
          {!conversations.length && <p>Your private conversations will appear here.</p>}
          {next && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await listConversations(org, next);
                  if (r.ok) {
                    setConversations((c) => [...c, ...r.data.items]);
                    setNext(r.data.nextCursor);
                  } else setNotice(aiErrorText(r.code));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Load more conversations
            </button>
          )}
        </details>
        <section className="panel ai-chat" aria-label="Copilot conversation">
          <div className="ai-toolbar">
            <span className="ai-badge">
              {status.ok && status.data.model ? status.data.model : 'Business assistant'}
            </span>
            {active && (
              <button
                className="ai-delete"
                disabled={busy}
                onClick={() => setDeleteConfirm(!deleteConfirm)}
              >
                Delete conversation
              </button>
            )}
          </div>
          {deleteConfirm && (
            <div className="ai-notice">
              <p>
                Delete this conversation and its stored messages? This cannot be undone in the
                application.
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={async () => {
                  if (!active) return;
                  setBusy(true);
                  try {
                    const r = await deleteConversation(org, active);
                    if (r.ok) {
                      setActive(null);
                      setMessages([]);
                      setOlder(null);
                      setPending(null);
                      setDeleteConfirm(false);
                      await refreshList();
                    } else setNotice(aiErrorText(r.code));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Confirm deletion
              </button>
              <button className="button secondary" onClick={() => setDeleteConfirm(false)}>
                Cancel
              </button>
            </div>
          )}
          {older && active && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await readConversation(org, active, older);
                  if (r.ok) {
                    setMessages((m) => [...r.data.items, ...m]);
                    setOlder(r.data.nextCursor);
                  } else setNotice(aiErrorText(r.code));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Load earlier messages
            </button>
          )}
          <div className="ai-messages" aria-live="polite" aria-relevant="additions text">
            {!messages.length ? (
              <div className="ai-welcome">
                <span className="ai-spark" aria-hidden="true">
                  ✳
                </span>
                <h2>A clearer view starts with a question.</h2>
                <p>
                  Explore sales, stock and cash flow using the data you have permission to view.
                </p>
                <div className="ai-suggestions">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      disabled={busy}
                      onClick={() => {
                        setText(s);
                        input.current?.focus();
                      }}
                    >
                      {s}
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
                <p className="ai-muted">Русский · English · Қазақша</p>
              </div>
            ) : (
              messages.map((m, index) => (
                <article className={`ai-message ai-message-${m.role.toLowerCase()}`} key={m.id}>
                  <strong>{m.role === 'USER' ? 'You' : 'Copilot'}</strong>
                  <div className="ai-message-content">{m.content}</div>
                  {m.status === 'FAILED' && <p role="alert">{aiErrorText(m.errorCode)}</p>}
                  {m.status === 'PENDING' && (
                    <p>
                      Reply pending. Reload the conversation or retry after the request time limit.
                    </p>
                  )}
                  {m.sources.length > 0 && (
                    <div className="ai-sources">
                      <small>Verified data sources · {m.sources.length} tool calls</small>
                      {m.sources.map((s, i) => (
                        <Link key={`${s.tool}-${i}`} href={s.href}>
                          {s.label}
                          {s.from ? ` · ${s.from} — ${s.to}` : ' · Current balance'}
                          {s.currencyCode ? ` · ${s.currencyCode}` : ''}
                          <small>
                            Refreshed {new Date(s.refreshedAt).toLocaleString()}
                            {s.locationId ? ' · Selected location' : ' · Organization'}
                          </small>
                        </Link>
                      ))}
                    </div>
                  )}
                  {m.role === 'ASSISTANT' && m.status === 'COMPLETED' && !m.restricted && (
                    <button
                      className="ai-copy"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(m.content);
                          setNotice('Answer copied.');
                        } catch {
                          setNotice('Copy is unavailable. Select the answer text to copy it.');
                        }
                      }}
                    >
                      Copy answer
                    </button>
                  )}
                  {m.role === 'ASSISTANT' &&
                    m.status !== 'COMPLETED' &&
                    index === messages.length - 1 &&
                    !m.restricted && (
                      <button
                        className="button secondary"
                        disabled={busy || !available}
                        onClick={() => {
                          const userMessage = messages.find(
                            (x) => x.clientMessageId === m.clientMessageId && x.role === 'USER',
                          );
                          if (userMessage)
                            void send({ id: m.clientMessageId, content: userMessage.content });
                        }}
                      >
                        Retry message
                      </button>
                    )}
                </article>
              ))
            )}
          </div>
          {busy && (
            <p role="status" className="ai-muted">
              Processing request. Business tools are checked against your current permissions.
            </p>
          )}
          {notice && (
            <p role="status" className="ai-notice">
              {notice}
            </p>
          )}
          {pending && notice && (
            <button
              className="button secondary"
              disabled={busy || !available}
              onClick={() => void send(pending)}
            >
              Retry last request
            </button>
          )}
          <form
            className="ai-composer"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="copilot-prompt">Ask about your business</label>
            <textarea
              ref={input}
              id="copilot-prompt"
              maxLength={2000}
              rows={3}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              placeholder="Например: сравни продажи за последние 30 дней"
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="ai-toolbar">
              <small>{text.length}/2000 · Ctrl/⌘ + Enter to send</small>
              <button
                className="button"
                disabled={busy || !available || !text.trim()}
                type="submit"
              >
                {busy ? 'Working…' : 'Send question →'}
              </button>
            </div>
          </form>
          <p className="ai-disclaimer">
            AI can make mistakes. Check the linked sources before making decisions. Net Cash Flow is
            not Net Profit.
          </p>
        </section>
      </div>
    </div>
  );
}
