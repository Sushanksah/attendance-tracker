# Attendance Tracker

A responsive React and Vite application for tracking student attendance.

## Features

- Supabase signup, login, password reset, and logout
- Add, edit, and delete subjects
- Overall attendance calculation
- Subject attendance status
- Classes required to reach a target
- Classes that can be missed while maintaining a target
- Attendance planner and what-if calculator
- Supabase Row Level Security for user-specific data

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Add the Supabase project URL and anon/public key to `.env`:

```text
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Run [supabase-schema.sql](./supabase-schema.sql) in the Supabase SQL Editor before testing database features.

## Validation

```bash
npm run lint
npm run build
```
