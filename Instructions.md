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

----------------------
# Codex Task Block — UX Trust Messaging + PWA Install + Themes + Annotation Styling (Authoritative)

## Objective
Implement the following in the existing local-first Cloud PDF Editor without changing core PDF pipelines:
1) Emphasize **local ownership messaging** in UI copy (high priority, low effort)
2) Support **installable PWA** app experience (high priority, low effort)
3) Add **UI themes**: light / dark / high-contrast (medium priority)
4) Add **annotation styling controls** (medium priority): font size + color for text annotations; optional tint/opacity for highlights if present

This work must preserve local-first rules, offline behavior, and explicit export.

---

## Hard Constraints (Do Not Violate)
- No backend, no network calls for PDF processing
- No analytics/telemetry
- No forced updates
- No silent autosave
- Do not refactor unrelated code
- Do not change merge/export logic except to apply styling metadata already captured in annotation state
- Must keep offline support working (service worker remains cache-first)
- All user data stays local unless explicitly exported

---

## Deliverables Overview
A) UI copy changes: clear, visible local-first trust messaging
B) PWA installability: manifest + install prompt UX + icons + verified offline launch
C) Themes: CSS variables + toggle + persistence (local, user-controlled)
D) Annotation styling: UI controls + state model + export reflects styles + tests

---

## A) Local Ownership Messaging (UI Copy)
### Requirements
Add a small “Trust / Privacy” message area in the UI (header or settings panel) that always states:
- “All PDF viewing and editing happens on your device.”
- “Files are never uploaded.”
- “Nothing is saved unless you export or explicitly enable session restore.”

If there is an existing “remember last session” feature:
- Ensure wording clarifies it is local-only and optional.
- If restore prompt exists, the copy must appear near it.

### Acceptance Criteria
- Message is visible without scrolling on desktop
- Message is concise (2–4 lines)
- No misleading “cloud processing” claims

---

## B) Installable PWA App Experience
### Requirements
1) Add/verify `manifest.webmanifest` with:
   - name, short_name
   - start_url (root)
   - display: standalone
   - background_color, theme_color
   - icons (at least 192x192 and 512x512 PNG)
2) Ensure service worker registration remains correct and app launches offline after first load.
3) Add a non-intrusive “Install App” UI affordance:
   - Show only when `beforeinstallprompt` is fired
   - Button triggers `prompt()`
   - Track user dismissal only in-memory (no analytics)
4) Add minimal install instructions fallback if browser doesn’t support install prompt:
   - A small tooltip/modal: “Use browser menu → Install app”

### Files
- `manifest.webmanifest` (new)
- `icons/` assets (new)
- `main.js` or equivalent entry point: handle `beforeinstallprompt`
- existing `sw.js` should remain cache-first; update cache list if needed for new files

### Acceptance Criteria
- Lighthouse PWA checks pass for installability basics (as much as applicable)
- App can be installed and opens in standalone window
- App loads offline after first load

### Tests
- Presence of manifest and required fields (unit test)
- Service worker still registered (existing sw test updated if needed)

---

## C) UI Themes (Light / Dark / High Contrast)
### Implementation Approach (Required)
Use CSS variables on `:root` (or `html[data-theme="..."]`) and a minimal theme switcher.
Themes must affect:
- app background
- text color
- panels/buttons
- overlay outlines/handles (so annotations remain visible)
Do not theme the PDF itself (rendered pages remain as-is). Theme the surrounding UI.

### Requirements
1) Add a Theme toggle in UI (Settings panel recommended):
   - Light
   - Dark
   - High Contrast
2) Persist chosen theme locally:
   - localStorage is fine
   - Must be user-controlled (no silent changes)
3) Default behavior:
   - Respect OS preference for light/dark ONLY on first run
   - After user chooses, always use saved theme

### Acceptance Criteria
- Switching themes updates UI instantly
- High-contrast improves readability (strong foreground/background contrast)
- No layout breakage

### Tests
- Theme value persists round-trip (unit test)
- Default respects OS preference when no saved value (mock matchMedia)

---

## D) Annotation Styling Controls (Font Size + Color)
### Scope
This applies primarily to the new text overlay annotations (form-filling).
If highlights exist, optionally allow tint/opacity later; for now focus on:
- Text font size
- Text color

