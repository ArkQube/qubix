# Qubix

Qubix is a privacy-first, ephemeral real-time communication platform enabling temporary and anonymous messaging. Designed with a sleek, modern UI, it offers global chat rooms and secure private rooms without requiring user accounts or persisting permanent data.

## 🚀 Features

*   **Ephemeral Messaging:** Messages and files automatically expire and vanish after a set period (1 hour for Global, 12 hours for Private Rooms).
*   **Anonymous Identity:** No sign-ups required. Users are assigned an anonymous, editable identity tied to their current browser session.
*   **Real-time Communication:** Powered by WebSockets for lightning-fast, bi-directional message broadcasting.
*   **File Sharing:** Securely upload and share images, documents, and videos. Files are stored temporarily on Cloudinary with automatic image compression.
*   **Private Rooms:** Create isolated rooms with a unique 5-character code and an optional 4-digit PIN for extra security.
*   **Session Recovery:** Persistent `sessionId` allows seamless identity restoration across page reloads and mobile suspensions. A 2-minute server-side grace period preserves user identity during brief disconnects.
*   **Mobile-First Design:** Resilient WebSocket recovery handles Android/iOS file picker suspensions. Native RFC6455 server pings keep connections alive through load balancer idle timeouts.
*   **WhatsApp-Style Rendering:** Chat DOM uses `scrollIntoView` reverse-rendering, message arrays are memory-capped (last 50) for lag-free instant loads.
*   **Touch-Native UI:** React `isActive` touch-toggle overlays for message actions (Copy/Delete) replace broken desktop CSS `:hover` states on mobile.
*   **Advanced IP & Storage Defenses:** Built-in safeguards against abuse, spam, and Cloudinary quota exhaustion.
*   **Dark/Light Theme:** Toggle between themes with `next-themes`, persisting user preference across sessions.

## 🛡️ 3-Layer Storage & Abuse Defense System

To prevent malicious actors from exhausting the free-tier Cloudinary limit and crashing the Redis server, Qubix utilizes an automated self-healing defense pipeline:

1. **IP Abuse Throttling (The Firewall):** Express middleware actively monitors `POST /api/upload`. Uploads are strictly rate-limited (max 10 per minute per IP). Breaching this limit instantly triggers a 10-minute automated IP ban inside Redis, rejecting future requests with a `429 Too Many Requests`.
2. **Priority ZSET Indexing (The Map):** Every successful upload logs its `fileId` into one of two Redis Sorted Sets (`files:global` and `files:private`), using the upload timestamp as the score. This provides an instant chronological map of Cloudinary storage without expensive API queries.
3. **20GB Auto-Garbage Collector (The Cleaner):** A Node Cron job (`*/10 * * * *`) audits the live Cloudinary storage quota. If usage trips the 80% (20GB) redline, it triggers an emergency progressive cull:
    * Deletes Global Chat files older than 30 minutes.
    * If still > 20GB, deletes Global files older than 15 minutes.
    * If still > 20GB, deletes Private Room files older than 60 minutes.
    * Broadcasts a `file_deleted` WS event to visually wipe the destroyed files from connected clients' screens seamlessly.

## 📂 Project Structure

Qubix follows a decoupled Mono-repo structure where the React Client and Node.js WebSocket Engine co-exist.

```text
Qubix/
├── README.md                 # Project Documentation
├── package.json              # Frontend dependencies
├── vite.config.ts            # Vite bundler configuration
├── tailwind.config.ts        # UI System styling constraints
├── src/                      # 🎨 FRONTEND (React + Vite)
│   ├── App.tsx               # Main React entry point
│   ├── main.tsx              # React DOM mounting
│   ├── components/           # UI Components
│   │   ├── chat/             # Chat UI (ChatContainer, ChatMessage, ChatInput)
│   │   ├── rooms/            # Room Management UI (Create/Join rooms)
│   │   ├── settings/         # User Settings (Username, Theme)
│   │   └── ui/               # shadcn/ui primitives (Buttons, Inputs, Dialogs)
│   ├── contexts/
│   │   └── WebSocketContext.tsx # Central brain mapping WS events to React State
│   ├── hooks/                # Custom React Hooks
│   ├── lib/                  # Utilities (Tailwind merge, time formatters)
│   └── types/                # Shared TypeScript definitions
│
└── server/                   # ⚙️ BACKEND (Node.js + WebSockets)
    ├── package.json          # Backend dependencies
    ├── tsconfig.json         # Backend TS configuration
    └── src/
        ├── server.ts         # Main core Engine (Express + WS + Redis + Cloudinary + Cron)
        ├── types.ts          # Backend Type Definitions & TTL Constants
        └── utils.ts          # Backend Utilities (ID generators, Mime types)
```

## 🏗️ Architecture

The application follows a decoupled client-server architecture:

### Frontend (React + Vite + TypeScript)
The client-side application handles all user interactions, UI rendering, and WebSocket connections.
*   **Framework:** React 18, Vite (for fast HMR and optimized builds)
*   **Styling:** Tailwind CSS, framer-motion (animations), next-themes (light/dark mode)
*   **Components:** shadcn/ui (Radix UI primitives)
*   **State Management:** React Context API (`WebSocketContext.tsx`) for global connection and message state.
*   **Key Responsibilities:** Managing the WebSocket connection lifecycle, rendering the chat interface (messages, file previews, typing indicators), and handling the responsive layout logic.

