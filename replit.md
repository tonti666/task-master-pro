# Poodflow by Poodlab - Task Management & CRM Platform

## Overview

Poodflow is a comprehensive task management and CRM platform designed for digital marketing agencies. It provides project and task management with multiple views (list, kanban, calendar), time tracking, client relationship management, team collaboration features including real-time chat, document management, and AI-powered tools for task suggestions and ad copy generation using the Gemini API.

The platform supports role-based permissions with Admin and Coworker roles, where Admins have access to settings, reports, client financial data, statistics dashboard, and team management capabilities.

### Key Features
- **Client Income History**: When changing a client's monthly payment, the system tracks historical pricing with effective dates for accurate financial reporting
- **Statistics Dashboard**: Admin-only dashboard with monthly labor costs, client income, profit charts, and detailed breakdowns with month-by-month filtering
- **Multi-Language Support**: English and Hungarian translations with language switcher in header; uses context-based I18nProvider with localStorage persistence
- **All monetary values displayed in HUF (Hungarian Forint)**
- **Sales Funnel**: Complete lead management system with:
  - Pipeline kanban view with 7 stages (New Lead → Contacted → Qualified → Proposal Sent → Negotiation → Won/Lost)
  - Lead sources tracking (Facebook, Google, Website, Referral, Cold Call, LinkedIn, Other)
  - Lead detail modal with activity timeline
  - Analytics dashboard with conversion rates, pipeline value, team performance, and stage distribution
  - External API endpoints (`/api/external/*`) with Bearer token authentication for Make.com integration
  - Role-based access (Admin and Sales roles can access Sales Funnel)

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **UI Components**: shadcn/ui component library built on Radix UI primitives
- **Build Tool**: Vite with custom plugins for Replit integration

The frontend follows a page-based architecture with reusable components. Pages are located in `client/src/pages/` and shared components in `client/src/components/`. The design follows Linear-inspired productivity interface principles with high information density.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **HTTP Server**: Node.js HTTP server (supports WebSocket upgrades for real-time features)
- **API Pattern**: RESTful API with `/api` prefix for all routes
- **Session Management**: Express sessions with PostgreSQL store (connect-pg-simple)

The server uses a modular structure:
- `server/index.ts` - Main entry point with middleware setup
- `server/routes.ts` - API route definitions
- `server/storage.ts` - Data access layer interface (currently in-memory, designed for database migration)
- `server/db.ts` - Database connection using Drizzle ORM

### Data Layer
- **ORM**: Drizzle ORM with PostgreSQL dialect
- **Schema Location**: `shared/schema.ts` - Shared between frontend and backend
- **Validation**: Zod schemas generated from Drizzle schemas via drizzle-zod
- **Migrations**: Managed via drizzle-kit (`npm run db:push`)

### Authentication
- Passport.js with local strategy for username/password authentication
- Session-based auth with "Remember Me" functionality
- Role-based access control (Admin vs Coworker)

### Real-time Features
- WebSocket support for team chat functionality
- Audio notifications for new messages
- Unread message indicators

## External Dependencies

### Database
- **PostgreSQL**: Primary database (requires `DATABASE_URL` environment variable)
- Connection pooling via `pg` package

### AI Services
- **Google Gemini API**: Used for AI task suggestions (description, category, time estimation) and multi-platform ad copy generation with image analysis capabilities
- Package: `@google/genai`

### Key Third-Party Libraries
- **UI**: Radix UI primitives, Lucide React icons, embla-carousel, react-day-picker
- **Data**: date-fns for date manipulation, xlsx for CSV export functionality
- **Forms**: react-hook-form with zod validation
- **Utilities**: nanoid for ID generation, clsx/tailwind-merge for class handling

### Development Tools
- **TypeScript**: Strict mode enabled across the project
- **Build**: esbuild for server bundling, Vite for client
- **Path Aliases**: `@/` for client source, `@shared/` for shared code