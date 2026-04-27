# Apartment Management Web App

Full-stack real-time apartment management platform with role-based permissions:

- Admin creates apartment and gets a unique join code
- Residents join from separate devices with the same code
- Admin sends resident-specific bills and personal messages
- Residents view only their own bills/messages and mark bills as paid
- Live updates are delivered through Socket.io

## Tech Stack

- Frontend: React + Vite + Tailwind CSS
- Backend: Node.js + Express + Socket.io
- Database: SQLite (better-sqlite3, local file)
- IDs: UUIDs for apartment, users, bills, and messages

## Project Structure

- `backend/` Express API, Socket.io, SQLite data layer
- `frontend/` React dashboard app

## Run Locally

1. Configure backend env:
   - `backend/.env` from `backend/.env.example`
2. Configure frontend env:
   - `frontend/.env` from `frontend/.env.example`
3. Install and run backend:
   - `cd backend`
   - `npm install`
   - `npm run dev`
4. Install and run frontend:
   - `cd frontend`
   - `npm install`
   - `npm run dev -- --host 0.0.0.0 --port 5173`

Backend default URL: `http://localhost:4000`

Frontend default URL: `http://localhost:5173`

## Multi-Device Usage

1. Open frontend on admin device.
2. Admin creates apartment and receives join code.
3. Share join code with residents.
4. Residents open frontend on their own devices and join.
5. All parties see real-time updates from the same backend state.

For LAN access, allow both localhost and LAN frontend origins in backend `FRONTEND_URL`, for example:

`FRONTEND_URL=http://localhost:5173,http://192.168.1.10:5173`

## Security and Consistency

- All writes pass through backend APIs
- Role checks enforce admin-only billing and messaging
- Resident queries are filtered by authenticated resident ID
- `mark-paid` uses a conditional update to avoid duplicate state transitions
- SQLite indexes and UUID primary keys reduce collisions/conflicts
