# 📧 Inbox Zero — Full Backend Email Architecture Report

---

## 1. ARCHITECTURE OVERVIEW

```
Browser / Electron
       │
       ▼
Next.js App (apps/web)
  ├── app/api/threads/        ← email list endpoints
  ├── app/api/messages/
  ├── app/api/google/webhook/ ← Gmail push notifications
  ├── app/api/outlook/webhook/← Outlook push notifications
  └── utils/
       ├── gmail/             ← Gmail API wrappers
       ├── outlook/           ← Outlook API wrappers
       └── email/             ← Shared provider abstraction

PostgreSQL (Prisma ORM) — stores rules, metadata, automation
Redis — locks, rate limits, OAuth dedup, queues
Google PubSub → Gmail webhooks
Microsoft Graph subscriptions → Outlook webhooks
```

> **Important:** No raw email bodies/HTML are stored in the DB. Emails always live in Gmail/Outlook. The DB only stores metadata, rules, and automation results.

---

## 2. EMAIL ACCOUNT LINKING (OAuth)

### Google
1. **`GET /api/google/linking/auth-url`** — generates Google OAuth URL with scopes: `openid`, `email`, `gmail.modify`, `gmail.settings.basic`, `calendar.readonly`, `drive.file`
2. User authorizes → redirected to **`GET /api/google/linking/callback`**
3. Callback:
   - Validates state cookie (`GOOGLE_LINKING_STATE_COOKIE_NAME`)
   - Acquires Redis lock (prevents race/duplicate processing)
   - Exchanges `code` → `access_token` + `refresh_token` via `getLinkingOAuth2Client().getToken(code)`
   - Decodes `id_token` JWT to get email/name
   - Calls `handleAccountLinking()` → upserts `Account` + `EmailAccount` rows in DB
   - Calls `mergeAccount()` if user had duplicate accounts
   - Sets up Gmail watch (PubSub subscription)

### Microsoft/Outlook
- Same flow at `/api/outlook/linking/auth-url` + `/api/outlook/linking/callback`
- Token endpoint: `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token`
- Creates an Outlook Graph subscription instead of Gmail watch

Both providers store tokens in the `Account` Prisma model:
```
Account {
  access_token
  refresh_token
  expires_at
  provider: "google" | "microsoft"
  providerAccountId
  disconnectedAt (null if active)
}
```

---

## 3. GMAIL WATCH (REAL-TIME PUSH SETUP)

**File:** `utils/gmail/watch.ts`

```typescript
watchGmail(gmail) {
  gmail.users.watch({
    userId: "me",
    topicName: env.GOOGLE_PUBSUB_TOPIC_NAME,
    labelIds: ["INBOX", "SENT"],
    labelFilterBehavior: "include"
  })
}
```

- Sets up a Google PubSub subscription on the user's mailbox
- Watch expiration is ~7 days; a cron job (`/api/watch/all`) renews them
- Stores expiry in `EmailAccount.watchEmailsExpirationDate`

### Watch Renewal Cron — `GET /api/watch/all`
- Runs on schedule (triggered via `CRON_SECRET`)
- Queries all premium users with valid tokens
- Calls `watchEmailAccount()` per account
- Gmail: re-registers the PubSub watch
- Outlook: renews Graph subscription (max 3 days, auto-renewed)
- Outlook subscription metadata stored in `EmailAccount.watchEmailsSubscriptionId` + `watchEmailsSubscriptionHistory`

---

## 4. GMAIL WEBHOOK FLOW (REAL-TIME INCOMING EMAIL)

**Entry point:** `POST /api/google/webhook`

### Step-by-step:
```
Google PubSub → POST /api/google/webhook
                      │
                      ▼
            1. Validate GOOGLE_PUBSUB_VERIFICATION_TOKEN
            2. Decode base64url payload → { emailAddress, historyId }
            3. Find EmailAccount by email
            4. Respond 200 IMMEDIATELY (Google requires <3s ack)
            5. after() → process async in background
```

