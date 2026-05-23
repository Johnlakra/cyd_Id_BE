# Anubhav 2026 — Backend (cyd_Id_BE) project rules
- Read ../MASTER_PLAN.md and ../shared/API_CONTRACT.md before any task.
- Branch: feature/anubhav-2026-event-module. Never push to main.
- ADDITIVE ONLY: do not alter existing tables, routes, controllers, or middleware.
- New API lives under /anubhav (one new mount line in server.js).
- Reuse query/queryOne, {success,message,data} envelope, authenticateToken.
- Enforce place scoping (phagwara|abohar|amritsar) in SQL; LOC restricted to loc_place.
- Run anubhav-manager first; it dispatches schema-architect / api-builder / repo-analyzer.
