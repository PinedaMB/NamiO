/**
 * Modelo de datos de la UI y contenido de demostración.
 *
 * Los tipos anticipan lo que va a devolver el núcleo IMAP en M1: hilos con
 * mensajes, participantes, adjuntos y etiquetas. Cuando llegue el motor de sync
 * esto se reemplaza por la caché SQLite sin tocar los componentes.
 */

export type TagTone = 'primary' | 'secondary' | 'tertiary' | 'error' | 'muted'

export interface Tag {
  label: string
  tone?: TagTone
  icon?: string
}

export interface Attachment {
  name: string
  size: string
  detail: string
  kind: 'pdf' | 'sheet' | 'calendar' | 'file'
}

export interface Person {
  name: string
  email: string
  initials: string
  org?: string
}

export interface Message {
  id: string
  from: Person
  to: Person[]
  sentAt: string
  body: string[]
  summary?: { title: string; bullets: string[] }
  attachments?: Attachment[]
  signature?: { name: string; role: string; place: string }
}

export interface Thread {
  id: string
  subject: string
  preview: string
  receivedAt: string
  unread: boolean
  starred: boolean
  vip: boolean
  messageCount: number
  tags: Tag[]
  participants: Person[]
  messages: Message[]
}

export interface Folder {
  id: string
  icon: string
  label: string
  count?: number
  accent?: boolean
}

export interface BriefPoint {
  title: string
  text: string
}

export interface ActionItem {
  id: string
  title: string
  due: string
  urgent?: boolean
  done: boolean
}

export interface Slot {
  start: string
  end: string
  status: 'requested' | 'free'
}

export const ACCOUNT = {
  name: 'Alex Rivera',
  email: 'alex@veloce.dev',
  initials: 'AR'
} as const

export const FOLDERS: readonly Folder[] = [
  { id: 'inbox', icon: 'inbox', label: 'Inbox', count: 14 },
  { id: 'vip', icon: 'verified', label: 'VIP', count: 3 },
  { id: 'starred', icon: 'star', label: 'Starred', count: 7 },
  { id: 'drafts', icon: 'draft', label: 'Drafts', count: 2 },
  { id: 'sent', icon: 'send', label: 'Sent' },
  { id: 'outbox', icon: 'cloud_sync', label: 'Outbox & Offline', count: 3, accent: true },
  { id: 'archive', icon: 'archive', label: 'Archive' },
  { id: 'trash', icon: 'delete', label: 'Trash' }
]

export const TAGS: readonly { label: string; tone: TagTone }[] = [
  { label: 'Core Infra', tone: 'primary' },
  { label: 'Board & Pitch', tone: 'secondary' },
  { label: 'Urgent SLA', tone: 'error' }
]

const ELENA: Person = {
  name: 'Elena Vance',
  email: 'elena@sequoia.vc',
  initials: 'EV',
  org: 'Sequoia'
}

const ALEX: Person = { name: ACCOUNT.name, email: ACCOUNT.email, initials: ACCOUNT.initials }

