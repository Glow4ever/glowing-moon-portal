# Glowing Moon Media — Client Portal

A branded client portal built with React + Vite + Supabase.

---

## Supabase Setup (do this BEFORE deploying)

### 1. Run this SQL in your Supabase SQL Editor

Go to: https://supabase.com/dashboard/project/sqakattqftlmstsbxgxw/sql

Paste and run:

```sql
-- Calendar events table
create table if not exists calendar_events (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  date date not null,
  type text default 'photo' check (type in ('photo','video','deadline','social')),
  notes text,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table calendar_events enable row level security;

-- Allow authenticated users full access
create policy "auth_all" on calendar_events
  for all using (auth.role() = 'authenticated');
```

### 2. Create the Storage Bucket

Go to: https://supabase.com/dashboard/project/sqakattqftlmstsbxgxw/storage/buckets

- Click "New bucket"
- Name it exactly: `portal-assets`
- Check "Public bucket" → Save

### 3. Create your first user (client login)

Go to: https://supabase.com/dashboard/project/sqakattqftlmstsbxgxw/auth/users

- Click "Invite user" or "Add user"
- Enter the client's email and a password
- They can log in at your deployed URL

---

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:5173

---

## Deploy to Vercel

1. Push this project to a GitHub repo
2. In Vercel: Import that repo
3. Add these Environment Variables in Vercel project settings:
   - `VITE_SUPABASE_URL` = `https://sqakattqftlmstsbxgxw.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your anon key
4. Deploy — done!

---

## Features

- 🔐 Email/password authentication via Supabase Auth
- 📁 Asset Library — folder-based file storage with upload & download
- 🖼 Content Library — quarterly photo/video organizer with lightbox viewer
- 📅 Calendar — add, edit, delete events with color-coded types
- 🏷 Uploadable logo in the topbar
- 🎨 Glowing Moon Media branding (black + gold) 
