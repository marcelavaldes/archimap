# Deferred: Consultant SaaS Tier

**Cut:** 2026-08-26
**Cut by:** Unanimous conclusion of the 2026-08-26 review council (architect, engineer, researcher, security)
**Status:** Deliberately deferred, not forgotten. Stays cut until there is a paying consultant.

## Why

The product has two users — Marcela and Gui, using it to research where to relocate. The PRD's
Phase 4 described a second product on top of that: multi-tenant consultant SaaS with Clerk
Organizations auth, client profile CRUD, custom per-organization criteria, and PDF report
generation. None of it was built. `docs/database/schema.md` documented seven tables for it
(`organizations`, `users`, `client_profiles`, `saved_comparisons`, `reports`, `custom_criteria`,
`custom_criterion_values`), complete with RLS policy examples, against tables that were never
created in `supabase/migrations/`.

The architect's phrasing from that review: "speculative schema is the most expensive kind of debt
because it looks finished." A doc describing a system that doesn't exist pulls future work toward
a target nobody has validated demand for, while looking like settled scope.

## What was cut

From `docs/product/PRD.md`:

- **Phase 4: Consultant Features** — multi-tenant authentication (Clerk Organizations), client
  profile CRUD, custom criteria creation, PDF report generation (Puppeteer), report archive in
  Supabase Storage.
- The "Secondary: Architect Consultants" target-user segment framing (professional reports,
  client profiles, custom criteria; branded deliverables).
- The PDF-generation success metric (`< 5 seconds`) and the `Production: Weeks 15-18` /
  `18-20 weeks to full production` timeline that assumed Phase 4 shipped.

From `docs/database/schema.md`: the `organizations`, `users`, `client_profiles`,
`saved_comparisons`, `reports`, `custom_criteria` and `custom_criterion_values` table definitions
and their RLS policy examples.

From `docs/architecture/overview.md`: Clerk multi-tenant auth in the system diagram and the
JWT-scoped RLS description, replaced with what actually ships — a signed admin session cookie
(see `src/lib/admin/session.ts`) and public-read RLS.

From `docs/product/user-stories.md`: Epic 4 (Consultant Features), preserved verbatim below.

## Epic 4: Consultant Features (deferred, not built)

### US-4.1: Create Client Profile
> As an architect-consultant, I want to save each client's preferences to generate personalized recommendations.

> **Note (2026-09-06):** the *weight sliders* below were built and shipped — see
> [`docs/features/WEIGHTED_COMPOSITE.md`](../features/WEIGHTED_COMPOSITE.md). They were only ever
> filed here because they happened to be one acceptance criterion of this consultant-CRM story.
> The interaction — live weights driving a live map, for whoever is looking at it — is central to
> the product and much smaller than the epic it was buried in; weights live in the URL rather than
> in a saved profile. The rest of US-4.1 (named clients, email, budget, a workspace, a client list)
> remains deferred.

**Acceptance Criteria:**
- [ ] Form: name, email, maximum budget
- [x] ~~Sliders for each criterion weight (e.g., climate 30%, cost 40%...)~~ — built, unweighted from this story
- [ ] Constraints: "near airport", "coast", etc.
- [ ] Profile saved in my workspace
- [ ] Client list in dashboard

### US-4.2: Generate PDF Report for Client
> As a consultant, I want to generate a professional PDF report comparing selected communes to present to my client.

**Acceptance Criteria:**
- [ ] Select client + communes to compare
- [ ] Field for personalized notes
- [ ] "Generate PDF" button
- [ ] PDF includes: branding, map, comparison table, recommendation
- [ ] PDF downloadable and saved in history

### US-4.3: Create Custom Criterion
> As a consultant specialized in wineries, I want to add a "proximity to vineyards" criterion for my specific clients.

**Acceptance Criteria:**
- [ ] Can create new criterion with name
- [ ] Define metrics that compose the criterion
- [ ] Enter data manually per commune (or import CSV)
- [ ] Criterion appears as additional option on map
- [ ] Only visible to my organization

### US-4.4: Manage My Organization
> As lead consultant, I want to invite collaborators to my organization so they can view and edit client profiles.

**Acceptance Criteria:**
- [ ] Can invite users by email
- [ ] Assign roles: admin, editor, viewer
- [ ] Client data is shared within organization
- [ ] Can remove users

## What stays

The five real tables (`regions`, `departements`, `communes`, `criteria`, `criterion_values`) and
their public-read RLS policies. The two-person admin auth model. All of Phases 1-3 (base map,
multi-criteria, hierarchical navigation).

## Revival condition

Reopen this only when there is a paying consultant asking for it — not speculatively ahead of one.
When that happens, re-derive the schema and auth model from that consultant's actual workflow
rather than reviving these tables as-is; they were never validated against a real user.
