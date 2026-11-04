# SD-252: Searching for "%" or "_" returns every ticket

| Field           | Value                             |
| --------------- | --------------------------------- |
| Project         | SupportDesk (SD)                  |
| Issue type      | Bug                               |
| Status          | To Do                             |
| Priority        | Medium                            |
| Reporter        | Hannah Brooks (Support team lead) |
| Track           | Back-end                          |
| Affects version | 1.5                               |
| Component       | Ticket search (API)               |
| Labels          | `search`, `api`                   |
| Sprint          | SD Sprint 45                      |
| Created         | 03/11/2026 09:20                  |

## Description

Our agents search the ticket list by file names and promo codes all the time, and those often contain `_` or `%` (`report_final.csv`, `100% off`). Since the last release, searching for one of those characters brings back the whole list instead of the tickets that actually contain it.

The search box itself looks fine: it sends the text we type. The list that comes back is the problem.

## Steps to reproduce

1. Open the ticket list.
2. Search for `%`.
3. Search for `_`.

## Expected result

Searching for `%` shows only the tickets whose title contains `%` (today, the "100% off" discount ticket). Searching for `_` shows only the titles that contain `_` (the `report_final.csv` export ticket).

## Actual result

Both searches return every ticket. A search like `t_f` also matches titles that only have a `t`, any character and an `f` next to each other.

## Acceptance criteria

- [ ] `%` and `_` in a search are matched as plain characters.
- [ ] Every other search keeps working: partial and case-insensitive.
- [ ] `GET /api/tickets?search=…` keeps its response shape (the client and the reports depend on it).

## Environment

- SupportDesk 1.5 (API)
- Reproduced in the app and with `curl "http://localhost:3001/api/tickets?search=%25"`

## Activity

**Hannah Brooks** · 03/11/2026 09:31

> Not urgent, but it makes searching for exported files useless.
