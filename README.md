# Arkion by arkqube

Arkion is a privacy-first, ephemeral real-time communication platform enabling temporary and anonymous messaging. Designed with a sleek, modern UI, it offers global chat rooms and secure private rooms without requiring user accounts or persisting permanent data.

## 🚀 Features

*   **Ephemeral Messaging:** Messages and files automatically expire and vanish after a set period (1 hour for Global, 12 hours for Private Rooms).
*   **Anonymous Identity:** No sign-ups required. Users are assigned an anonymous, editable identity tied to their current browser session.
*   **Real-time Communication:** Powered by WebSockets for lightning-fast, bi-directional message broadcasting.
*   **File Sharing:** Securely upload and share images, documents, and videos. Files are stored temporarily on Cloudinary.
*   **Private Rooms:** Create isolated rooms with a unique 5-character code and an optional 4-digit PIN for extra security.
*   **Responsive Modern UI:** Built with Tailwind CSS and shadcn/ui. Features a sliding mobile drawer and full Dark/Light mode support.

## 🏗️ Architecture

The Arkion application follows a decoupled client-server architecture:

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
*   **Key Responsibilities:** Authenticating persistent user sessions (via `sessionId`), managing chat room subscriptions (Pub/Sub pattern over WebSockets), handling REST API endpoints for file uploads (`multer` memory storage -> Cloudinary API), and proxying file downloads to prevent direct CDN exposure.

## 🛠️ Tech Stack Overview

*   **Frontend:** React, TypeScript, Vite, Tailwind CSS, shadcn/ui, Framer Motion, Lucide Icons.
*   **Backend:** Node.js, Express, `ws` (WebSockets), `ioredis` (Redis client), Cloudinary SDK, Multer.
*   **Infrastructure:** Upstash (Serverless Redis Database).

## ⚙️ Local Development Setup

To run Arkion locally, you will need concurrently running terminals for the Frontend and the Backend.

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
3.  Ensure your `src/types.ts` config points to the local backend:
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

To take Arkion live, you must deploy the Backend and Frontend to separate cloud hosting providers.

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
Before deploying the frontend, update `src/types.ts` to point to the newly deployed Render backend:
```typescript
export const DEFAULT_CONFIG = {
  wsUrl: 'wss://qubix-api.onrender.com/ws', // Note the 'wss://' for secure WebSockets
  apiUrl: 'https://qubix-api.onrender.com',
  // ...
};
```
Commit and push this change to GitHub.

### 3. Deploying the Frontend (Website)
The React/Vite app is a static site and can be hosted easily on platforms like [Vercel](https://vercel.com) or [Netlify](https://netlify.com).

1. Create a new Project on **Vercel**.
2. Connect your GitHub repository.
3. Vercel will auto-detect the **Vite** framework.
4. Leave the **Root Directory** empty (as `./` the root).
5. Click **Deploy**.

Vercel will provide a scalable, live web URL (e.g., `https://qubix-chat.vercel.app`). Your ephemeral chat platform is now live!
