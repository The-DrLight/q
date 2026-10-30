# Product Requirements Document (PRD)
**Product:** Q (Zero-Install Virtual Queuing Engine)  
**Document Status:** Final Draft  
**Version:** 1.1  
**Target Platform:** Mobile Web (PWA-Ready) & Desktop Operator Console  

---

## 1. Executive Summary & Core Objective
Q is a high-efficiency, zero-download queuing engine designed to eliminate dense physical crowds at service locations such as government registries, campus administrative halls, medical laboratories, and high-volume customer service desks.

Visitors scan an on-site QR code to secure a verified sequential position, track their live numerical standing in a lightweight browser view, and receive automated Web Push alerts when entering the dynamic physical on-deck buffer. Desk operators authenticate via email to process a unified line from a shared hopper, maintaining high throughput and resolving absent visitors through an automated strike and penalty system. Queue instances operate on a rolling 24-hour expiration window rather than arbitrary midnight cutoffs.

---

## 2. Core Operational Mechanics & Staging Philosophy

### 2.1 The Staging Buffer Concept
A digital queue without an active physical buffer causes clerk idle time due to transit latency. Q dynamically scales the physical staging buffer based on active operators using the formula:  
$$\text{Buffer Size} = (\text{Active Operators} \times 3) + 2$$  
*(e.g., 1 operator = 5, 2 operators = 8, 3 operators = 11)*:

- **Position 1:** Currently active ticket being attended to at the counter.
- **Positions 2 through Buffer Size ($N$):** Physical On-Deck Zone. Visitors within this dynamic numerical threshold must proceed to the physical line immediately before the desks.
- **Position ($N + 1$) and above:** Free range. Visitors can wait anywhere off-premise or attend to secondary tasks.

### 2.2 Alert Triggers
- **Push Notification Event:** Dispatched automatically when an individual crosses into the active buffer threshold ($\le \text{Buffer Size}$).
- **Notification Copy:** `"You are now entering the physical staging zone. Please proceed to the physical line immediately."`
- **In-Browser Tracking View:** Stripped of abstract labels. The interface displays only the raw current position (e.g., `"#4"`) and the remaining count ahead (e.g., `"3 people ahead of you"`).

### 2.3 The Absence, Penalty, and Strike Engine
When Position 1 is called and the visitor is not present at the counter:
1. The operator clicks the **"Absent"** button.
2. The user receives 1 Strike.
3. **If total strikes < 3:** The ticket is automatically reassigned to Position $N+1$ (immediately behind the dynamic physical staging zone).
4. **If total strikes = 3:** The ticket status transitions to `REVOKED`, permanently purging them from the active queue.
5. All intermediate positions shift forward instantly; the former Position 2 becomes the new Position 1.

---

## 3. Multi-Operator Shared Hopper Model

### 3.1 Single Queue, Multiple Desks
Multiple authenticated officials serve a single common queue line:
- Officials log into their operator console using email authentication.
- Desks operate in parallel from a shared FIFO hopper.
- *Example:* Clerk A attends to Position 1 while Clerk B attends to Position 2 simultaneously.
- **Concurrency Locking:** When an operator claims or marks an action on a ticket, atomic row-level database locks prevent collision or double-processing.
- **Completion:** As each clerk finishes and clicks "Done", that respective ticket is archived as `COMPLETED`, and the entire queue shifts forward in real time.

### 3.2 Queue Creation & Access Hierarchy
- **Zero Friction Creation:** No organizational profiles or corporate registration required. The landing page features a direct "Create Queue" action requiring only a Queue Name.
- **Queue Ownership:** The creator retains irrevocable queue ownership and administrative rights to manage or delete the queue instance.
- **Operator Invitations:** Operators can be invited via email during creation (optional) or added/removed at any point later by the owner.
- **State Distinction:** The system strictly distinguishes between Granted Access (whitelisted operator permitted to log in) and Active Session (operator currently online and pulling from the hopper, used to compute dynamic buffer sizing).

---

## 4. User Personas

### Demola, The Bureaucratic Hostage (End User)
- **Context:** Standing outside a crowded hall with urgent academic or personal commitments nearby; using a smartphone with fluctuating mobile connectivity; will not install native apps or create complex accounts.
- **Key Needs:** Instant QR onboarding; zero-friction numerical tracking; timely notifications that provide enough runway to walk back.

### Official Funke, The Desk Operator (Internal User)
- **Context:** Stationed at an intake counter facing hundreds of agitated individuals; requires high speed and low cognitive load.
- **Key Needs:** Minimal screen interactions; single-tap status transitions; automatic re-ordering when people fail to appear.

---

## 5. Functional Specifications

### 5.1 End-User Client Flow (Browser Web App)

#### Onboarding & Registration
- **QR Scan:** Points to a unique venue endpoint: `https://q.engine/join?venue_id=XYZ`.
- **Permissions Prompt:** Lightweight browser prompt requesting Web Push Notification permission. If denied, client defaults to in-tab audio/visual updates.
- **Input Fields:**
  - Full Name (Required, string, max 50 chars).
  - Phone Number (Optional, tel format).