### Requirements
1) Add styling controls in UI:
   - Font size: numeric input or slider (min 8, max 72, default 12 or current)
   - Color: small palette + custom input (hex or color picker)
2) Styling behavior:
   - When a text annotation is selected, controls show its current style and update it live
   - When no annotation selected, controls set defaults for the next text annotation created
3) Update data model for text annotations (if not already):
   - `fontSize` (number)
   - `color` (string like "#000000")
   - `fontFamily` should remain (must include monospaced option)
4) Export must reflect styling:
   - `pdfService.js` must draw text using correct size/color
   - Embed font deterministically (use standard fonts if available; fallback to embedded font)
5) Visual overlay must reflect styling:
   - Overlay text matches color and size so WYSIWYG aligns with export

### Acceptance Criteria
- User can select text annotation and change size/color
- Exported PDF text matches on-screen appearance
- No regression to image annotations

### Tests
- Changing annotation style updates state
- Export applies font size + color correctly
- Default styling applies to newly created annotations

---

## Non-Goals / Explicitly Out of Scope
- No OCR
- No editing existing PDF text
- No analytics
- No cloud sync
- No collaborative features
- No font upload system (use limited safe fonts for now)

---

## Completion Checklist
- [ ] UI displays local-first trust message
- [ ] PWA manifest + icons added, install prompt works where supported
- [ ] App installs and launches offline after first load
- [ ] Theme switcher works (light/dark/high-contrast) with local persistence
- [ ] Text annotation styling (font size/color) works + exports correctly
- [ ] All tests pass and new tests added for manifest/theme/styling
- [ ] No changes to unrelated modules; merge/export/offline behavior remains stable

## Final Reminder
Keep changes minimal and incremental. Do not refactor the app structure. Implement only what is required above, with tests alongside.

---------------------------------
# Codex Task Block — Top Bar + Movable Side Panes + Document-First Layout (Authoritative)

## Objective
Refactor the UI to a **document-first layout** with:
- A persistent **top bar** holding tools and actions
- A dominant **central document workspace**
- **Expandable, movable side panes** for advanced features (draw, text, highlight, comments, stamps, marks)

This task is a **UI architecture change only**.  
Do not modify PDF rendering, annotation export, or offline logic.

---

## Hard Constraints (Do Not Violate)
- Do NOT change PDF export logic
- Do NOT refactor annotation data models
- Do NOT introduce backend calls
- Do NOT add analytics or tracking
- Do NOT re-introduce vertical form layouts
- One active tool at a time
- All panes must be optional and dismissible

---

## Layout Requirements

### 1. Top Bar
Create a fixed top bar containing:
- Product name / logo (left)
- Tool buttons (center)
- Export PDF button (right)
- Settings menu (theme, install info)

Tool buttons must represent **modes**, not forms:
- Select
- Text
- Draw
- Highlight
- Comment
- Stamp
- Mark
- Image
- Signature (placeholder)

Only one tool can be active at a time.
`Esc` resets to Select tool.

---

### 2. Main Document Workspace
- Occupies the majority of the viewport
- Renders the PDF canvas and annotation overlays
- Does not resize when side panes open
- Provides neutral background and page shadow

---

### 3. Movable Side Panes

Each advanced tool opens its own pane:
- Text Pane
- Draw Pane
- Highlight Pane
- Comment Pane
- Stamp Pane
- Mark Pane

Pane behavior:
- Floating above the document workspace
- Draggable by header
- Expandable / collapsible
- Closeable
- Only one pane visible per active tool

Pane contents must only modify **annotation state and defaults**.

---

## Pane Implementation Rules
- Implement panes as absolutely positioned components
- Store pane position in local UI state
- Optional: persist position in localStorage
- No PDF.js or pdf-lib calls inside panes

---

## UI Behavior Rules
- Switching tools switches the active pane
- Closing a pane does not change the active tool
- Selecting an annotation updates pane controls
- No pane is shown when Select tool is active

---

## Styling Rules
- Use CSS grid/flex for layout
- Use CSS variables for theme compatibility
- Avoid borders-heavy UI; prefer spacing and contrast
- Export button must be visually primary

---