export const THREADS: readonly Thread[] = [
  {
    id: 't1',
    subject: 'Series A Term Sheet Review & Founder Call',
    preview:
      'Alex, our investment committee closed consensus this morning. The $18M valuation cap holds with revised pro-rata rights on subsequent equity rounds...',
    receivedAt: '10:42 AM',
    unread: true,
    starred: true,
    vip: true,
    messageCount: 3,
    tags: [
      { label: 'VIP', tone: 'secondary', icon: 'verified' },
      { label: 'Urgent SLA', tone: 'error' },
      { label: '2 files', tone: 'muted', icon: 'attachment' }
    ],
    participants: [ELENA, ALEX],
    messages: [
      {
        id: 'm1',
        from: ELENA,
        to: [ALEX, { name: 'Legal', email: 'legal@veloce.ai', initials: 'LG' }],
        sentAt: 'Today at 10:42 AM (18m ago)',
        body: [
          'Alex,',
          'Following up on our discussions over the weekend. Our partners met this morning at 8:30 AM PT and voted unanimously in favor of issuing the updated Series A commitment letter under the agreed terms.',
          'Please run the attached model through your cap table tool to verify dilution metrics across angel notes. Once Latham gives the green light on clause 4.2, we can sign digitally before 5:00 PM PT.',
          'Can we jump on a brief 15-minute zoom tomorrow morning at 10:30 AM PT to do the ceremonial counter-sign and align on the press release embargo?'
        ],
        summary: {
          title: 'Summary of Core Revisions',
          bullets: [
            'Pre-Money Valuation: $78,000,000 USD on $18,000,000 newly issued preferred shares.',
            'Governance & Board: 3-member board — 2 Founders (Alex, Maya) + 1 Sequoia designee (Elena Vance).',
            'Unallocated Option Pool: adjusted post-close unallocated pool reserved at 10.5% (down from 12.0%).'
          ]
        },
        attachments: [
          { name: 'Term_Sheet_v3_Signed.pdf', size: '2.4 MB', detail: 'PDF · hash verificado', kind: 'pdf' },
          { name: 'CapTable_Model.xlsx', size: '850 KB', detail: 'XLSX · fórmulas verificadas', kind: 'sheet' }
        ],
        signature: { name: 'Elena Vance', role: 'Founding Partner • Sequoia Capital', place: 'Sand Hill Road, Menlo Park, CA' }
      }
    ]
  },
  {
    id: 't2',
    subject: 'API rate-limiting edge rollout updates',
    preview:
      'We pushed regional cluster v4.9.1 to us-east-2. Gateway overhead dropped to sub-4ms with fallback webhooks enabled.',
    receivedAt: '09:15 AM',
    unread: true,
    starred: false,
    vip: false,
    messageCount: 2,
    tags: [
      { label: 'Core Infra', tone: 'tertiary' },
      { label: 'p99 < 5ms', tone: 'muted' }
    ],
    participants: [
      { name: 'Marcus Brody', email: 'marcus@stripe-edge.io', initials: 'MB', org: 'Stripe Edge' },
      ALEX
    ],
    messages: [
      {
        id: 'm2',
        from: { name: 'Marcus Brody', email: 'marcus@stripe-edge.io', initials: 'MB', org: 'Stripe Edge' },
        to: [ALEX],
        sentAt: 'Today at 09:15 AM',
        body: [
          'Alex,',
          'We pushed regional cluster v4.9.1 to us-east-2. Gateway overhead dropped to sub-4ms with fallback webhooks enabled. Leaky bucket is now scoped per-tenant instead of per-IP.',
          'Rollout to eu-west-1 is scheduled for Thursday 02:00 UTC. No action needed unless you want to watch the canary.'
        ]
      }
    ]
  },
  {
    id: 't3',
    subject: 'Figma design tokens synchronization issues',
    preview:
      'The GitHub action token export fails on semantic surface-container-highest mapping. Let me know if you can merge the fix branch.',
    receivedAt: 'Yesterday',
    unread: true,
    starred: false,
    vip: false,
    messageCount: 3,
    tags: [
      { label: 'Tokens', tone: 'muted' },
      { label: 'Linear #429', tone: 'tertiary' }
    ],
    participants: [
      { name: 'Sarah Lin', email: 'sarah@linear.design', initials: 'SL', org: 'Linear Design' },
      ALEX
    ],
    messages: [
      {
        id: 'm3',
        from: { name: 'Sarah Lin', email: 'sarah@linear.design', initials: 'SL', org: 'Linear Design' },
        to: [ALEX],
        sentAt: 'Yesterday at 16:20',
        body: [
          'Hey Alex,',
          'The GitHub action token export fails on semantic surface-container-highest mapping. The collector emits an empty group whenever a token alias resolves through two levels.',
          'I opened a fix branch (tokens/alias-resolution) — let me know if you can merge it before the release cut on Friday.'
        ]
      }
    ]
  },
  {
    id: 't4',
    subject: '[Merged] PR #1284: Optimize virtualized list',
    preview:
      'Merged by @dave into main. 12 files changed, +342 −98. Benchmarked frame drops: 0 frames dropped over 10,000 nodes.',
    receivedAt: 'Yesterday',
    unread: false,
    starred: false,
    vip: false,
    messageCount: 1,
    tags: [{ label: 'infra/client', tone: 'secondary' }],
    participants: [{ name: 'GitHub Automation', email: 'notifications@github.com', initials: 'GH' }, ALEX],
    messages: [
      {
        id: 'm4',
        from: { name: 'GitHub Automation', email: 'notifications@github.com', initials: 'GH' },
        to: [ALEX],
        sentAt: 'Yesterday at 11:04',
        body: [
          'Merged by @dave into main.',
          '12 files changed, +342 −98. Benchmarked frame drops: 0 frames dropped over 10,000 nodes. Bundle size moved from 213.4 kB to 218.1 kB (+2.2%).'
        ]
      }
    ]
  },
  {
    id: 't5',
    subject: 'Updated Board Observer Agreement Draft',
    preview:
      "Attached clean copy per Section 6.1 carveout. Please cross-reference with Sequoia's outside counsel comments.",
    receivedAt: 'Oct 24',
    unread: false,
    starred: false,
    vip: false,
    messageCount: 1,
    tags: [
      { label: 'Legal', tone: 'muted' },
      { label: 'Contract', tone: 'muted' }
    ],
    participants: [
      { name: 'Kavita Lamba', email: 'k.lamba@lw.com', initials: 'KL', org: 'Latham & Watkins' },
      ALEX
    ],
    messages: [
      {
        id: 'm5',
        from: { name: 'Kavita Lamba', email: 'k.lamba@lw.com', initials: 'KL', org: 'Latham & Watkins' },
        to: [ALEX],
        sentAt: 'Oct 24 at 18:31',
        body: [
          'Alex,',
          "Attached clean copy per Section 6.1 carveout. Please cross-reference with Sequoia's outside counsel comments before we circulate to the board.",
          'We can turn this around in 48 hours once you confirm the observer access window.'
        ],
        attachments: [
          { name: 'Observer_Agreement_Clean.docx', size: '318 KB', detail: 'DOCX · sin cambios', kind: 'file' }
        ],
        signature: { name: 'Kavita Lamba', role: 'Partner • Latham & Watkins LLP', place: 'New York, NY' }
      }
    ]
  }
]