- **Single Active Queue Policy & Session Persistence:**
  - Client generates a cryptographic UUID stored in `localStorage` and `IndexedDB`.
  - **Strict Single Active Queue Policy:** Server enforces exactly one active ticket across all queues per client token to eliminate ghost bookings. Visitors must voluntarily cancel an existing ticket before joining a new queue.
  - Navigating away, reloading, or re-scanning the QR code returns directly to the active live ticket screen.
- **Offline & Flaky Network Resilience:** Real-time connection status banner with visual network badge. Users are never dropped due to connectivity loss; the client tab automatically reconciles state on reconnect.

#### Live Numerical Tracking
Clean, minimalist interface displaying:
- **Current Dynamic Position:** Prominent sequential number (e.g., `"#12"`).
- **Ahead Count:** Contextual counter (e.g., `"11 people ahead of you"`).
- **Strike Counter:** Indicates accumulated absence strikes (e.g., `"Strikes: 1/3"`).
- **Anti-Spoofing Visual Verification:** Dynamic SVG pulsing animations and live digital clock with ticking seconds. Desks strictly require an active, live browser tab; static screenshots or screen recordings are explicitly invalid.
- **Cancel Action:** Allows the visitor to voluntarily relinquish their spot.

### 5.2 Operator Console (Authenticated Web Portal)

#### Authentication & Authorization
- Landing page provides direct queue creation without organizational profiles; operators authenticate via magic link or standard credentials.
- Owner Console allows inviting/revoking operator email access at any time, tracking whitelist permissions (Granted Access) versus currently online clerks (Active Session).

#### Desk Operator Controls
- **Done:** Marks the current ticket as `COMPLETED`, frees the clerk, and shifts the line forward.
- **Absent:** Registers a strike against the current ticket. If strikes < 3, shifts the ticket to Position $N+1$; if strikes = 3, revokes the ticket.
- **Revoke:** Manually invalidates an abusive or fraudulent ticket immediately.
- **Close Queue:** Freezes new registrations while allowing active tickets to be processed to completion.

### 5.3 Public Lobby Display Mode
- **Route & Access:** Dedicated read-only endpoint (e.g., `/display/:queueId`) intended for lobby TV screens and monitors without requiring authentication.
- **Typography & UI:** High-contrast, large-format typography showing real-time desk counter assignments (e.g., `"Desk 1: #42"`, `"Counter B: #43"`).
- **Auditory Cues:** Plays an unobtrusive browser audio chime whenever state transitions occur or a new ticket is called to a desk.

---

## 6. Technical Architecture & Data Model

### 6.1 Event Flow & Network Optimization
- **Downlink Updates:** Server-Sent Events (SSE) or Lightweight WebSockets.
- **Action-Triggered Broadcast:** The server recalculates and broadcasts queue updates only when an operator action occurs (`Done`, `Absent`, `Revoke`). No background polling waste.
- **Foreground Sync:** When a sleeping mobile browser tab returns to focus, it triggers an immediate lightweight GET check to ensure ground-truth synchronization.
- **Zero Cost Notification Delivery:** Relies exclusively on Web Push API (Service Worker layer) with zero SMS/WhatsApp gateway overhead.
- **Strict Anti-Spoofing Protocol:** Live animated SVG canvas and real-time clock rendering enforce physical intake validation exclusively via live interactive client tabs.

### 6.2 Relational Database Schema (PostgreSQL Reference)

```sql
-- Queue Instances
CREATE TABLE queues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id VARCHAR(50) NOT NULL,
    title VARCHAR(100) NOT NULL,
    status VARCHAR(20) DEFAULT 'OPEN', -- OPEN, PAUSED, CLOSED
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Operator Accounts
CREATE TABLE operators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    queue_id UUID REFERENCES queues(id),
    counter_name VARCHAR(50) DEFAULT 'Counter 1',
    role VARCHAR(20) DEFAULT 'CLERK'
);

-- Ticket Ledger
CREATE TABLE tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_id UUID REFERENCES queues(id),
    ticket_number INT NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    client_uuid VARCHAR(64) NOT NULL,
    sort_order NUMERIC(12, 4) NOT NULL,
    status VARCHAR(20) DEFAULT 'WAITING', -- WAITING, SERVING, COMPLETED, REVOKED
    strikes INT DEFAULT 0,
    serving_operator_id UUID REFERENCES operators(id),
    push_subscription JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

*Note on Re-indexing:* Bumping an absent ticket behind the dynamic buffer utilizes fractional indexing on `sort_order` (`(sort_order_N + sort_order_N+1) / 2`) to avoid table-wide write locks.

---

## 7. Future Scope (V2 Roadmap)
- **Licensing & Open-Source Governance:** Distributed publicly under an MIT License as a free non-commercial community tool maintained in a maintainer-controlled repository.
- **Multi-Category Queue Routing:** Automated ticket sorting into specialized queues based on service intake classification.
- **Kiosk & Physical Display Integration:** Synchronized large-format screen display for waiting lobbies.
