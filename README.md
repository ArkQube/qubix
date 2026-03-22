# AQchat

AQchat (formerly Qubix) is a privacy-first, ephemeral real-time communication platform enabling temporary and anonymous messaging. Designed with a sleek, modern, glassmorphic UI, it offers global chat rooms and secure private rooms without requiring user accounts or persisting permanent data.

## 🚀 Features

*   **Ephemeral Messaging:** Messages and files automatically expire and vanish after a set period (1 hour for Global, 12 hours for Private Rooms).
*   **Anonymous Identity:** No sign-ups required. Users are assigned an anonymous, editable identity tied to their current browser session.
*   **Real-time Communication:** Powered by WebSockets for lightning-fast, bi-directional message broadcasting.
*   **Markdown & Code Snippets 💻:** Send rich-text messages and VS-Code-style syntax-highlighted code blocks perfectly wrapped in ` ``` ` backticks.
*   **Quick Voice Notes 🎙️:** Instantly record and strictly stream audio snippets utilizing the browser `MediaRecorder` API directly into the chat feed.
*   **Emoji Reactions 👍:** Hover over any message to react with emojis (🔥, 😂, ❤️) that sync in real-time across all connected clients.
*   **File Sharing & Compression:** Securely upload and share images, documents, and videos with a resilient, direct-to-Cloudinary upload pipeline featuring instant local previews. Users can toggle **Image Compression** in their settings to save bandwidth.
*   **Private Rooms:** Create isolated rooms with a unique 5-character code and an optional 4-digit PIN for extra security.
*   **Session Recovery:** Persistent `sessionId` allows seamless identity restoration across page reloads and mobile suspensions. A 2-minute server-side grace period preserves user identity during brief disconnects.
*   **Mobile-First Design:** Resilient WebSocket recovery handles Android/iOS file picker suspensions safely. Native RFC6455 server pings keep connections alive through cloud-provider load balancers.
*   **Advanced IP & Storage Defenses:** Built-in backend safeguards monitor Cloudinary usage with Node-Cron and progressively cull expired files to fiercely protect free-tier quotas.
*   **Dark/Light Theme:** Toggle between themes, seamlessly persisting user preference via `next-themes`.

## 📂 Detailed Project Structure

AQchat operates on a decoupled Mono-repo architecture, completely separating the React Frontend client from the Node.js WebSocket engine.

```text
AQchat/
├── README.md                 # Core project documentation and architecture overview
├── package.json              # Frontend workspace scripts and dependencies
├── vite.config.ts            # Vite bundler, PWA, and build optimization configs
├── tailwind.config.ts        # UI System styling components, constraints, and animations
├── postcss.config.js         # CSS transformation and autoprefixing
├── src/                      # 🎨 FRONTEND (React + Vite)
│   ├── App.tsx               # Main React Router & global view orchestrator
│   ├── main.tsx              # React DOM mounting & Theme/WS Provider injections
│   ├── index.css             # Global stylesheet (Tailwind imports & custom root variables)
│   ├── components/           # UI Component Library
│   │   ├── chat/             # Chat UI specific components
│   │   │   ├── ChatContainer.tsx # Core Chat orchestrator (handles layout and event routing)
│   │   │   ├── ChatInput.tsx     # Message input box, Markdown sender, and Voice Note MediaRecorder
│   │   │   ├── ChatMessage.tsx   # Individual messages, reaction pills, Markdown Renderer
│   │   │   └── MessageList.tsx   # Scrolling message feed, reverse-rendering logic
│   │   ├── rooms/            # Room Management Modals
│   │   │   ├── CreateRoom.tsx    # UI for creating secure Private Rooms with optional PINs
│   │   │   └── JoinRoom.tsx      # Logic to connect & authenticate into Private Rooms
│   │   ├── settings/         # App Utilities
│   │   │   └── SettingsModal.tsx # Editable user info, Theme picking, and Image Compression controls
│   │   └── ui/               # Reusable primitive elements (shadcn/ui inspired)
│   │       ├── button.tsx, dialog.tsx, input.tsx, label.tsx, switch.tsx, ...
│   ├── contexts/             # Global React State Providers
│   │   └── WebSocketContext.tsx  # Central brain! Connects WS client to Node server, maps Reducers
│   ├── hooks/                # Custom utility hooks
│   │   ├── use-debounce.ts       # Performance hook for typing indicators
│   │   ├── use-mobile.tsx        # Responsive layout hook handling media queries
│   │   └── useImageCompression.ts# Canvas-based utility to aggressively compress JPEG/PNG/WebP 
│   ├── lib/                  # Shared Business Logic
│   │   └── utils.ts              # Tailwind `cn` merger, random ID generators, Markdown parser
│   └── types/                # Typescript Definitions
│       └── index.ts              # Global definitions (Message, User, Room, `DEFAULT_CONFIG`)
│
└── server/                   # ⚙️ BACKEND (Node.js + WebSockets + Redis)
    ├── package.json          # Backend runtime scripts (Express, socket, upstash, cron)
    ├── tsconfig.json         # Strict TypeScript backend configuration
    ├── .env                  # Secrets vault (Redis connection, Cloudinary Keys)
    └── src/
        ├── server.ts         # Main core Engine. Orchestrates HTTP routes, Cloudinary signing, 
        │                     # IP throttling, Cron Auto-Cleaner, and the WebSocket PubSub logic.
        ├── types.ts          # Backend definitions (WS_MESSAGE_TYPES, System configs)
        └── utils.ts          # Backend Utilities (UUID generation, File validation, Rate limits)
