import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUpRight, LockKeyhole, Trash2 } from 'lucide-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { chatBackend, type ChatMessage } from '@/lib/chat-backend';
import NotFound from '@/pages/not-found';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

type Message = ChatMessage;
type StoredMessage = Omit<Message, 'role'> & { role?: Message['role'] };

const STORAGE_KEY = 'nemesis-local-conversation-v1';
const queryClient = new QueryClient();

function readConversation(): Message[] {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (!value) return [];
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): Message[] => {
      if (!entry || typeof entry !== 'object') return [];
      const candidate = entry as Partial<StoredMessage>;
      if (
        typeof candidate.id !== 'string' ||
        typeof candidate.text !== 'string' ||
        !candidate.text.trim() ||
        typeof candidate.createdAt !== 'string' ||
        !Number.isFinite(Date.parse(candidate.createdAt)) ||
        (candidate.role !== undefined &&
          candidate.role !== 'user' &&
          candidate.role !== 'assistant')
      ) {
        return [];
      }

      return [{
        id: candidate.id,
        role: candidate.role ?? 'user',
        text: candidate.text,
        createdAt: candidate.createdAt,
      }];
    });
  } catch {
    return [];
  }
}

function Home() {
  const [messages, setMessages] = useState<Message[]>(() =>
    typeof window === 'undefined' ? [] : readConversation()
  );
  const messagesRef = useRef(messages);
  const [draft, setDraft] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [isResponding, setIsResponding] = useState(false);
  const [backendError, setBackendError] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const backendConnected = chatBackend.status === 'connected';

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    if (confirmClear) cancelClearRef.current?.focus();
  }, [confirmClear]);

  function persist(nextMessages: Message[]) {
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextMessages));
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
  }

  async function requestAssistantReply(history: Message[]) {
    const controller = new AbortController();
    activeRequestRef.current = controller;
    setIsResponding(true);
    setBackendError(false);
    try {
      const result = await chatBackend.complete({
        messages: history,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.status !== 'reply') return;

      const text = result.text.trim();
      if (!text) {
        setBackendError(true);
        return;
      }

      persist([
        ...messagesRef.current,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: 'assistant',
          text,
          createdAt: new Date().toISOString(),
        },
      ]);
    } catch {
      if (!controller.signal.aborted) setBackendError(true);
    } finally {
      if (activeRequestRef.current === controller) {
        activeRequestRef.current = null;
        setIsResponding(false);
      }
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || activeRequestRef.current) return;
    const message: Message = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      text,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messagesRef.current, message];
    persist(nextMessages);
    setDraft('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    textareaRef.current?.focus();
    setBackendError(false);
    if (backendConnected) void requestAssistantReply(nextMessages);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  function handleDraftChange(event: ChangeEvent<HTMLTextAreaElement>) {
    setDraft(event.target.value);
    event.target.style.height = 'auto';
    event.target.style.height = `${Math.min(event.target.scrollHeight, 190)}px`;
  }

  function clearConversation() {
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setIsResponding(false);
    persist([]);
    setConfirmClear(false);
    setDraft('');
    setBackendError(false);
    textareaRef.current?.focus();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="Nemesis">
          <span className="brand-mark" aria-hidden="true">N</span>
          <span className="brand-name">nemesis</span>
          <span className="brand-caption">private text chat</span>
        </div>
        <div className="offline-pill" role="status" data-testid="status-offline">
          <span className="offline-dot" aria-hidden="true" />
          {backendConnected ? 'Connected' : 'Offline · not connected'}
        </div>
      </header>

      <main className="main-area">
          <section className="conversation" aria-label="Nemesis chat">
          {messages.length === 0 ? (
            <div className="empty-state" data-testid="empty-conversation">
              <div className="eyebrow">Conversation status</div>
              <h1 className="empty-title">
                {backendConnected ? <>Ready to<br /><em>talk.</em></> : <>No messages<br /><em>just yet.</em></>}
              </h1>
              <p className="empty-copy">
                {backendConnected
                  ? 'Nemesis is connected and ready for your message.'
                  : 'Nemesis is offline and not connected to an AI. Messages aren’t sent anywhere, and no replies will appear.'}
              </p>
              <div className="offline-explainer">
                <span className="offline-explainer-icon" aria-hidden="true" />
                <span>
                  <strong>{backendConnected ? 'Connected' : 'Not connected'}</strong><br />
                  {backendConnected
                    ? 'New messages are sent to the configured AI backend.'
                    : 'Messages are saved only in this browser.'}
                </span>
              </div>
            </div>
          ) : (
            <ol className="message-list" aria-label="Chat messages" aria-live="polite">
              {messages.map((message) => (
                <li className="message-row" key={message.id} data-testid={`message-${message.id}`}>
                  <div className={`message-bubble${message.role === 'assistant' ? ' assistant-message' : ''}`}>
                    <div className="message-sender">
                      {message.role === 'assistant' ? 'Nemesis' : 'You'}
                    </div>
                    <div>{message.text}</div>
                    <div className="message-time">
                      {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(message.createdAt))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div ref={endRef} />
        </section>

        <div className="composer-wrap">
          <form className="composer" onSubmit={submitMessage}>
            <label className="sr-only" htmlFor="message-composer">Message Nemesis</label>
            <textarea
              id="message-composer"
              ref={textareaRef}
              value={draft}
              onChange={handleDraftChange}
              onKeyDown={handleComposerKeyDown}
              placeholder="Message Nemesis…"
              rows={2}
              aria-describedby="composer-help offline-explanation"
              data-testid="input-message"
            />
            <div className="composer-controls">
              <span className="keyboard-hint" id="composer-help">
                <kbd>↵</kbd> to add <span aria-hidden="true">·</span> <kbd>shift ↵</kbd> for a new line
              </span>
              <button className="send-button" type="submit" disabled={!draft.trim() || isResponding} data-testid="button-send-message">
                {isResponding ? 'Waiting…' : 'Send'} <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>
          </form>
          <div className="composer-foot">
            <div className="local-note" id="offline-explanation">
              <span className="local-note-mark" aria-hidden="true" />
              <span>
                {storageAvailable
                  ? backendError
                    ? 'Nemesis could not finish the reply. Your message is still saved here.'
                    : backendConnected
                      ? 'Messages are saved in this browser. New messages are sent to the configured AI.'
                      : 'Offline. Messages stay in this browser and are never sent.'
                  : backendConnected
                    ? 'Connected. This browser could not save your messages; they may be lost when you leave.'
                    : 'Offline. This browser could not save your messages; they may be lost when you leave.'}
              </span>
            </div>
            <button
              className="clear-button"
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={messages.length === 0}
              data-testid="button-clear-conversation"
            >
              Clear conversation
            </button>
          </div>
        </div>
        <div className="bottom-rule">
          <span>
            {backendConnected
              ? 'AI connected · Messages stay on this device'
              : 'No AI connected · Messages stay on this device'}
          </span>
        </div>
      </main>

      {confirmClear && (
        <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmClear(false);
        }}>
          <section
            className="confirm-card"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-title"
            aria-describedby="clear-description"
            onKeyDown={(event) => {
              if (event.key === 'Escape') setConfirmClear(false);
            }}
          >
            <div className="confirm-kicker"><LockKeyhole size={14} aria-hidden="true" /> Local conversation</div>
            <h2 id="clear-title">Clear this conversation?</h2>
            <p id="clear-description">This removes all messages saved in this browser. There’s no undo.</p>
            <div className="confirm-actions">
              <button ref={cancelClearRef} type="button" className="cancel-button" onClick={() => setConfirmClear(false)} data-testid="button-cancel-clear">Keep conversation</button>
              <button type="button" className="confirm-delete-button" onClick={clearConversation} data-testid="button-confirm-clear">
                <Trash2 size={14} aria-hidden="true" /> Clear conversation
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
