# Cloud-PDF-Editor
Cloud-Based PDF Editor (Local-First)
What is this?

This project is a simple PDF editor that runs in your browser.

Even though it’s web-based, the goal is not to send your files to a server.
All PDF viewing and editing happens on your own device.

Think of it as:

A desktop-style PDF editor

Built with web technologies

That works offline

And does not force updates or subscriptions

What problems does it solve?

You shouldn’t need to upload sensitive PDFs just to edit them

You shouldn’t be forced into subscriptions or cloud lock-in

You shouldn’t lose access to your files when you’re offline

You shouldn’t have updates pushed onto you without consent

This project focuses on control, privacy, and long-term stability.

Core principles

Local-first
PDFs never leave your device unless you choose to export them.

Offline-capable
Once loaded, the app works without internet access.

Browser-based
Runs in Chrome / Chromium-based browsers (and as an installable web app).

Perpetual license mindset
No forced updates. Old versions continue to work.

Explicit saving
No silent auto-saves. You decide when and where to save.

What can it do (initial scope)?

The first versions will focus on basics:

Open a PDF

View pages

Reorder pages

Merge PDFs

Add images to pages

Export the result as a new PDF

More advanced features can come later.

What it will not do

No server-side PDF processing

No mandatory accounts

No background uploads

No hidden analytics

No native OS dependencies

How does it work (high level)?

The app runs in a browser window

PDF rendering and editing are done using browser-safe technologies

Files are handled using modern browser file APIs

Optional offline support is provided using browser storage

Project status

🚧 Early development

This repository is the starting point for a clean, fresh implementation.
Expect things to change as the foundation is built.

Long-term vision

A lightweight, dependable PDF editor that:

Still works years from now

Doesn’t break when a service shuts down

Respects user ownership of their files

Testing notes

Some offline behaviors require manual verification:

- App loads without network after first load (service worker cache).
- No network calls occur while offline.
- "Restore last session" loads the saved PDF when offline.
- Exported PDF opens correctly and matches the preview.