### Backend (Node.js + Express + WebSocket)
A high-performance Node.js server acts as the central hub for all real-time messaging and file coordination.
*   **Core:** Express.js (HTTP endpoints), `ws` library (WebSocket server)
*   **Database (In-Memory Datastore):** Redis (via Upstash). Used exclusively to store temporary messages and room metadata. **Crucially, Redis handles the automatic TTL (Time-To-Live) expiration of data.**
*   **File CDN:** Cloudinary. Used to temporarily host uploaded files.
*   **Key Responsibilities:** Authenticating persistent user sessions (via `sessionId`), managing chat room subscriptions (Pub/Sub pattern over WebSockets), handling REST API endpoints for file uploads (`multer` memory storage -> Cloudinary API), proxying file downloads to prevent direct CDN exposure, and aggressively defending storage quotas via Node-Cron.

### Mobile WebSocket Resilience
On Android/iOS, opening the native file picker suspends the browser's JavaScript execution and can kill TCP connections. Qubix handles this with a multi-layered recovery system:
*   **Server-side RFC6455 Pings (20s interval):** Native WebSocket ping frames keep connections alive through Render's load balancer, even when client JS is frozen.
*   **2-Minute Grace Period:** On disconnect, user identity is preserved in memory for 2 minutes, allowing seamless session recovery via `sessionId`.
*   **Silent Reconnect (`suppressDisconnectUI`):** When the file picker is active, socket drops are handled silently — the user never sees "Connection Lost".
*   **PIN Caching:** When in a PIN-protected room, the client caches the PIN in memory to seamlessly rejoin after reconnection.

## ⚙️ Local Development Setup

To run Qubix locally, you will need concurrently running terminals for the Frontend and the Backend.

### Prerequisites
*   Node.js (v18+ recommended)
*   An Upstash Redis Database (Free Tier)
*   A Cloudinary Account (Free Tier)

### 1. Backend Setup

1.  Navigate to the server directory:
    ```bash
    cd server
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file in the `server` directory and add your credentials:
    ```env
    # Redis Configuration (Upstash)
    REDIS_HOST=your-upstash-redis-url.upstash.io
    REDIS_PORT=your-upstash-port
    REDIS_PASSWORD=your-upstash-password
    REDIS_TLS=true

    # Cloudinary Configuration
    CLOUDINARY_CLOUD_NAME=your-cloud-name
    CLOUDINARY_API_KEY=your-api-key
    CLOUDINARY_API_SECRET=your-api-secret
    ```
4.  Start the backend development server:
    ```bash
    npm run dev
    ```
   *(The backend server typically runs on `http://localhost:3000`)*

### 2. Frontend Setup

1.  Open a new terminal and navigate to the project root:
    ```bash
    cd <project-root>
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Ensure your `src/types/index.ts` config points to the local backend:
    ```typescript
    export const DEFAULT_CONFIG = {
      wsUrl: 'ws://localhost:3000/ws',
      apiUrl: 'http://localhost:3000',
      // ...
    };
    ```
4.  Start the frontend Vite server:
    ```bash
    npm run dev
    ```
   *(The frontend typically runs on `http://localhost:5173`)*

## 🌐 Deployment Workflow

To take Qubix live, you must deploy the Backend and Frontend to separate cloud hosting providers.

### Why not deploy everything on Vercel?
WebSockets require a **persistent TCP connection** and a **long-running server**. Vercel runs Serverless Functions, which spin up, execute a task, and instantly terminate. If you deploy a WebSocket server on Vercel, the connection immediately closes.
Thus, we must host the Backend Engine on a persistent platform (like **Render** or **Railway**) and host the Static UI Frontend on a CDN (like **Vercel**).

### 1. Deploying the Backend (Engine)
Because the backend relies on persistent WebSocket connections, a platform like [Render.com](https://render.com) is recommended.

1. Push your code to a GitHub repository (Ensure your `server/.env` is ignored!).
2. Create a new "Web Service" on **Render**.
3. Connect your GitHub repository.
4. Set the **Root Directory** to `server`.
5. Set **Build Command** to `npm install && npm run build`.
6. Set **Start Command** to `npm start`.
7. Go to the "Environment" tab and add all the variables from your local `.env` file (Redis and Cloudinary keys).
8. Deploy. Render will provide a live URL (e.g., `https://qubix-api.onrender.com`).

### 2. Connecting Frontend to the Live Backend
Before deploying the frontend, update `src/types/index.ts` to point to the newly deployed Render backend:
```typescript
export const DEFAULT_CONFIG = {
  wsUrl: 'wss://qubix-api.onrender.com/ws', // Note the 'wss://' for secure WebSockets
  apiUrl: 'https://qubix-api.onrender.com',
  // ...
};
```
Commit and push this change to GitHub.

### 3. Deploying the Frontend (Website)
The React/Vite app is a static site and can be hosted easily on platforms like [Vercel](https://vercel.com).

1. Create a new Project on **Vercel**.
2. Connect your GitHub repository.
3. Vercel will auto-detect the **Vite** framework.
4. Leave the **Root Directory** empty (as `./` the root).
5. Click **Deploy**.

Vercel will provide a scalable, live web URL (e.g., `https://arkion.vercel.app`). Your ephemeral chat platform is now globally scalable and production-ready!

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
