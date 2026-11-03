# SD-263: Statuses like "closed" are saved and break the ticket page

| Field           | Value                                    |
| --------------- | ---------------------------------------- |
| Project         | SupportDesk (SD)                         |
| Issue type      | Bug                                      |
| Status          | To Do                                    |
| Priority        | High                                     |
| Reporter        | Marcus Bell (Support operations manager) |
| Track           | Back-end                                 |
| Affects version | 1.7                                      |
| Component       | Ticket updates (API)                     |
| Labels          | `data-quality`, `api`, `automation`      |
| Sprint          | SD Sprint 46                             |
| Created         | 06/11/2026 14:40                         |

## Description

Our nightly automation closes resolved tickets through the API. Last night it sent `"status": "closed"` (lowercase), and the API accepted it. Now those tickets show an empty status on the details page, the status filter in our reports skips them, and the agents can't tell whether they are open or closed.

The same happens with priorities: `"priority": "low"` is accepted and saved as `low`. Values that are completely wrong, like `"Urgent"`, are still rejected.

## Steps to reproduce

1. `curl -X PATCH http://localhost:3001/api/tickets/3 -H "Content-Type: application/json" -d '{"status":"closed"}'`
2. Open ticket #3 in the app.

## Expected result

The ticket's status is always one of `Open`, `In Progress` or `Closed`, exactly as the API contract in the README spells them. A request with another spelling is either rejected with `400` or saved as the official value.

## Actual result

The API answers `200` and saves `closed`. The details page shows an empty status, and the ticket no longer matches any status filter.

## Acceptance criteria

- [ ] No status or priority outside the official values is ever saved.
- [ ] Requests with valid values keep working exactly as before.
- [ ] Invalid values still answer `400` with an `error` message.

## Environment

- SupportDesk 1.7 (API)
- Ops automation script (Node.js) and `curl`

## Activity

**Marcus Bell** · 06/11/2026 14:52

> We fixed the script to send "Closed", but the API should never have accepted it. 38 tickets need cleaning up.