## Files Expected to Change
- app.js (layout, tool state, pane management)
- styles.css (grid layout, pane styling, top bar)
- index.html (structure hooks if needed)

No changes allowed in:
- pdfService.js
- storage.js
- sw.js

---

## Tests (Mandatory)
- Tool switching updates active mode correctly
- Only one pane visible at a time
- Pane drag updates position state
- Export still works with no UI regressions
- App remains usable offline

---

## Completion Criteria
- Document canvas is the visual focus
- Tools live in the top bar
- Advanced features live in movable side panes
- No regression to existing features
- UI feels comparable to professional desktop PDF tools

---

## Final Reminder
This refactor is about **confidence, hierarchy, and longevity**.
Do not add features beyond layout and pane structure in this task.

--------------------------------------
— Authorized Feature Expansion (Amendment)

This section amends and extends the existing Instructions.md.
All rules not explicitly modified here remain in force.

Amendment: Rich Text Styling for Text Annotations (Authorized)
Scope Expansion (Explicitly Allowed)

Text annotations are no longer limited to plain, uniform styling.

The editor MAY support rich text styling within a single text annotation, including:

Bold

Italic

Underline

Per-selection font size changes

Per-selection color changes

This applies only to overlay text annotations, not to existing PDF text.

Hard Constraints (Still Enforced)

Do NOT edit existing PDF text

Do NOT attempt OCR

Do NOT auto-detect form fields

Do NOT modify original PDF bytes

Do NOT introduce backend processing

Do NOT autosave or silently persist

Export must still flatten all content via pdf-lib

Rich Text Behavior Rules (Authoritative)

A text annotation may contain multiple styled segments.

If the user selects:

the entire text box → style applies to all text

a word or character range → style applies only to that selection

Styling changes must be reflected immediately in the overlay (WYSIWYG).

Export must preserve visual fidelity, not semantic text structure.

Required Data Model Extension

Text annotations must support styled spans:

TextAnnotation {
  id: string
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  spans: {
    text: string
    bold?: boolean
    italic?: boolean
    underline?: boolean
    fontSize?: number
    color?: string
  }[]
  fontFamily: string
}

Export Rules (Clarified)

On export:

Iterate spans in order

Draw text sequentially using drawText()

Apply style per span

Underlines must be rendered as vector lines (not font magic)

Visual output must match overlay exactly

Semantic text preservation is not required.

Amendment: Drawing Tool Execution (Authorized)
Scope Expansion (Explicitly Allowed)

The Draw tool is now authorized to create annotations, not just configure them.

The following drawing modes are explicitly allowed:

Freehand (path)

Line

Arrow

Rectangle

Circle / Ellipse

Polygon

Cloud

Connected lines

Drawing Execution Rules

Drawing occurs only on the overlay layer.

Draw actions:

Begin on mouse/touch down

Update on move

Commit on release

Stroke color and stroke width must be configurable before drawing.

No rasterization — all drawings must be vector-based.

Required Data Model (Clarified)
PathAnnotation {
  id: string
  pageNumber: number
  points: { x: number; y: number }[]
  strokeColor: string
  strokeWidth: number
  opacity?: number
}

Export Rules

Paths must be exported as vector strokes using pdf-lib

Stroke joins and caps should be preserved where possible

Original PDF remains untouched

Amendment: Highlight Tool Execution (Authorized)
Scope Expansion (Explicitly Allowed)

Highlighting is no longer configuration-only.

The editor MUST support actual highlight placement.

Highlight Behavior Rules

Initial implementation uses manual rectangle highlights:

Click-drag to define highlight area

Highlight color and opacity configurable beforehand

Highlights render beneath text annotations but above the PDF page

Text-aware highlighting remains out of scope for now

Required Data Model
HighlightAnnotation {
  id: string
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  color: string
  opacity: number
}

Export Rules

Highlights exported as semi-transparent rectangles

No PDF comment objects

No text extraction

UI Authorization Clarification

The following UI behaviors are now explicitly allowed:

Selecting text ranges inside text annotations

Contextual enabling/disabling of Bold / Italic / Underline buttons

Drawing directly on the document when Draw tool is active

Executing highlight placement when Highlight tool is active

All tools remain single-mode only.

Explicitly Still Forbidden (No Change)