export const BRIEF: readonly BriefPoint[] = [
  { title: 'Valuation intact:', text: 'Sequoia agreed to $78M pre-money cap without valuation haircut.' },
  { title: 'Pool conceded:', text: 'Option pool reduced from 12.0% to 10.5% in founder favor.' },
  { title: 'Tomorrow sync:', text: 'Requested 15m zoom call at 10:30 AM PT for final execution.' }
]

export const ACTION_ITEMS: readonly ActionItem[] = [
  { id: 'a1', title: 'Review clause 4.2 with counsel', due: 'Due today by 5:00 PM', urgent: true, done: false },
  { id: 'a2', title: 'Validate option pool cap table', due: 'CapTable_Model.xlsx', done: false }
]

export const DOSSIER = {
  person: ELENA,
  threadsInCommon: 4,
  responseRate: '98%',
  boards: 'Linear, Watershed, Harvey',
  lastInteraction: 'Saturday (Dinner Sync)',
  location: 'San Francisco, CA • Bay Area'
} as const

export const SLOTS: readonly Slot[] = [
  { start: '10:30 AM', end: '10:45 AM', status: 'requested' },
  { start: '02:00 PM', end: '02:30 PM', status: 'free' }
]

/** Texto sugerido por el copiloto para el compositor. */
export const COPILOT_DRAFT = `Hi Elena,

Thanks for sending over the revised terms yesterday evening.

Our outside legal team at Gunderson has finalized their line-by-line review of Section 4.2 (Board Approvals). We are comfortable with your proposed resolution and will execute the documentation right after our sync.

Tomorrow at 2:00 PM PST works perfectly for the founder call. I have held the slot and attached our executed addendum for your diligence archive.

Looking forward to speaking tomorrow,
Alex`
