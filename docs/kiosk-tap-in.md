# Connecting the Tapping kiosk to the school portal

When a child taps their card on a kiosk, the Tapping software sends the card number to the school portal. The portal
finds the child and marks them in their class register for the day:

- A child who taps by the **late time** is marked **present**. The office sets the late time; it starts at 08:00.
- A child who taps after the late time is marked **late**.

This guide is for whoever set up the Tapping software.

## 1. Get a kiosk key (school office)

1. Open the portal at `/portal/manage`, then go to **Card tap-in**.
2. Under **Kiosks**, type a name (for example *Main gate*) and press **Add kiosk**.
3. Copy the **kiosk key** that appears. It starts with `nwek_` and is shown only once. If it is lost, press **New key**: the old key stops working straight away.

Each kiosk device gets its own key. Keep it secret, and **never put it in a public code repository**.
If a device goes missing, press **Turn off** (or **New key**) in the portal.

## 2. Check the connection

```
GET https://newworldemeraldprivateschool.com/api/kiosk/ping
Authorization: Bearer nwek_...
```

Answer:

```json
{ "ok": true, "kiosk": "Main gate", "date": "2026-11-12", "time": "07:31", "lateAfter": "08:00" }
```

If something is wrong, the answer has an `error` message:

| Status | Meaning |
|---|---|
| 401 | The key is missing or wrong. |
| 403 | The kiosk has been turned off in the portal. |

## 3. Send each tap

```
POST https://newworldemeraldprivateschool.com/api/kiosk/tap
Authorization: Bearer nwek_...
Content-Type: application/json

{ "cardId": "04A1B2C3", "tapId": "8812", "tappedAt": "2026-11-12T07:42:10+01:00" }
```

| Field | Required? | What it is |
|---|---|---|
| `cardId` | yes | The number the reader got from the card. Letters and digits only. Spaces, `:` and `-` are ignored, and upper and lower case count as the same. |
| `tapId` | recommended | The kiosk's own number for this tap. If a tap is sent twice (for example, retried after a network failure), it counts only once. |
| `tappedAt` | optional | When the card was tapped, as an ISO 8601 time or seconds since 1970. Send it when the kiosk was offline and sends its taps later. If you leave it out, the portal uses the time the tap arrives. Taps older than 7 days are refused. |
| `studentId` | instead of `cardId` | Use this only if your cards store the school student ID (for example `NWE/2026/00012`) rather than their own number. |

The kiosk can also send the taps it saved while offline in one request, up to 500 at a time:
`{ "taps": [ { "cardId": "...", "tapId": "...", "tappedAt": "..." }, ... ] }`.
The answer is `{ "ok": true, "results": [ ... ] }`, with one result per tap, in the same order.

### The answer: show `message` on the kiosk screen

```json
{
  "ok": true, "result": "present", "status": "present",
  "studentName": "Ada Obi", "studentId": "NWE/2026/00011", "className": "JSS 1 Amber",
  "date": "2026-11-12", "time": "07:42",
  "message": "Welcome, Ada. Marked present at 07:42.", "tapRef": "8812"
}
```

| `result` | `ok` | What happened |
|---|---|---|
| `present` | true | First tap of the day, on time. |
| `late` | true | First tap of the day, after the late time. |
| `already` | true | The child was already marked today (a second tap, or a teacher's mark). Nothing changed. |
| `unknown_card` | false | The card is not linked to a student yet. The office sees it under **New cards** and can link it. |
| `inactive` | false | The student is no longer active. |
| `refused` | false | Missing card number, or a bad or too-old time. |

A response with `"repeat": true` means the portal already had a tap with this `tapId`, so it returned the same result again and changed nothing.

## 4. Link the cards to students (school office)

Choose whichever is easier:

- **Tap and link.** Tap each new card on the kiosk. It appears in the portal under **Card tap-in → New cards**. Pick the student and press **Link**. This always stores the number in exactly the form the kiosk sends.
- **Type the number.** Use **Link a card by its number**. A USB card reader plugged into the office computer types the number for you.

## Rules the portal follows

- The register date and time are school time (Lagos).
- Only the **first** tap of the day sets the mark. Later taps are logged, but don't change anything.
- A teacher's mark is kept, with one exception. If the teacher marked the child **absent** and the child then taps in, the mark becomes present or late, because the child did come.
- An **excused** mark is never changed.
- The register note shows the time and the kiosk, for example "Tapped in at 07:42 (Main gate)". Teachers see it in their register.
- Each address may send up to 3,000 requests an hour.
