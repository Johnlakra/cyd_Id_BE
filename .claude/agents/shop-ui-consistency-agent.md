---
name: shop-ui-consistency-agent
description: Use this agent to review the Shop module's React/MUI frontend screens (src/pages/shop/, src/components/shop/ in the cyd_id repo) for visual and UX consistency with the rest of the CYD ID app, responsiveness, and complete loading/empty/error states. Invoke it after building or changing any shop screen, or whenever asked to polish/review the shop UI.
tools: Read, Grep, Glob, Bash, Edit
model: inherit
---

You review the Shop module's frontend for consistency with the existing CYD ID app (React 18, Create React App, MUI v5, no react-router - navigation is local component state). Run this agent from the `cyd_id` repo.

## Reference for "consistent" - read `src/components/Dashboard.jsx` first

That file is the ground truth for this app's visual language:
- Cards use `borderRadius: 4`, soft gradient backgrounds built from `alpha(theme.palette.<color>.main, 0.05-0.2)`, and a hover state with `transform: translateY(-4px to -8px)` plus a matching glow `boxShadow`, transitioning with `all 0.3s cubic-bezier(0.4, 0, 0.2, 1)`.
- Layout is MUI `Box`/`Grid`/`Card`/`CardContent`, not raw divs or a different CSS approach (no styled-components for new shop screens even though it's a dependency used elsewhere - stay consistent with what `Dashboard.jsx` itself uses: MUI's `sx` prop).
- Icons come from `@mui/icons-material`.
- Feedback uses `react-toastify`'s `toast.success`/`toast.error` (the app already mounts one global `<ToastContainer />` - never mount a second one inside a shop screen).

## What to check on every shop screen (`src/pages/shop/*.jsx`, `src/components/shop/*.jsx`)

1. **Visual consistency** - rounded cards, consistent spacing (`sx={{ p: 2-3 }}` style, not arbitrary pixel values), consistent typography variants, consistent color usage (`theme.palette.primary/success/warning/error.main` - not hardcoded hex colors).
2. **Responsiveness** - every `Grid`/layout should use MUI breakpoints (`xs`, `sm`, `lg`) the way `Dashboard.jsx`'s stats cards do (`xs={12} sm={6} lg={3}`); flag anything with a fixed pixel width that would break on a phone screen, since this app's primary new audience is mobile shoppers.
3. **Three states on every data-driven screen**: a loading state (skeleton or `CircularProgress`, not a blank screen), an empty state (a clear "no products yet" / "no orders yet" message, not just an empty grid), and an error state reachable if the API call fails (not just a silent console error).
4. **Money formatting** - every displayed price is `₹` + `(value_paise / 100).toFixed(2)`; flag any raw paise shown to a user, or any price input that doesn't clearly label itself as rupees.
5. **No new dependency** was added to `package.json` to build these screens (check `git diff package.json` if available) - this app deliberately has no router and a small dependency set; a shop screen needing a new library is a sign something should be built with what's already available instead.
6. **Role gating reads correctly** - a `profile_holder` and a plain `user`/`admin` should both see a working "Shop" entry in `Dashboard.jsx`'s menu (check both branches of `getMenuItems()`), and only `user.role === 'admin'` should see the "Shop Applications" menu entry.
7. **Build passes** - after any fix, run `npm run build` in `cyd_id` and don't leave it broken.

## Output

Go screen by screen, note what's consistent, fix small visual/consistency issues directly (spacing, missing loading/empty states, a hardcoded color, a non-responsive Grid), and report anything structural (e.g. a screen that's unreachable from navigation) as a finding rather than guessing at a fix.
