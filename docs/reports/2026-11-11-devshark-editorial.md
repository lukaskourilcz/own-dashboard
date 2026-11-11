# devShark practice series, 11 November 2026

Three unapproved concepts are in Design Lab. They use the green and ink identity, original code, and an exercise that can run in a browser console. In each lesson the reader predicts an output, explains it, then tries a different input.

| Lab concept | What to try after the answer | What to measure |
| --- | --- | --- |
| Which log runs first? | Start with `A, C, B` for a promise callback. Add `setTimeout(() => console.log("D"), 0)` and predict the new order. The callback queued by the resolved promise runs after the stack clears and before the timer callback. | Shares per 1,000 reached accounts on comparable IG carousels. |
| sort changes the input | Use `[2, 10, 1]`. Compare `sort()` and `toSorted((a, b) => a - b)`. Show original and returned references. The comparator matters because the default sorts string representations. | Same IG metric. Code-led cover and similar publication age. |
| 0 is a valid value | A basket can contain 0 items. Compare `count || 10` and `count ?? 10` for 0, null, undefined and the empty string. Ask which value an optional text field should preserve. | Same IG metric. Compare completed practice only if the product records the event. |

Treat 40% predict/explain, 30% debugging, 20% practical builds and 10% interview reasoning as an editorial mix across a batch. Keep the 16:00 IG/Threads and 19:00 Threads Prague time slots during the measurement period. Review at around 72 hours and seven days.

## Story answer and recall

1. After the event-loop challenge, show the exact answer in green and a one-line explanation in ink on the original code capture. Headline: “A, C, then B.” Explanation: “Synchronous lines finish before the promise callback.”
2. In a follow-up Story, show the same three lines plus the timer for D. Use the native Quiz sticker if the app offers it. Options: “A C B D” and “A C D B”. Show the answer and why in the next frame. Reserve the lower safe zone for the sticker.
3. Compare replies per 1,000 reached accounts against the existing cover-only Story at a similar age. Record the platform's actual count around 24 hours.

## Standalone Threads drafts

- Event loop discussion: “A timer with a delay of 0 still waits for the current stack. Try logging A, queuing a timer for D, resolving a promise for B, then logging C. The result is A C B D. The promise reaction is a microtask, so it runs before the timer task.”
- Sorting discussion: “If sorting a React list changes another component's data, check whether both hold the same array. `items.sort(compare)` changes the shared array. Try `items.toSorted(compare)` in a runtime that supports it, or copy before sorting.”
- Existing `typeof null` challenge: “`typeof null` returns 'object'. Check `value === null` before deciding whether to read properties. For a nullable settings object, `settings?.theme ?? "system"` keeps a supplied theme and gives null or undefined a default.”

Use a draft only when the discussion asks about that mechanism. Each stands on its own without hashtags. Send through the existing reviewed publishing workflow.

## Verified claims

- On 11 November the Instagram bio offered 55% off. The live product showed €4.99 a month and €59.88 a year with sales closed and voucher access offered. The old launch discount and €3.99 reference price no longer match the displayed offer. Proposed bio: “Build web dev skills with lessons, quizzes and coding challenges. Start practising free.” Use `https://devshark.app/learn?utm_source=instagram&utm_medium=social&utm_campaign=education_bio` for Instagram and replace the source with `threads` for Threads. The JavaScript track loaded as a guest. [Product offer](https://devshark.app/premium).
- `0.1 + 0.2 === 0.3` is false. The same absolute epsilon rejects `1000.1 + 1000.2` versus `2000.3`. The concept now uses a tolerance for the specific example and explains choosing it for the data. [ECMAScript Number.EPSILON](https://tc39.es/ecma262/#sec-number.epsilon).
- The published reverseWords implementation passed empty, whitespace-only and normal inputs. The source concept now names the empty case.
- HTTP 401 says the request lacks valid credentials for the resource and carries an authentication challenge. HTTP 403 says the server understood the request and refuses it. The requester's authentication state cannot be inferred from 403 alone. The source concept uses this wording. [RFC 9110, status codes](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.4).

The source concepts can seed corrected versions. The existing scheduled versions require a new review to change their approved content.