Editing existing PDF text

OCR

AI features

Cloud sync

Real PDF comments / annotations

Background uploads

Auto-updates

Testing Addendum (Mandatory)

New tests must be added for:

Per-selection text styling

Mixed-style text export fidelity

Draw path creation and export

Highlight placement and export

No regressions to image/text/export/offline

Failing tests block completion.

Final Authority Statement

With this amendment:

Codex IS AUTHORIZED to implement:

Rich text styling inside text annotations

Actual draw tool execution

Actual highlight placement

Any future refusal to implement these features would be incorrect.

-------------------------------------
Future Features Pack (Signature · Session History · Comment Visibility) — AUTHORITATIVE

## Purpose
Implement the next approved feature set for the local-first document editor while preserving all existing guarantees:
- browser-only execution
- offline capability
- explicit user control
- no backend, no sync, no analytics
- no architectural rewrites

This task block is **fully authorized**.  
All work described here is allowed and expected.  
Anything not explicitly allowed here remains forbidden.

---

## HARD GLOBAL CONSTRAINTS (NON-NEGOTIABLE)

- No backend services
- No network calls for document processing
- No cloud storage or sync
- No user accounts
- No autosave to disk without user consent
- No modification of original PDF bytes
- All persistence must be local (IndexedDB / localStorage)
- Export logic must continue to use `pdf-lib`
- Offline behavior must remain intact
- No refactors outside the scope defined below

Failing any of these invalidates the implementation.

---

# FEATURE 1 — SIGNATURE TOOL (TYPED → STYLIZED, LOCAL MEMORY)

## Goal
Allow users to add reusable visual signatures **without handwriting capture, uploads, or accounts**.

This feature is **visual signing only**, not cryptographic or legal signing.

---

## Functional Requirements

### Signature Creation Flow
1. User activates **Signature Tool** from the top bar
2. A **Signature Pane** opens (movable, floating)
3. User enters:
   - Full name (required)
   - Initials (optional)
4. App generates **exactly 6 stylized variants**:
   - 6 full-name signatures
   - 6 initials (if provided)
5. User selects **one** preferred style
6. Selection is saved locally and reused automatically
7. User places the signature on the document like an annotation:
   - drag
   - resize
   - move between pages
8. Signature is flattened into the PDF **only on export**

---

## Signature Generation Rules

- Use **embedded cursive fonts only**
- No handwriting canvas
- No image upload required
- Deterministic output:
  - same name → same 6 options
- Variants must differ by:
  - font choice
  - slight letter spacing
  - baseline variation (subtle)

---

## Storage Rules

Signature preference must be stored locally:

```ts
SignatureProfile {
  name: string
  initials?: string
  fontId: string
}
Store in IndexedDB or localStorage

Must be user-clearable via Settings

No cross-device sync

Annotation Model
Signature placement uses an annotation (no special export logic):

ts
Copy code
SignatureAnnotation {
  id: string
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  text: string
  fontId: string
}
Export Rules
Render signature as vector text via pdf-lib

Embed font deterministically

Flatten visually (no PDF signature objects)

Original PDF remains untouched

Required UX Copy (Legal Safety)
Display once in the Signature Pane:

“This adds a visual signature only.
It does not apply cryptographic or digital signing.”

FEATURE 2 — SESSION HISTORY (LOCAL, AUTOMATIC, TRANSPARENT)
Goal
Allow users to resume work on recently opened PDFs without accounts or cloud sync.

Functional Requirements
Automatic Tracking
When a PDF is opened:

create or update a session entry

Track:

filename

last opened timestamp

annotation state

Resume Flow
On app load:

show “Recent Documents” list

User can:

reopen a session

remove a single entry

clear all history

Hard Rules
No automatic export

No silent file overwrite

No assumption of file permission persistence

If file handle access fails → prompt user to reselect

Storage Model
Use IndexedDB only:

ts
Copy code
SessionEntry {
  id: string
  fileName: string
  fileHash: string
  lastOpened: number
  annotations: Annotation[]
}
Store annotations only

File bytes must be reloaded via user permission if needed

UX Transparency (Mandatory)
Provide:

Toggle: “Remember recent documents” (default ON)

Copy:

“Recent documents are stored locally on this device only.”

FEATURE 3 — COMMENT VISIBILITY TOGGLE
Goal
Allow users to temporarily hide comments without deleting or exporting changes.

This is a view-only toggle.

Functional Requirements
Add Show / Hide Comments toggle:

top bar button OR

comment pane toggle

When hidden:

comment overlays are not rendered

comment data remains intact

When shown again:

comments reappear unchanged

Rules
Do NOT delete comments

Do NOT modify comment data

Do NOT affect other annotations

Do NOT automatically persist hidden state into export

State Model
Pure UI state only:

ts
Copy code
UIState {
  commentsVisible: boolean
}
Default: true

Export Behavior
Export remains unchanged

Comments are included unless user explicitly deletes them

Optional future enhancement:

“Exclude comments from export” (NOT required now)

FILE RESPONSIBILITIES
app.js
Signature tool UI

Signature pane

Session history UI

Comment visibility toggle

Annotation placement and rendering

pdfService.js
Signature rendering on export

Font embedding

Coordinate conversion (reuse existing logic)

storage.js
Signature profile persistence

Session history persistence

User-controlled clearing

sw.js / main.js
❌ No changes allowed

TESTING REQUIREMENTS (MANDATORY)
Add tests for:

Signature Tool
Generates exactly 6 variants

Selection persists across reload

Signature annotation exports correctly

Export matches on-screen placement

Session History
Session entry created on open

Resume restores annotations

Clear history removes entries

Works offline

Comment Visibility
Toggle hides comments visually

Data remains intact

Export unchanged

Failing tests block completion.

EXPLICITLY OUT OF SCOPE
Handwritten signature capture

Cryptographic signing

PDF digital signature objects

Cloud sync

Cross-device history

OCR

AI features

Autosave exports

COMPLETION CRITERIA
This task is complete only when:

Signature tool works end-to-end

Signature choice persists locally

Session history is automatic and transparent

Comments can be hidden without deletion

Export behavior remains stable

Offline usage works

All tests pass

No regressions introduced

FINAL REMINDER
Build incrementally.
Do not refactor unrelated code.
Preserve predictability, stability, and user trust.

This is a professional, local-first tool — act accordingly.



---------------------------------------------
— Feature Expansion Pack 2 (PDF Split · Shapes · Page Properties · Settings Pane Fix) — AUTHORITATIVE

## Purpose
Extend the local-first document editor with additional **structural and annotation capabilities** while preserving all existing guarantees:
- browser-only execution
- offline capability
- explicit user control
- no backend, no sync, no analytics
- no architectural rewrites

This block **adds new authorized features** and **fixes a confirmed UX defect**.
All work described here is approved and required.

---

## HARD GLOBAL CONSTRAINTS (NON-NEGOTIABLE)

- No backend services
- No network calls for PDF processing
- No cloud storage or sync
- No user accounts
- No autosave to disk without user consent
- No modification of original PDF bytes
- All persistence must be local (IndexedDB / localStorage)
- Export logic must continue to use `pdf-lib`
- Offline behavior must remain intact
- No refactors outside the scope defined below

Violation of any constraint invalidates the implementation.

---

# FEATURE 4 — PDF SPLIT (LOCAL, EXPLICIT)

## Goal
Allow users to split a PDF into one or more new PDFs **locally**, with explicit user intent.

This is a **structural document operation**, not annotation-based.

---

## Functional Requirements

### Split Modes (v1)
The Split tool must support:
1. **Split by page range**
   - Example: pages 1–3, 4–7
2. **Extract selected pages**
   - Arbitrary page selection

Each split operation results in **new PDF files**.

---

## UX Flow

1. User activates **Split** from the top bar
2. **Split Pane** opens (movable, floating)
3. User selects:
   - page ranges OR pages
4. User clicks **Split**
5. App generates new PDF(s)
6. User explicitly downloads each result

---

## Hard Rules

- ❌ Never overwrite the original PDF
- ❌ No automatic downloads
- ❌ No background file writes
- ❌ No cloud processing

---

## Export Rules

- Use `pdf-lib` to copy pages
- Preserve:
  - page order
  - page size
  - content fidelity
- Each output file must be a valid standalone PDF

---

## Tests (Required)

- Split by range produces correct PDFs
- Extracted pages match original content
- Original PDF remains unchanged
- Works fully offline

---

# FEATURE 5 — SHAPES TOOL (STRUCTURED DRAWING)

## Goal
Provide precise shape annotations distinct from freehand drawing.

Shapes are **intentional geometry**, not sketches.

---

## Supported Shapes

- Rectangle
- Circle / Ellipse
- Line
- Arrow
- Polygon
- Cloud

---

## Functional Behavior

1. User selects **Shapes** from top bar
2. **Shapes Pane** opens
3. User selects a shape type
4. User draws on page overlay:
   - click-drag for basic shapes
   - click-to-place points for polygon/cloud
5. Shape is committed on release / confirm

---

## Shape Properties (Editable)

- Stroke color
- Stroke width
- Fill color (optional)
- Opacity

---

## Data Model

ts
ShapeAnnotation {
  id: string
  pageNumber: number
  shapeType: "rect" | "ellipse" | "line" | "arrow" | "polygon" | "cloud"
  geometry: {
    x?: number
    y?: number
    width?: number
    height?: number
    points?: { x: number; y: number }[]
  }
  style: {
    strokeColor: string
    strokeWidth: number
    fillColor?: string
    opacity?: number
  }
}
Export Rules
Shapes must export as vector graphics

Use pdf-lib primitives (lines, paths)

No rasterization

Visual output must match overlay preview

Tests (Required)
Each shape type renders correctly

Shapes export with correct geometry

Style properties persist

No regression to freehand drawing

FEATURE 6 — PAGE PROPERTIES (RENAMED FROM “MARK”)
Goal
Replace the ambiguous “Mark” tool with a Page Properties tool focused on page-level operations.

This is a semantic rename plus scope clarification.

Authorized Page Properties
Page rotation (90° increments)

Page visibility toggle (hide/show in preview)

Page duplication

Page deletion (explicit confirmation required)

UX Rules
Page Properties opens a Page Properties Pane

Pane applies only to the currently selected page

Page-level actions must show confirmation for destructive changes

Hard Rules
❌ No implicit page deletion

❌ No silent reordering

❌ No auto-apply on click

Export Rules
Page properties must reflect in exported PDF

Hidden pages:

excluded from export

Deleted pages:

permanently removed in exported file only

Original PDF remains untouched until export.

Tests (Required)
Page rotation exports correctly

Hidden pages excluded from export

Deleted pages removed only in output PDF

Undo possible before export

FEATURE 7 — SETTINGS PANE COLLAPSE FIX (BUG FIX)
Goal
Fix the Settings pane so it behaves consistently with all other panes.

This is a required UX correction, not a feature request.

Expected Behavior
Settings pane must:

toggle open/closed on click

collapse when clicking outside (if enabled globally)

close when switching tools (optional but consistent)

Must not remain permanently expanded

Hard Rules
❌ No special-case logic for Settings

❌ No pinned-always-open panes

Settings must follow the same pane lifecycle rules as:

Text Pane

Shapes Pane

Signature Pane

Comment Pane

Tests (Required)
Settings pane opens on click

Settings pane collapses on second click

Pane state updates correctly

No regression to theme or install UI

FILE RESPONSIBILITIES
app.js
Split tool UI + logic

Shapes tool UI + execution

Page Properties pane

Settings pane behavior fix

Pane lifecycle management

pdfService.js
PDF split logic

Shape export rendering

Page property application on export

storage.js
Optional persistence of page visibility

No autosave without consent

sw.js / main.js
❌ No changes allowed

TESTING REQUIREMENTS (MANDATORY)
Add or update tests for:

PDF split outputs

Shape creation and export

Page property effects on export

Settings pane toggle behavior

Offline functionality remains intact

Failing tests block completion.

EXPLICITLY OUT OF SCOPE
Cloud sync

OCR

AI features

Cryptographic PDF signing

Background exports

Auto-save to disk

COMPLETION CRITERIA
This task is complete only when:

PDFs can be split locally and explicitly

Shapes tool works end-to-end

“Mark” is fully replaced by “Page Properties”

Settings pane collapses correctly

Export behavior remains stable

Offline use works

All tests pass

No regressions introduced