### `process-history.ts` (the core):
```
1. Check rate limits (Gmail has strict quotas)
   └── getEmailProviderRateLimitState()

2. Fetch Gmail history since lastSyncedHistoryId
   └── gmail.users.history.list({ startHistoryId })

3. Update lastSyncedHistoryId (monotonic SQL update)
   └── UPDATE EmailAccount SET lastSyncedHistoryId = ?
       WHERE id = ? AND (lastSyncedHistoryId IS NULL OR lastSyncedHistoryId < ?)
   (prevents race conditions on parallel webhooks)

4. Handle expired historyId (404):
   └── Reset to current historyId from webhook

5. Limit history gap to 500 items (prevents thundering herd)

6. For each history item → processHistoryItem()
```

### History event types:
- `messageAdded` → new/received email → run rules + AI
- `labelAdded` → label applied → categorization update
- `labelRemoved` → learn removal patterns (unsubscribes, user corrections)

### `process-history-item.ts` (per-message processing):
```
1. markMessageAsProcessing(messageId) → Redis lock
   └── Prevents duplicate processing from parallel webhooks

2. Parse message → extract ParsedMessage { id, threadId, subject, from, to, snippet, labelIds, ... }

3. Check if rule already exists for this message (ExecutedRule)

4. Run AI rule matching → choose best matching Rule

5. Execute matched Rule's Actions (archive, label, reply, forward, etc.)

6. Write ExecutedRule + ExecutedAction records to DB
```

---

## 5. OUTLOOK WEBHOOK FLOW

**Entry point:** `POST /api/outlook/webhook`

```
Microsoft Graph → POST /api/outlook/webhook
                      │
                      ▼
1. If ?validationToken in query → respond with plain text (Microsoft handshake)
2. Validate clientState == env.MICROSOFT_WEBHOOK_CLIENT_STATE (403 if mismatch)
3. For each notification in payload:
   └── process-history.ts
         ├── Fetch message from Graph API
         ├── Check folder (inbox/sent only — skip drafts/trash)
         ├── markMessageAsProcessing() (Redis lock)
         ├── Run shared rule processor
         └── Write ExecutedRule to DB
```

---

## 6. HOW EMAILS ARE FETCHED (API LAYER)

**Files:** `utils/gmail/message.ts` + `utils/outlook/message.ts`

### Gmail fetching:
```typescript
// List message IDs
getMessages(gmail, { maxResults, pageToken, q, labelIds })
  → gmail.users.messages.list()

// Batch fetch full messages (up to 100 at once)
queryBatchMessages(gmail, messageIds)
  → POST to batch endpoint /gmail/v1/users/me/messages
  → Returns full message payloads in one HTTP call

// Auto-paginate through all pages
queryBatchMessagesPages(gmail, { q, labelIds, maxMessages })
  → loops getMessages() + queryBatchMessages()

// Token refresh wrapper
getGmailClientWithRefresh(refreshToken)
  → Auto-refreshes expired access_token before calls
```

Retry logic wraps all calls with `withGmailRetry()`:
- 3 retry attempts, exponential backoff
- 401 → trigger token refresh
- 404 → skip (message deleted)
- Other errors → retry

### Outlook fetching:
```typescript
// Query messages via Graph
getMessages(client, { query, after, before, limit })
  → GET /me/messages?$filter=...&$search="..."&$top=50

// KQL search with sanitization
queryBatchMessages(client, { query, after, before })
  → Uses OData $filter + $search (Microsoft KQL)
  → Pagination via @odata.nextLink (not token-based)
```

---

## 7. PROVIDER ABSTRACTION

**Files:** `utils/email/provider.ts`, `utils/email/google.ts`, `utils/email/microsoft.ts`

Both providers implement the same `EmailProvider` interface:
```typescript
interface EmailProvider {
  getThreads(params): Promise<{ threads, nextPageToken }>
  getThread(threadId): Promise<Thread>
  getMessages(params): Promise<{ messages, nextPageToken }>
  getMessage(messageId): Promise<ParsedMessage>
  sendMessage(params): Promise<void>
  replyToMessage(params): Promise<void>
  archiveMessage(messageId): Promise<void>
  labelMessage(messageId, labelId): Promise<void>
  trashMessage(messageId): Promise<void>
  markAsRead(messageId): Promise<void>
  createDraft(params): Promise<Draft>
  forwardMessage(params): Promise<void>
  getLabels(): Promise<Label[]>
  // ... etc
}
```

