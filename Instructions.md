Cloud PDF Editor — Authoritative Development Instructions
Purpose of This Document

This file is the single source of truth for developing the Cloud PDF Editor.

All contributors, tools, and automated agents (including Codex) must follow this document exactly.
If there is a conflict between this file and any other file, this file wins.

No refactors.
No architectural rewrites.
No speculative features.

Core Product Definition (Non-Negotiable)

This project is a local-first PDF editor that runs entirely in the browser.

PDFs must never be uploaded to a server

All processing must occur on the user’s device

The app must work offline after initial load

No subscriptions

No forced updates

No background uploads

No hidden analytics

No mandatory accounts

This is not a SaaS PDF processor.
It is a desktop-style tool built with web technologies.

Design Constraints (Hard Rules)

These rules are absolute:

No backend PDF processing

No server-side rendering

No server-side manipulation

No cloud compute for PDFs

Browser-only execution

Use browser-safe APIs only

No native OS bindings

No Electron dependency unless explicitly approved later

Explicit user control

No silent autosave

No background sync

No telemetry

Perpetual version mindset

Old builds must continue to function

Avoid breaking API or storage changes

Backward compatibility matters more than new features

Technology Baseline

Codex must adhere to the following baseline unless instructed otherwise:

Frontend: Plain HTML + CSS + TypeScript (or JavaScript if TS slows progress)

PDF Rendering: Browser-safe PDF libraries only (e.g., PDF.js)

PDF Manipulation: Client-side libraries only (e.g., pdf-lib or equivalent)

State Management: In-memory + browser storage (IndexedDB or File System Access API)

Offline Support: Service Worker (minimal, cache-first)

Build Tooling: Minimal (Vite or equivalent)

Testing: Required at every stage (see Testing Rules)

No framework lock-in unless necessary.

Development Phases (Must Be Followed in Order)
Phase 0 — Foundation Setup

Goal: Establish a clean, testable base.

Tasks:

Initialize project structure

Set up build tooling

Configure linting (basic)

Configure test runner

Implement empty app shell

Requirements:

App loads in browser

Blank UI renders

Tests run successfully

Tests required:

App bootstraps without errors

Test runner executes at least one passing test

Phase 1 — PDF Loading & Viewing

Goal: Open and render PDFs locally.

Tasks:

Load PDF via file picker

Render pages in viewer

Basic navigation (next / previous page)

Rules:

File must remain local

No upload logic anywhere

Tests required:

Load valid PDF

Reject non-PDF files

Render page count correctly

Viewer does not crash on large PDFs

Phase 2 — Page Reordering

Goal: Allow reordering pages safely.

Tasks:

UI to rearrange pages

Apply order change in memory

Reflect changes in preview

Rules:

Original file must remain untouched

Changes exist only in app state until export

Tests required:

Page order updates correctly

Page count remains consistent

Reordering does not corrupt content

Phase 3 — PDF Merging

Goal: Merge multiple PDFs into one.

Tasks:

Accept multiple PDF inputs

Combine pages sequentially

Display merged preview

Rules:

No background file access

Explicit user action required

Tests required:

Merge two PDFs

Merge PDFs with different page sizes

Output page order is correct

Phase 4 — Image Insertion

Goal: Add images to PDF pages.

Tasks:

Insert image onto selected page

Allow basic positioning

Render image in preview

Rules:

Images processed locally

No external image fetching

Tests required:

Insert PNG/JPEG

Image appears in exported PDF

Image positioning persists

Phase 5 — Exporting PDFs

Goal: Export edited result as a new file.

Tasks:

Generate new PDF file

Trigger download or save dialog

Rules:

Never overwrite original file automatically

User must explicitly save

Tests required:

Exported PDF opens correctly

Content matches preview

Export works offline

Phase 6 — Offline Capability

Goal: App works without internet after first load.

Tasks:

Add service worker

Cache static assets

Ensure app loads offline

Rules:

No aggressive caching

Avoid stale cache bugs

Tests required:

App loads offline

Previously opened PDFs still load from local state

No network calls during offline usage

Testing Rules (Mandatory)

Testing is not optional.

For every phase:

Unit tests must be written before or alongside implementation

Tests must run locally

Failing tests block progress to the next phase

Minimum testing coverage:

File handling

PDF integrity

UI stability

Offline behavior

Error handling

If a feature cannot be reasonably tested, it must be documented with justification.

Error Handling Rules

Fail visibly, not silently

Show user-friendly error messages

Never corrupt files

Never auto-retry destructive actions

What Not to Build (Explicitly Forbidden)

Do NOT implement:

User accounts

Cloud sync

Analytics

Telemetry

Background uploads

AI features

Subscription logic

Forced update checks

Contribution Discipline

Small, incremental commits

One feature per change

Tests included with each change

No large refactors without explicit approval

Final Authority Clause

This document defines:

Scope

Architecture

Philosophy

Development order

If Codex or any contributor deviates from this file, the implementation is considered incorrect.

Build slow.
Build stable.
Build something that still works years from now.