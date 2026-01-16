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


-------------------------
Drag & Drop Image Placement (Authoritative)
Objective

Upgrade image insertion UX from manual page/X/Y input to drag-and-drop placement on the PDF, while keeping the existing PDF export pipeline unchanged.

This task must not modify how PDFs are exported or processed internally.
It only changes how image placement is collected from the user.

Hard Constraints (Do Not Violate)

Do NOT change PDF merge logic

Do NOT change export logic

Do NOT modify original PDF bytes

Do NOT add backend or network calls

Do NOT require manual coordinate entry

All placement must remain local-first

Image insertion must still use pdf-lib on export

Functional Requirements

Image Upload → Asset Pane

When an image (PNG/JPEG) is uploaded:

Store it as an in-memory image asset

Display it in a left/right side pane (“Image Assets”)

Make the asset draggable

Image is NOT added to the PDF yet

PDF Page Overlay

Each rendered PDF page must have:

A positioned overlay layer above the canvas

Overlay must accept drag-and-drop

Overlay must map screen coordinates → page-relative coordinates

Drag & Drop Placement

User can drag an image from the asset pane

Drop it anywhere on a page overlay

On drop:

Create an image annotation object

Associate it with the correct page

Render the image visibly on the overlay

Image Adjustment

Placed images must be:

Movable (drag within the page)

Resizable (basic corner handles acceptable)

All adjustments update annotation state only

Export Behavior (Unchanged)

On export:

Convert annotation coordinates to PDF coordinates

Embed images using existing pdf-lib logic

Generate a new PDF file

Original PDF must remain untouched

Data Model (Must Use or Equivalent)
ImageAsset {
  id: string
  name: string
  imageData: Uint8Array | Blob
  naturalWidth: number
  naturalHeight: number
}

ImageAnnotation {
  id: string
  assetId: string
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
}

Coordinate Rules (Critical)

Overlay coordinates are top-left origin

PDF coordinates are bottom-left origin

Conversion must happen only at export time

Y-axis must be inverted correctly:

pdfY = pageHeight - overlayY - overlayHeight


Centralize coordinate conversion logic in pdfService.js.

File Responsibilities

app.js

Asset pane UI

Drag source logic

Overlay drop handling

Annotation state management

Overlay rendering of images

pdfService.js

Embed images into PDF using annotation data

Coordinate conversion

Export logic (existing logic reused)

storage.js

No required changes (optional persistence only)

sw.js / main.js

No changes allowed

Tests (Mandatory)

Add or update tests to cover:

Drag-and-drop creates an image annotation

Annotation is associated with the correct page

Exported PDF contains the image

Image position in exported PDF matches preview

Works offline

Original PDF bytes remain unchanged

Failing tests block completion.

Explicitly Out of Scope

Text insertion

Signature input

OCR

Editing existing PDF text

Auto-detecting form fields

Completion Criteria

This task is complete only when:

User can visually place images by dragging

No manual coordinates are required

Export output matches on-screen placement

All tests pass

No regressions to merge, export, or offline behavior

Final Reminder

This change only improves UX.
The underlying PDF pipeline must remain stable and unchanged.

Do not refactor unrelated code.

------------------------------
Text Form Filling via Overlay Annotations (Authoritative)
Objective

Add support for typing text directly onto PDFs, including non-fillable PDFs (e.g., Word documents printed to PDF), using overlay-based text annotations.

This feature must allow users to visually place, move, resize, and edit text on top of a PDF and permanently apply it only on export.

Hard Constraints (Do Not Violate)

Do NOT edit existing PDF text

Do NOT attempt OCR

Do NOT auto-detect form fields

Do NOT modify original PDF bytes

Do NOT introduce backend processing

Do NOT autosave or silently persist text

All behavior must remain local-first

Export must use existing pdf-lib pipeline

Functional Requirements
1. Text Tool Activation

Add a “Add Text” tool/button to the UI

When active:

Cursor indicates text placement mode

Clicking on a PDF page creates a new text annotation

2. Text Placement

On click:

Create a text annotation at click position

Insert a visible text caret

Allow immediate typing

Text must appear as an overlay element above the PDF

3. Text Editing

Each text annotation must support:

Editing text content

Moving (drag)

Resizing (basic resize handles acceptable)

Font size adjustment

Font family selection (must include a monospaced font)

Text color (default: black)

All changes update annotation state only, not the PDF.

Data Model (Must Use or Equivalent)
TextAnnotation {
  id: string
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  text: string
  fontSize: number
  fontFamily: string
  color: string
}


Text annotations must be stored alongside image annotations, using the same overlay/annotation system.

Rendering Rules

Text annotations must be rendered in the page overlay layer

Overlay origin is top-left

Positioning must be visually WYSIWYG relative to PDF content

Text must remain readable at different zoom levels

Export Rules (Critical)

On export:

Load original PDF bytes

For each TextAnnotation:

Convert overlay coordinates → PDF coordinates

Embed font explicitly using pdf-lib

Draw text using drawText()

Save as a new PDF file

Rules:

Original PDF must remain untouched

Text position in exported PDF must match on-screen placement

Font embedding must be deterministic

Coordinate conversion:

pdfY = pageHeight - overlayY - overlayHeight


Centralize this logic in pdfService.js.

File Responsibilities

app.js

Text tool UI

Click-to-create text annotations

Overlay rendering of text boxes

Drag / resize / edit behavior

Annotation state management

pdfService.js

Text embedding using pdf-lib

Font embedding

Coordinate conversion

Export logic (reuse existing flow)

storage.js

Optional session persistence only

Must not autosave without user consent

sw.js / main.js

No changes allowed

UX Expectations

Text placement must feel similar to filling a printed form

User manually aligns text to blanks/lines

No assumptions about form structure

No snapping or auto-alignment required in this phase

Tests (Mandatory)

Add tests covering:

Creating a text annotation on click

Editing text content

Moving and resizing text annotations

Exported PDF contains typed text

Text position matches overlay preview

Font embedding works (including monospaced font)

Original PDF bytes remain unchanged

Works offline

Failing tests block completion.

Explicitly Out of Scope

Editing existing PDF text

OCR

PDF AcroForm detection

Auto field alignment

Spellcheck or rich text

Completion Criteria

This task is complete only when:

User can type anywhere on a PDF, including non-fillable PDFs

Text behaves like a form-filling overlay

Export produces a correct, flattened PDF

No regressions to image placement, merging, export, or offline support

All tests pass

Final Reminder

This feature adds text overlays, not text editing.

Preserve:

predictability

legal safety

long-term stability

Do not refactor unrelated code.