The factory `getEmailProvider(emailAccount)` returns `GmailProvider` or `OutlookProvider` based on `emailAccount.account.provider`.

---

## 8. EMAIL LIST API (WHAT THE FRONTEND CALLS)

### `GET /api/threads`
```
Query params:
  limit        — page size (default 50)
  q            — search string
  labelId      — filter by Gmail label / Outlook folder
  type         — "from_emails" | "to_emails" | "conversations"
  after/before — date range
  isUnread     — boolean filter
  fromEmail    — sender filter
  nextPageToken

Flow:
  1. getEmailProvider(emailAccount)
  2. provider.getThreads({ q, labelIds, limit, pageToken })
     → Calls Gmail/Outlook API
  3. For each thread: JOIN ExecutedRule from DB (attach automation plan)
  4. Filter ignored senders (Newsletter with UNSUBSCRIBED)
  5. Return { threads: [...], nextPageToken }
```

### `GET /api/messages`
```
  1. provider.getMessages({ q, pageToken })
  2. Filter: no drafts in Outlook, no sent-only in Gmail
  3. Return { messages: [...], nextPageToken }
```

### `GET /api/threads/[id]`
```
  1. provider.getThread(threadId)
  2. getThreadMessages() — filters drafts, parses all messages
  3. Returns full thread with all messages + HTML/text bodies
```

---

## 9. DATABASE SCHEMA (KEY MODELS)

```
Account                          — OAuth tokens (access_token, refresh_token, expires_at)
  └── EmailAccount               — Linked email address + watch state + settings
        ├── Label[]              — Gmail labels synced from provider
        ├── Rule[]               — User-defined automation rules
        │     ├── Action[]       — Actions per rule (archive, label, reply...)
        │     └── ExecutedRule[] — Audit log: which rule ran on which message
        │           ├── ExecutedAction[]    — Which actions were taken
        │           └── ScheduledAction[]   — Deferred actions (run later)
        ├── EmailMessage[]       — Email metadata index (threadId, messageId, from, date, read)
        ├── Newsletter[]         — Sender categorization (APPROVED/UNSUBSCRIBED/AUTO_ARCHIVED)
        ├── Category[]           — Custom categories
        ├── Group[]              — Pattern groups for rule matching
        │     └── GroupItem[]    — Individual patterns (from:, subject:, body:)
        ├── ThreadTracker[]      — Awaiting reply / needs action tracking
        ├── ResponseTime[]       — Response time analytics
        ├── CleanupJob[]         — Bulk cleanup config (archive X days old)
        └── Digest[]             — Email digest config + items
              └── DigestItem[]   — Individual emails in digest
```

### Key model details:

**EmailAccount**
- `email`, `name`, `image`, `timezone`, `role`
- `lastSyncedHistoryId` — tracks Gmail delta sync position
- `watchEmailsExpirationDate` — when Gmail PubSub watch expires
- `watchEmailsSubscriptionId` — Outlook subscription ID
- `statsEmailFrequency`, `summaryEmailFrequency`, `filingEnabled`, `meetingBriefingsEnabled`

**EmailMessage** (metadata index only — no bodies stored)
- `threadId`, `messageId`, `date`, `from`, `to`
- `read`, `sent`, `draft`, `inbox` — boolean flags
- Indexes: by `emailAccountId`, `threadId`, `date`, sender

**Rule**
- `name`, `enabled`, `automate`, `runOnThreads`
- `conditionalOperator`: AND | OR
- `instructions` — plain-English AI condition
- `from`, `to`, `subject`, `body` — static regex conditions
- `systemType` — predefined system category
- `groupId` — link to a pattern Group

**ExecutedRule**
- `threadId`, `messageId`, `status` (APPLIED / APPLYING / SKIPPED / ERROR)
- `automated` — whether it ran automatically or was manually triggered
- `matchMetadata` — JSON blob explaining why the rule matched
- `reason` — human-readable explanation

