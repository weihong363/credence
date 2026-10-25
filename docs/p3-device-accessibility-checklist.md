# P3 physical-device and screen-reader acceptance

Prepared 2026-10-25. **Not yet executed.** Browser viewport and keyboard checks in [P3 verification](p3-verification.md) do not establish physical-device or screen-reader acceptance. This is a focused MVP check, not WCAG certification.

## Setup

Open https://credence-sandbox.onrender.com/ on a physical phone. Enter the deployment's owner token privately; never include it in screenshots, chat or recordings. Use existing completed tasks and settled receipts. These checks require no new model execution, task submission, order or capture.

Record device, OS, browser/version, screen reader/version, date and each result as PASS, FAIL or NOT TESTED. Describe observable failures without credentials or payer details.

## Physical phone

- [ ] Login works with the software keyboard; the submit button remains reachable.
- [ ] Portrait and landscape views have no horizontal page overflow, clipped controls or overlapping text.
- [ ] Expand the task-start form without submitting it. Labels, pinned-commit input and consent text are readable; account selector has exactly one option for the existing account.
- [ ] Select an existing completed mission. All three accepted services, report citations and evidence disclosures can be opened and read.
- [ ] Credit panel and a settled batch show readable amounts, Order ID, Capture ID and three settled charges.
- [ ] View ledger and scroll its history without unintentionally activating another control.
- [ ] Logout, log in again on the same page, and check the account selector still has one option.

## VoiceOver or another actual screen reader

Use the normal device accessibility controls to enable the screen reader. Record whether this check ran on phone or desktop.

- [ ] Navigate headings and landmarks; identify login, missions, task details and settlement sections.
- [ ] Login field is announced as a password field with its label; submit and logout controls have meaningful names.
- [ ] Form inputs, account selector and consent checkbox have understandable labels and announced state. Do not submit the form.
- [ ] Task selection announces its selected/pressed state; focus remains usable during the two-second refresh.
- [ ] Delivery disclosures announce expanded/collapsed state and their evidence is reachable.
- [ ] Read the account amounts and settled receipt in a sensible order, including currency and payment status.
- [ ] Traverse controls forward/backward without a focus trap; a visible keyboard focus indicator appears when using a keyboard.
- [ ] Status updates do not continuously interrupt reading or move focus unexpectedly during at least 30 seconds of polling.

## Results

| Check group | Environment | Result | Evidence / issue |
| --- | --- | --- | --- |
| Physical phone | Not provided | NOT TESTED | Requires a physical device |
| Actual screen reader | Not provided | NOT TESTED | Requires VoiceOver or equivalent |

Keep P3.4 unchecked until required checks pass or the owner explicitly accepts a documented deferral. Reproduce and fix failures before rerunning the affected checks. Preserve the five settled live-run records unchanged.
