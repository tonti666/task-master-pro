# Design Guidelines: Task Management & CRM Platform

## Design Approach
**Selected System**: Linear-inspired productivity interface with Material Design principles for data-rich components
**Rationale**: This is a utility-focused, information-dense productivity tool requiring stability and efficiency over visual trends.

## Core Design Principles
1. **Information Density First**: Maximize useful data visibility without clutter
2. **Scan-ability**: Clear visual hierarchy for rapid task identification
3. **Contextual Clarity**: Users always know where they are and what they can do
4. **Efficient Interactions**: Minimize clicks, maximize keyboard shortcuts

---

## Typography System

**Font Stack**: Inter (via Google Fonts CDN)
- **Headings**: 
  - Page titles: 24px, semibold (600)
  - Section headers: 18px, semibold (600)
  - Card titles: 16px, medium (500)
- **Body Text**: 14px, regular (400)
- **Small Text** (metadata, timestamps): 13px, regular (400)
- **Input Labels**: 13px, medium (500)

---

## Layout System

**Spacing Primitives**: Tailwind units of 2, 4, 6, and 8 (maintaining 8px base grid)
- Micro spacing (icons, badges): p-2
- Component padding: p-4
- Section spacing: p-6 to p-8
- Page margins: p-8

**Grid Structure**:
- Sidebar: Fixed 240px width
- Main content: Dynamic with max-width constraints per view
- Modals/Forms: max-w-2xl centered

---

## Component Library

### Navigation & Layout
**Top Bar** (h-16):
- Logo/app name (left)
- Global search
- Notifications bell with unread badge
- User avatar with dropdown (right)

**Left Sidebar** (w-60):
- Collapsible navigation groups
- Active state: subtle background + accent border-left
- Icon + label format throughout
- Bottom section: user profile + settings access

**Dashboard Layout**:
- 3-column responsive grid for stats cards
- Widget-based with consistent card treatment

### Task Views

**List View**:
- Grouped by status with collapsible headers
- Table-like rows with: checkbox, title, assignee avatar, client tag, category badge, due date, time tracked
- Row height: 56px with hover state
- Inline editing on click

**Kanban Board**:
- Columns: 320px width, scrollable
- Cards: compact (96px min-height) with drag handles
- Column headers show count badges
- Smooth drag-and-drop visual feedback

**Calendar View**:
- Monthly grid with day cells
- Task pills: truncated title + color-coded status dot
- Click to expand day details in side panel

### Forms & Inputs
**Task Creation Modal**:
- Full-width rich text editor for description
- Organized field groups with clear labels above inputs
- AI Suggest button: prominent with icon, secondary style
- Input heights: 40px
- Dropdowns: searchable with avatar/icon previews

**Input Styling**:
- Border: 1px solid with focus state (2px accent)
- Rounded corners: 6px
- Disabled state: reduced opacity (0.5)

### Data Display Components

**Client Cards** (CRM):
- Horizontal card layout (h-32)
- Avatar/logo left, info center, quick actions right
- Metadata grid: contact, team, services, budget

**Time Tracker**:
- Stopwatch display: large monospace font (32px)
- Play/pause toggle with timer state indication
- Manual entry: inline input with +/- controls

**Comment Thread**:
- Nested replies with indent (pl-12)
- Avatar + name + timestamp header
- @mention highlighting with different background
- Reply action always visible

### Chat Interface
**Channel/DM List** (left panel, w-64):
- Unread indicator: dot + bold text + count badge
- Active channel: background highlight
- Section dividers: Channels / Direct Messages

**Message View**:
- Message bubbles: left-aligned with avatar
- Timestamp on hover
- Typing indicators
- Audio notification on/off toggle

### Notifications
**Notification Panel** (dropdown from bell):
- Width: 384px
- List of notifications with icon, message, timestamp
- Unread: background accent
- Action buttons: Mark all read, Settings
- Grouped by: Today, Earlier

### Documents
**File Browser**:
- List/grid toggle view
- Folder icon + name with expand/collapse
- File rows: icon, name, last modified, size, actions
- Lock icon for password-protected items

**Document Editor**:
- Full-screen text editor with toolbar
- Save button always visible (top-right)
- Password protection toggle (admin only)

### AI Features

**Ad Copy Generator** (dedicated page):
- Left panel: Configuration form with all parameters
- Right panel: Live preview/output
- Platform tabs: Google Ads / Facebook Ads
- Image upload zone with preview
- Generate button: large, primary style
- Output: copyable text blocks with character counts

### Admin-Only Components

**Settings Panel**:
- Tabbed interface: Work Categories, Task Statuses, Team Members
- CRUD tables with inline editing
- Color picker for status customization
- Save/Cancel always visible

**Broadcast Message**:
- Modal with rich text editor
- Recipient selector: All / Team filter dropdown
- Preview mode before send
- Send button: prominent primary action

---

## Interaction Patterns

**Drag & Drop**: Visual lift (shadow) + destination highlight
**Loading States**: Skeleton screens for data-heavy views
**Empty States**: Centered icon + message + primary action
**Confirmation Dialogs**: Centered modal (max-w-md) with clear actions
**Toast Notifications**: Bottom-right corner, auto-dismiss in 4s

---

## Data Visualization

**Dashboard Stats Cards**:
- Large number display (32px)
- Label below (13px)
- Trend indicator (icon + percentage)
- Card background subtle distinction

**CSV Export**:
- Button in top-right of relevant views
- Export modal: date range selector, column checkboxes
- Download button generates file

---

## Accessibility & Interactions

- All interactive elements: 44px minimum touch target
- Keyboard navigation: visible focus rings
- Skip links for main content
- ARIA labels for icon-only buttons
- Form validation: inline error messages below inputs

---

This design creates a professional, efficient productivity tool that prioritizes information density and user workflow over decorative elements, perfectly suited for daily task management and team collaboration.