```

## 🏗️ Architecture

### Frontend (React + Vite + TypeScript)
The client handles all interactions, UI rendering, layout animations, and WebSocket recovery.
*   **Framework:** React 18, Vite
*   **Styling:** Tailwind CSS, `framer-motion`
*   **Message Rendering:** `react-markdown` and `react-syntax-highlighter`
*   **State Management:** React Context API (`WebSocketContext.tsx`) for global messaging synchrony.

### Backend (Node.js + Express + WebSocket)
A high-performance Node.js server acts as the dispatch hub for ephemeral routing.
*   **Core:** Express.js (HTTP API), `ws` library (WebSocket Engine)
*   **Database (In-Memory Datastore):** Redis. Used exclusively to map and expire temporary messages, typing states, and emoji reactions using native Redis TTLs.
*   **File Storage:** Cloudinary CDN is utilized securely via server presigned-URL issuance to keep heavy bandwidth off the WebSocket pipe.

## ⚙️ Local Development Setup

Thanks to the dynamic environment config, testing AQchat locally is frictionless. **You DO NOT need to change any hardcoded URLs.** Vite automatically detects `npm run dev` and instructs the frontend to connect securely to your local backend at `localhost:3001`.

### Prerequisites
*   Node.js (v18+ recommended)
*   An Upstash Redis Database URL
*   A Cloudinary Account (Cloud Name, API Key, API Secret)

### 1. Backend Setup
Navigate to the server directory, install dependencies, and run:
```bash
cd server
npm install
```
Create a `.env` in the `server` directory and add your keys:
```env
REDIS_HOST=your-upstash-redis-url.upstash.io
REDIS_PORT=your-upstash-port
REDIS_PASSWORD=your-upstash-password
REDIS_TLS=true

CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```
Start the backend development server:
```bash
npm run build
npm start
# Server listens on http://localhost:3001
```

### 2. Frontend Setup
Open a new terminal and navigate to the project root:
```bash
npm install
npm run dev
# Frontend listens on http://localhost:5173
```
That's it! Any messages, reactions, or voice notes you perform will seamlessly funnel locally between the two terminal windows. 

## 🌐 Deployment Workflow

### 1. Deploying the Backend (Engine)
Because the backend relies on persistent WebSocket connections, a platform like [Render.com](https://render.com) or Railway is strictly required over Serverless (Vercel).
1. Connect your repo to Render ("Web Service").
2. Root Directory: `server`.
3. Build Command: `npm install && npm run build`.
4. Start Command: `npm start`.
5. Add all `.env` secrets into the Render Dashboard.
6. Deploy! Render will print a URL `https://your-api.onrender.com`.

### 2. Connecting Frontend to Production
If you deploy the Backend to a custom domain (e.g. `your-api.onrender.com`), make sure `src/types/index.ts` points to it for production builds:
```typescript
export const DEFAULT_CONFIG = {
  wsUrl: import.meta.env.DEV ? 'ws://localhost:3001/ws' : 'wss://your-api.onrender.com/ws',
  apiUrl: import.meta.env.DEV ? 'http://localhost:3001' : 'https://your-api.onrender.com',
};
```

### 3. Deploying the Frontend (UI)
The React/Vite app is a highly-cacheable static site perfect for [Vercel](https://vercel.com) or Netlify.
1. Create a new Project on Vercel and link your Repo.
2. Root Directory: `./` (Empty).
3. Vercel automatically detects Vite and executes `npm run build`.
4. Deploy!

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).