**ScheduledAction**
- `scheduledFor` — future DateTime
- `status`: PENDING / EXECUTING / COMPLETED / FAILED
- `schedulingStatus` — QStash queue state

---

## 10. AUTOMATION / RULES ENGINE

### Rule Matching (`utils/ai/choose-rule/`)
```
For each incoming message:

1. Load all active Rules for EmailAccount
2. Check static conditions first (from:, to:, subject:, body: regex)
3. If no static match → send to AI (OpenAI) with message + rules
4. AI returns: { ruleId, reason, confidence }
5. Write ExecutedRule { messageId, threadId, ruleId, status: APPLYING }
6. Execute each Action in the matched Rule
7. Update ExecutedRule.status → APPLIED or ERROR
```

### Action Types

| Action | What it does |
|---|---|
| `ARCHIVE` | Move out of inbox |
| `LABEL` | Apply Gmail label / Outlook category |
| `REPLY` | AI-generate and send reply |
| `DRAFT_EMAIL` | AI-generate draft (don't send) |
| `FORWARD` | Forward to address |
| `SEND_EMAIL` | Send new email |
| `MARK_SPAM` | Move to spam |
| `MARK_READ` | Mark as read |
| `DIGEST` | Collect into daily/weekly digest |
| `MOVE_FOLDER` | Move to folder (Outlook) |
| `CALL_WEBHOOK` | POST to external URL |
| `NOTIFY_SENDER` | Send auto-reply notification |

### Scheduled Actions
- Actions with `delayInMinutes > 0` create `ScheduledAction` records
- Cron job `GET /api/cron/scheduled-actions` runs periodically
- Queries `ScheduledAction WHERE scheduledFor <= NOW AND status = PENDING`
- Executes each action, updates status → `EXECUTED` or `FAILED`

---

## 11. AI CATEGORIZATION

Beyond custom rules, a background AI system categorizes senders:

**File:** `utils/categorize/senders/categorize.ts`

```
Categories:
  NEWSLETTER, MARKETING, CALENDAR, RECEIPT,
  NOTIFICATION, COLD_EMAIL, FYI, AWAITING_REPLY,
  TO_REPLY, ACTIONED

Flow:
1. Batch senders by EmailAccount
2. POST to OpenAI with sender + recent email subjects
3. Map response to SystemType enum
4. Upsert Newsletter record with status
5. Auto-apply matching Rule if automate=true
```

Cold email detection (`utils/cold-email/is-cold-email.ts`) is separate — runs AI analysis specifically to detect unsolicited bulk/sales emails and auto-archives or labels them.

Learned patterns from user behaviour:
- `labelRemoved` events → `GroupItem` records (AI learns "user always removes this label from this sender")
- Pattern analysis stored in `Newsletter.patternAnalyzed` + `lastAnalyzedAt`

---

## 12. BACKGROUND CRON JOBS

| Endpoint | Purpose |
|---|---|
| `GET /api/watch/all` | Renew Gmail/Outlook push subscriptions |
| `GET /api/cron/scheduled-actions` | Execute deferred rule actions |
| `GET /api/cron/automation-jobs` | Run Slack/messaging automations |
| `GET /api/follow-up-reminders` | Generate follow-up drafts for awaiting emails |
| `GET /api/resend/digest/all` | Send email digests to users |
| `GET /api/meeting-briefs` | Send meeting context briefings |

All cron endpoints validate `Authorization: Bearer $CRON_SECRET`.

---

## 13. RATE LIMITING (Gmail Quota Management)

**File:** `utils/email/rate-limit.ts`

- Gmail has strict per-user quotas (250 quota units/second)
- Before processing webhook: `getEmailProviderRateLimitState()` checks Redis for active limits
- On 429 from Gmail: `withRateLimitRecording()` records the limit + exponential backoff
- Webhook processing skipped if rate-limited (message will be re-fetched via next webhook)

---

## 14. KEY FILES REFERENCE

| File | Purpose |
|---|---|
| `utils/gmail/watch.ts` | Gmail watch registration |
| `utils/gmail/message.ts` | Gmail message fetching (batch, pagination) |
| `utils/gmail/thread.ts` | Gmail thread operations |
| `utils/gmail/history.ts` | Gmail history API wrapper |
| `utils/gmail/client.ts` | OAuth client setup + token refresh |
| `utils/outlook/watch.ts` | Outlook subscription management |
| `utils/outlook/message.ts` | Outlook message fetching + KQL queries |
| `utils/outlook/thread.ts` | Outlook thread operations |
| `utils/outlook/subscription-manager.ts` | Outlook webhook subscription lifecycle |
| `utils/email/provider.ts` | Provider factory (creates Gmail/Outlook providers) |
| `utils/email/google.ts` | GmailProvider class (implements EmailProvider) |
| `utils/email/microsoft.ts` | OutlookProvider class (implements EmailProvider) |
| `utils/email/rate-limit.ts` | Gmail/Outlook quota management |
| `app/api/google/webhook/route.ts` | Gmail webhook entry point |
| `app/api/google/webhook/process-history.ts` | Gmail history processing + race condition guards |
| `app/api/google/webhook/process-history-item.ts` | Gmail per-message processing |
| `app/api/outlook/webhook/route.ts` | Outlook webhook entry point |
| `app/api/outlook/webhook/process-history.ts` | Outlook notification processing |
| `app/api/threads/route.ts` | Thread list API |
| `app/api/messages/route.ts` | Message list API |
| `app/api/watch/all/route.ts` | Watch maintenance cron |
| `app/api/cron/scheduled-actions/route.ts` | Scheduled action executor |
| `utils/webhook/process-history-item.ts` | Shared message processor (rules, AI) |
| `utils/ai/choose-rule/match-rules.ts` | AI rule matching logic |
| `utils/ai/choose-rule/execute.ts` | Rule action executor |
| `utils/categorize/senders/categorize.ts` | AI sender categorization |
| `utils/cold-email/is-cold-email.ts` | Cold email AI detection |
| `utils/oauth/account-linking.ts` | Link OAuth account to user |
| `utils/oauth/callback-validation.ts` | Validate OAuth state & code |
| `prisma/schema.prisma` | Full database schema |

---

## 15. END-TO-END FLOW SUMMARY

### New incoming email (Gmail):
```
Gmail receives email
  → Google PubSub fires POST /api/google/webhook
      → decode historyId
      → respond 200 immediately
      → after() [async background]:
            → check rate limits (Redis)
            → gmail.users.history.list({ startHistoryId: lastSyncedHistoryId })
            → monotonic UPDATE lastSyncedHistoryId in DB
            → for each messageAdded in history:
                  → acquire Redis lock (dedup)
                  → gmail.users.messages.get(messageId)
                  → parse → ParsedMessage { subject, from, to, snippet, labelIds, ... }
                  → check ExecutedRule table (already processed?)
                  → match against user's Rules (static regex first, then AI)
                  → execute Actions (archive / label / reply / forward / draft / ...)
                  → write ExecutedRule + ExecutedAction to PostgreSQL
                  → release Redis lock
```

### Frontend loading inbox:
```
Browser → GET /api/threads?limit=50&labelId=INBOX
  → getEmailProvider(emailAccount)  [Gmail or Outlook]
  → provider.getThreads({ labelIds: ["INBOX"], limit: 50 })
      → Gmail: gmail.users.threads.list() + batch fetch messages
      → Outlook: GET /me/mailFolders/inbox/messages
  → JOIN ExecutedRule from DB (attach rule plan to each thread)
  → filter unsubscribed senders
  → return { threads: [...], nextPageToken }
Browser renders thread list
```

### User sends a reply:
```
Browser → POST /api/reply  { threadId, messageId, content }
  → provider.replyToMessage({ threadId, messageId, content })
      → Gmail: gmail.users.messages.send({ raw: base64(MIME) })
      → Outlook: POST /me/messages/{id}/reply
  → if ThreadTracker exists: mark resolved
  → write ResponseTime record to DB
```
